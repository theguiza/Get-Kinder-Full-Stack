import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresHumanReviewRepository } from "../dictionary/postgresHumanReviewRepository.js";
import {
  EVIDENCE_REVIEW_DECISION_OUTCOMES,
  CLAIM_REVIEW_DECISION_OUTCOMES,
  CLAIM_REVIEW_APPROVED_AUDIENCE_VALUES,
  evidenceReviewLimitationNotesRequired,
  claimReviewLimitationNotesRequired,
  claimReviewApprovedAudiencesRequired,
} from "../dictionary/humanReviewDecisionContract.js";

/**
 * KAI P2-12 (Problem A1) human review/decision service layer. Mirrors the
 * P3-04 `completeGeneratedContentReview` allowed-role precedent
 * (Backend/kai/services/kaiGeneratedContentService.js) exactly: `gk_reviewer`
 * and `gk_admin` only, never `gk_operator`, `client`, `assistant`, or any
 * generic system actor. Both operations require a mapped human actor before
 * any repository call.
 */
const RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
const RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
const RECORD_EVIDENCE_REVIEW_DECISION_OPERATION = "record_evidence_review_decision";
const RECORD_CLAIM_REVIEW_DECISION_OPERATION = "record_claim_review_decision";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isNonEmptyTrimmedStringArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * Derive the decided_by_role recorded on the ledger row: the actor's actual
 * org-scoped membership role if it is one of the allowed roles, else a
 * matching global KAI capability role, else gk_admin as the platform-
 * superuser-bypass fallback. validateActorCanPerformOperation itself does
 * not return which specific role matched (only ok/memberships), so this is
 * resolved independently, after authorization has already passed.
 */
function resolveDecidedByRole(actorContext, auth, allowedRoles) {
  const membershipMatch = (auth?.memberships || []).find((membership) => allowedRoles.has(membership.role_name));
  if (membershipMatch) return membershipMatch.role_name;
  const globalMatch = (actorContext?.kaiRoles || []).find((role) => allowedRoles.has(role));
  if (globalMatch) return globalMatch;
  return "gk_admin";
}

function isRecordEvidenceReviewDecisionInput(value) {
  const allowedKeys = new Set([
    "organizationId", "evidenceItemId", "reviewQueueItemId", "expectedUpdatedAt",
    "decision", "limitationNotes", "actorContext", "now",
  ]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (
    !isNonEmptyString(value.organizationId) ||
    !isNonEmptyString(value.evidenceItemId) ||
    !isNonEmptyString(value.reviewQueueItemId) ||
    !isNormalizedNow(value.expectedUpdatedAt) ||
    !Object.hasOwn(value, "actorContext") ||
    !isNormalizedNow(value.now) ||
    !EVIDENCE_REVIEW_DECISION_OUTCOMES.includes(value.decision)
  ) {
    return false;
  }
  const limitationRequired = evidenceReviewLimitationNotesRequired(value.decision);
  if (limitationRequired) return isNonEmptyTrimmedStringArray(value.limitationNotes);
  return value.limitationNotes === undefined || value.limitationNotes === null;
}

function isRecordClaimReviewDecisionInput(value) {
  const allowedKeys = new Set([
    "organizationId", "claimId", "reviewQueueItemId", "expectedUpdatedAt",
    "decision", "limitationNotes", "approvedAudiences", "actorContext", "now",
  ]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (
    !isNonEmptyString(value.organizationId) ||
    !isNonEmptyString(value.claimId) ||
    !isNonEmptyString(value.reviewQueueItemId) ||
    !isNormalizedNow(value.expectedUpdatedAt) ||
    !Object.hasOwn(value, "actorContext") ||
    !isNormalizedNow(value.now) ||
    !CLAIM_REVIEW_DECISION_OUTCOMES.includes(value.decision)
  ) {
    return false;
  }
  const limitationRequired = claimReviewLimitationNotesRequired(value.decision);
  if (limitationRequired) {
    if (!isNonEmptyTrimmedStringArray(value.limitationNotes)) return false;
  } else if (value.limitationNotes !== undefined && value.limitationNotes !== null) {
    return false;
  }
  const audiencesRequired = claimReviewApprovedAudiencesRequired(value.decision);
  if (audiencesRequired) {
    if (!Array.isArray(value.approvedAudiences) || value.approvedAudiences.length === 0) return false;
    const seen = new Set();
    for (const audience of value.approvedAudiences) {
      if (!CLAIM_REVIEW_APPROVED_AUDIENCE_VALUES.includes(audience)) return false;
      if (seen.has(audience)) return false;
      seen.add(audience);
    }
  } else if (value.approvedAudiences !== undefined && value.approvedAudiences !== null) {
    return false;
  }
  return true;
}

/**
 * KAI P2-12 human evidence-review decision recording. See
 * Backend/kai/dictionary/postgresHumanReviewRepository.js for the exact
 * persisted-state contract (P2-06's own eligibility evaluator is authoritative
 * for what these writes must mean -
 * Backend/kai/dictionary/postgresClaimTraceabilityRepository.js).
 */
export async function recordEvidenceReviewDecision(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isRecordEvidenceReviewDecisionInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isPlainObject(actorContext) || !actorContext?.actorUserId) {
    const auth = validateActorCanPerformOperation(
      actorContext,
      RECORD_EVIDENCE_REVIEW_DECISION_OPERATION,
      input.organizationId,
      { allowedRoles: RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
    );
    return buildKaiError(auth.error_code || "unauthorized", { blockers: auth.blockers });
  }
  if (actorContext.actorType !== "human") {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    RECORD_EVIDENCE_REVIEW_DECISION_OPERATION,
    input.organizationId,
    { allowedRoles: RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const decidedByRole = resolveDecidedByRole(actorContext, auth, RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES);

  const repository = dependencies.humanReviewRepository || createPostgresHumanReviewRepository();
  const result = await repository.recordEvidenceReviewDecision({
    organizationId: input.organizationId,
    evidenceItemId: input.evidenceItemId,
    reviewQueueItemId: input.reviewQueueItemId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    decisionOutcome: input.decision,
    limitationNotes: input.limitationNotes ?? null,
    actorUserId: actorContext.actorUserId,
    actorRole: decidedByRole,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * KAI P2-12 human claim-review decision recording. Requires the linked
 * evidence item's own decision-lineage head to already be a terminal
 * outcome - see the repository module for the exact precondition and write
 * contract. An `approved`/`approved_with_limitation` decision requesting
 * `funder`/`public` in approvedAudiences is independently rejected by the
 * repository's governance-ceiling check (Problem B is not opened by this
 * package) before anything is persisted.
 */
export async function recordClaimReviewDecision(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isRecordClaimReviewDecisionInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isPlainObject(actorContext) || !actorContext?.actorUserId) {
    const auth = validateActorCanPerformOperation(
      actorContext,
      RECORD_CLAIM_REVIEW_DECISION_OPERATION,
      input.organizationId,
      { allowedRoles: RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
    );
    return buildKaiError(auth.error_code || "unauthorized", { blockers: auth.blockers });
  }
  if (actorContext.actorType !== "human") {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    RECORD_CLAIM_REVIEW_DECISION_OPERATION,
    input.organizationId,
    { allowedRoles: RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const decidedByRole = resolveDecidedByRole(actorContext, auth, RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES);

  const repository = dependencies.humanReviewRepository || createPostgresHumanReviewRepository();
  const result = await repository.recordClaimReviewDecision({
    organizationId: input.organizationId,
    claimId: input.claimId,
    reviewQueueItemId: input.reviewQueueItemId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    decisionOutcome: input.decision,
    limitationNotes: input.limitationNotes ?? null,
    approvedAudiences: input.approvedAudiences ?? null,
    actorUserId: actorContext.actorUserId,
    actorRole: decidedByRole,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __humanReviewServiceContract = Object.freeze({
  COMPLETE_EVIDENCE_REVIEW_ALLOWED_ROLES: RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES,
  COMPLETE_CLAIM_REVIEW_ALLOWED_ROLES: RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES,
  RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES,
  RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES,
  RECORD_EVIDENCE_REVIEW_DECISION_OPERATION,
  RECORD_CLAIM_REVIEW_DECISION_OPERATION,
});

export const __humanReviewServiceTestables = Object.freeze({
  isRecordEvidenceReviewDecisionInput,
  isRecordClaimReviewDecisionInput,
  isMappedHumanActor,
});
