import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateAssistantBoundary } from "../validators/assistantBoundaryValidators.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  getEngagementForOrganization,
  getCurrentEngagementRequirementSetForIdentity,
  getRequirementSetAuthority,
  insertEngagementRequirementSetProposal,
  insertEngagementRequirementSetReviewApproval,
} from "../db/kaiQueries.js";
import { withTransaction } from "../db/kaiDb.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { __engagementContextServiceContract } from "./kaiEngagementContextService.js";

/**
 * KAI Package 2B: the only writer allowed to create
 * kai.engagement_requirement_sets rows. Proposal (2B-A) establishes no
 * applicability - it only records that an external, governed (non-
 * kai_standard) requirement set's own source_code/framework_code identity
 * exactly matches the engagement's currently selected governed target
 * (Package 1A `project_metadata.engagement_requirement_target`). Review
 * (2B-A/2B-B) is the only path that can create a reviewed/current row.
 *
 * 2B-B generalizes review into a governed replacement/lifecycle operation:
 * it finds "the current decision" for one (organization, engagement,
 * requirement_set) identity using the Package 2A current-authority predicate
 * (a row with no successor - see getCurrentEngagementRequirementSetForIdentity)
 * rather than trusting a caller-supplied row id, and supersedes whichever row
 * that is - the original non-authoritative proposal on a first review, or an
 * already-reviewed decision on a replacement review. The prior row is never
 * updated or deleted; Package 2A's append-only trigger and partial unique
 * indexes (one root, one successor per superseded row) are the only
 * enforcement mechanism, unchanged. The reviewer selects the outcome from
 * exactly the three reviewed states Package 2A's schema already supports -
 * 'applicable', 'not_applicable', 'retired' - no new vocabulary is invented.
 *
 * Human actors may propose (allowed by UPDATE_ENGAGEMENT_TARGET_ALLOWED_ROLES
 * parity - the same roles that select the engagement's target) or review
 * (a single fixed reviewer role, mirroring the P2-10 coverage-review-decision
 * precedent's ACCEPT_INTERNAL_COVERAGE_LIMITATION_ALLOWED_ROLES singleton).
 * A non-human ("system"/"assistant"/"ai") actor may only ever reach the
 * propose path - review unconditionally requires a mapped human actor,
 * exactly as every other reviewed-decision service in this family
 * (isMappedHumanActor) requires.
 */
const PROPOSE_OPERATION = "propose_engagement_requirement_set_applicability";
const PROPOSE_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "client_admin"]);
const APPROVE_OPERATION = "approve_engagement_requirement_set_applicability";
const APPROVE_ALLOWED_ROLES = new Set(["gk_reviewer"]);
const APPROVE_REVIEWER_ROLE = "gk_reviewer";
const REVIEW_DECISION_VALUES = new Set(["applicable", "not_applicable", "retired"]);
const AUTOMATED_PROPOSER_ACTOR_TYPES = new Set(["system", "assistant", "ai"]);
const ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY =
  __engagementContextServiceContract.ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY;
const GOVERNED_EXTERNAL_REQUIREMENT_SOURCE_TYPES = new Set([
  "standard_framework",
  "funder",
  "government_program",
  "reporting_template",
  "organization",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isAutomatedProposerActor(actorContext) {
  return (
    AUTOMATED_PROPOSER_ACTOR_TYPES.has(actorContext?.actorType) &&
    actorContext?.actorUserId == null
  );
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

function applicabilityBlocker(blockingReason, objectCode, requiredFix) {
  return {
    validator_key: "VAL-KAI-ENG-APPLICABILITY-001",
    severity: "blocker",
    object_type: "engagement_requirement_set_applicability",
    object_code: objectCode,
    object_id: null,
    message: "Engagement requirement set applicability request is invalid.",
    blocking_reason: blockingReason,
    required_fix: requiredFix || "Send only an exact governed requirement-set identity matching the engagement's current target.",
    evidence: {},
  };
}

function isProposeApplicabilityInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "requirementSetId", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId) || !isNonEmptyString(value.engagementId) || !isNonEmptyString(value.requirementSetId)) {
    return false;
  }
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

function isReviewApplicabilityInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "requirementSetId", "decision", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (
    !isNonEmptyString(value.organizationId) ||
    !isNonEmptyString(value.engagementId) ||
    !isNonEmptyString(value.requirementSetId) ||
    !REVIEW_DECISION_VALUES.has(value.decision)
  ) {
    return false;
  }
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

function isGovernedActiveAuthority(authority) {
  return (
    Boolean(authority) &&
    authority.source_type !== "kai_standard" &&
    GOVERNED_EXTERNAL_REQUIREMENT_SOURCE_TYPES.has(authority.source_type) &&
    authority.framework_status === "active"
  );
}

/**
 * Reads the engagement's own Package 1A governed target verbatim from
 * project_metadata - never inferred from requirement-set set_key/set_name or
 * any other label. Returns null unless target_funder_id and target_framework
 * are both present non-empty strings, since those are the only two fields an
 * exact governed-identity match can be made against.
 */
function readSelectedTarget(engagement) {
  const metadata = engagement?.project_metadata;
  const target = isPlainObject(metadata) ? metadata[ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY] : null;
  if (!isPlainObject(target)) return null;
  if (!isNonEmptyString(target.target_funder_id) || !isNonEmptyString(target.target_framework)) return null;
  return target;
}

function targetIdentityMatchesAuthority(target, authority) {
  return target.target_funder_id === authority.source_code && target.target_framework === authority.framework_code;
}

function proposalDto(row = {}) {
  return {
    engagement_requirement_set_id: row.engagement_requirement_set_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id,
    requirement_set_id: row.requirement_set_id,
    applicability_status: row.applicability_status,
    applicability_effective_state: row.applicability_effective_state || null,
    created_by: row.created_by || null,
    created_by_type: row.created_by_type,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at || null,
  };
}

function approvalDto(row = {}) {
  return {
    engagement_requirement_set_id: row.engagement_requirement_set_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id,
    requirement_set_id: row.requirement_set_id,
    applicability_status: row.applicability_status,
    applicability_effective_state: row.applicability_effective_state,
    reviewed_by: row.reviewed_by,
    reviewed_by_role: row.reviewed_by_role,
    reviewed_at: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at,
    supersedes_engagement_requirement_set_id: row.supersedes_engagement_requirement_set_id,
    target_context_identity: isPlainObject(row.target_context_identity) ? row.target_context_identity : null,
    created_by: row.created_by || null,
    created_by_type: row.created_by_type,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at || null,
  };
}

export async function proposeEngagementRequirementSetApplicability(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isProposeApplicabilityInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);
  const { actorContext } = actorResult;

  const boundary = validateAssistantBoundary({ actorContext, operation: PROPOSE_OPERATION });
  if (boundary.severity === "blocker") {
    return buildKaiError("authorization_denied", { blockers: [boundary] });
  }

  if (isMappedHumanActor(actorContext)) {
    const auth = validateActorCanPerformOperation(
      actorContext,
      PROPOSE_OPERATION,
      input.organizationId,
      { allowedRoles: PROPOSE_ALLOWED_ROLES },
    );
    if (!auth.ok) {
      return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
    }
  } else if (!isAutomatedProposerActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
  const getAuthority = dependencies.getRequirementSetAuthority || getRequirementSetAuthority;
  const insertProposal = dependencies.insertEngagementRequirementSetProposal || insertEngagementRequirementSetProposal;
  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;

  const engagement = await readEngagement({ organizationId: input.organizationId, engagementId: input.engagementId });
  if (!engagement) return buildKaiError("not_found");

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
    engagementRecord: engagement,
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const authority = await getAuthority({ requirementSetId: input.requirementSetId });
  if (!authority) return buildKaiError("not_found");

  if (authority.source_type === "kai_standard") {
    return buildKaiError("validation_blocker", {
      blockers: [applicabilityBlocker("kai_standard_not_governable_authority", "requirement_set_id")],
    });
  }
  if (!isGovernedActiveAuthority(authority)) {
    return buildKaiError("validation_blocker", {
      blockers: [applicabilityBlocker("requirement_authority_not_governed_active", "requirement_set_id")],
    });
  }

  const target = readSelectedTarget(engagement);
  if (!target || !targetIdentityMatchesAuthority(target, authority)) {
    return buildKaiError("validation_blocker", {
      blockers: [applicabilityBlocker("target_identity_mismatch", "requirement_set_id")],
    });
  }

  let row = null;
  try {
    row = await runInTransaction(async (tx) => {
      const inserted = await insertProposal(
        {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          requirementSetId: input.requirementSetId,
          createdBy: actorContext.actorUserId || null,
          createdByType: actorContext.actorType,
        },
        tx,
      );

      const auditResult = await insertAudit(
        {
          operation: PROPOSE_OPERATION,
          operation_type: PROPOSE_OPERATION,
          reason_code: "engagement_requirement_set_applicability_proposed",
          object_type: "other",
          target_object_type: "engagement",
          object_id: inserted.engagement_requirement_set_id,
          organization_id: input.organizationId,
          engagement_id: input.engagementId,
          actor_type: actorContext.actorType,
          actor_user_id: actorContext.actorUserId || null,
          created_by_service: "kaiEngagementRequirementApplicabilityService",
          metadata_only: true,
        },
        tx,
      );
      if (!auditResult?.ok) {
        const error = new Error("required audit rejected");
        error.kaiErrorCode = "audit_payload_rejected";
        throw error;
      }

      return inserted;
    });
  } catch (error) {
    if (error?.code === "23505") {
      return buildKaiError("conflict_current_state_changed");
    }
    if (error?.kaiErrorCode) {
      return buildKaiError(error.kaiErrorCode, { blockers: error.blockers || [] });
    }
    throw error;
  }

  if (!row) return buildKaiError("not_found");

  return { ok: true, data: proposalDto(row), error: null };
}

export async function approveEngagementRequirementSetApplicability(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isReviewApplicabilityInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);
  const { actorContext } = actorResult;

  // AI/system cannot self-approve: this gate is unconditional and precedes
  // role resolution, exactly mirroring every other reviewed-decision service
  // in this family (kaiCoverageReviewDecisionService.js,
  // updateEngagementRequirementTarget). Reviewer identity is resolved from
  // this authenticated actor only - never from client input.
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    APPROVE_OPERATION,
    input.organizationId,
    { allowedRoles: APPROVE_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
  const readCurrent = dependencies.getCurrentEngagementRequirementSetForIdentity || getCurrentEngagementRequirementSetForIdentity;
  const getAuthority = dependencies.getRequirementSetAuthority || getRequirementSetAuthority;
  const insertApproval = dependencies.insertEngagementRequirementSetReviewApproval || insertEngagementRequirementSetReviewApproval;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;
  const reviewedAt = dependencies.now ? dependencies.now() : new Date().toISOString();

  let row = null;
  try {
    row = await runInTransaction(async (tx) => {
      const engagement = await readEngagement(
        { organizationId: input.organizationId, engagementId: input.engagementId, lockForUpdate: true },
        tx,
      );
      if (!engagement) return null;

      const tenant = validateTenantBoundaryConsistency({
        expectedOrganizationId: input.organizationId,
        payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
        engagementRecord: engagement,
      });
      if (tenant.severity === "blocker") {
        const error = new Error("tenant_boundary_violation");
        error.kaiErrorCode = "tenant_boundary_violation";
        error.blockers = [tenant];
        throw error;
      }

      // The Package 2A current-authority predicate resolves which row is
      // "the current decision" for this governed identity - the client never
      // supplies a row id. On a first review this is the non-authoritative
      // proposal (Package 2B-A); on a replacement review it is whatever
      // reviewed decision is current now (Package 2B-B). Either way the row
      // this finds is locked and then superseded, never updated or deleted.
      const current = await readCurrent(
        {
          organizationId: input.organizationId,
          engagementId: input.engagementId,
          requirementSetId: input.requirementSetId,
          lockForUpdate: true,
        },
        tx,
      );
      if (!current) return null;

      // Re-validated at review time (not only at proposal time) so a
      // framework demoted to draft/retired between propose and review, or
      // between one reviewed decision and its replacement, fails closed
      // rather than silently becoming current.
      const authority = await getAuthority({ requirementSetId: current.requirement_set_id }, tx);
      if (!isGovernedActiveAuthority(authority)) {
        const error = new Error("requirement authority is no longer governed/active");
        error.kaiErrorCode = "validation_blocker";
        error.blockers = [applicabilityBlocker("requirement_authority_not_governed_active", "requirement_set_id")];
        throw error;
      }

      // The engagement target is re-read from the just-locked, current
      // governed engagement state inside this same transaction - never from
      // whatever the target was at proposal/prior-review time - so a target
      // changed since then fails closed instead of the new decision
      // inheriting stale applicability.
      const target = readSelectedTarget(engagement);
      if (!target || !targetIdentityMatchesAuthority(target, authority)) {
        const error = new Error("engagement target no longer matches the current requirement authority");
        error.kaiErrorCode = "conflict_current_state_changed";
        error.blockers = [applicabilityBlocker("target_context_mismatch", "engagement_id")];
        throw error;
      }

      const approved = await insertApproval(
        {
          organizationId: current.organization_id,
          engagementId: current.engagement_id,
          requirementSetId: current.requirement_set_id,
          supersedesEngagementRequirementSetId: current.engagement_requirement_set_id,
          reviewedBy: actorContext.actorUserId,
          reviewedByRole: APPROVE_REVIEWER_ROLE,
          reviewedAt,
          applicabilityEffectiveState: input.decision,
          targetContextIdentity: target,
          createdBy: actorContext.actorUserId,
          createdByType: actorContext.actorType,
        },
        tx,
      );

      const auditResult = await insertAudit(
        {
          operation: APPROVE_OPERATION,
          operation_type: APPROVE_OPERATION,
          reason_code: `engagement_requirement_set_applicability_reviewed_${input.decision}`,
          object_type: "other",
          target_object_type: "engagement",
          object_id: approved.engagement_requirement_set_id,
          organization_id: current.organization_id,
          engagement_id: current.engagement_id,
          actor_type: actorContext.actorType,
          actor_user_id: actorContext.actorUserId,
          created_by_service: "kaiEngagementRequirementApplicabilityService",
          metadata_only: true,
        },
        tx,
      );
      if (!auditResult?.ok) {
        const error = new Error("required audit rejected");
        error.kaiErrorCode = "audit_payload_rejected";
        throw error;
      }

      return approved;
    });
  } catch (error) {
    if (error?.code === "23505") {
      return buildKaiError("conflict_current_state_changed");
    }
    if (error?.kaiErrorCode) {
      return buildKaiError(error.kaiErrorCode, { blockers: error.blockers || [] });
    }
    throw error;
  }

  if (!row) return buildKaiError("not_found");

  return { ok: true, data: approvalDto(row), error: null };
}

export const __engagementRequirementApplicabilityServiceContract = Object.freeze({
  PROPOSE_OPERATION,
  PROPOSE_ALLOWED_ROLES,
  APPROVE_OPERATION,
  APPROVE_ALLOWED_ROLES,
  APPROVE_REVIEWER_ROLE,
  REVIEW_DECISION_VALUES,
  AUTOMATED_PROPOSER_ACTOR_TYPES,
  GOVERNED_EXTERNAL_REQUIREMENT_SOURCE_TYPES,
});

export const __engagementRequirementApplicabilityServiceTestables = Object.freeze({
  isProposeApplicabilityInput,
  isReviewApplicabilityInput,
  isMappedHumanActor,
  isAutomatedProposerActor,
  isGovernedActiveAuthority,
  readSelectedTarget,
  targetIdentityMatchesAuthority,
});
