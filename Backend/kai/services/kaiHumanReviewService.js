import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import {
  validateActorCanPerformOperation,
  validateActorIsOrganizationAdministrator,
} from "../auth/kaiAuthorizationService.js";
import { resolveAuthorizedHumanRole } from "../auth/kaiAuthorizedRoleAttribution.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresHumanReviewRepository } from "../dictionary/postgresHumanReviewRepository.js";
import {
  ORGANIZATION_DECISION_ROLE,
  evaluateOrganizationFactualReviewInTransaction,
  organizationFactualReviewRefusal,
} from "../dictionary/postgresOrganizationFactualReviewRepository.js";
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
 * generic system actor - except the organization administrator's own review
 * of an ordinary measurement (ORGANIZATION_APPROVED_AUDIENCES below). Both
 * operations require a mapped human actor before any repository call.
 */
const RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
const RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES = new Set(["gk_reviewer", "gk_admin"]);
const RECORD_EVIDENCE_REVIEW_DECISION_OPERATION = "record_evidence_review_decision";
const RECORD_CLAIM_REVIEW_DECISION_OPERATION = "record_claim_review_decision";
// Owner authorization 2026-10-24 (Operating Model v0.2 section 11
// exception): when the GK authorization above fails, an active client_admin
// of this organization (validateActorIsOrganizationAdministrator) may record
// both decisions for their own ordinary source-record-count measurement,
// recorded as client_admin and admitted inside the decision's transaction
// (evaluateOrganizationFactualReviewInTransaction). A client_admin claim
// approval is for the internal audience only. GK authorization, roles, and
// attribution are unchanged, and checked first.
const ORGANIZATION_APPROVED_AUDIENCES = Object.freeze(["internal"]);

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

// GK first, exactly as before; then the organization administrator.
function authorizeReviewDecision(actorContext, operation, organizationId, allowedRoles) {
  const auth = validateActorCanPerformOperation(
    actorContext,
    operation,
    organizationId,
    { allowedRoles, combineGlobalRoles: true },
  );
  if (auth.ok) return { auth, organizationReview: false };
  const adminAuth = validateActorIsOrganizationAdministrator(actorContext, operation, organizationId);
  if (adminAuth.ok) return { auth: adminAuth, organizationReview: true };
  return { auth, organizationReview: false };
}

/**
 * Whether this actor's evidence and claim decisions in this organization
 * would be the organization administrator's own (recorded as client_admin):
 * an active client_admin whom the GK authorization does not admit. Grants
 * nothing; every decision re-checks itself and is admitted per claim.
 */
export function canRecordOrganizationFactualReview({ actorContext, organizationId } = {}) {
  if (!isNonEmptyString(organizationId) || !isMappedHumanActor(actorContext)) return false;
  return [
    [RECORD_EVIDENCE_REVIEW_DECISION_OPERATION, RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES],
    [RECORD_CLAIM_REVIEW_DECISION_OPERATION, RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES],
  ].every(([operation, allowedRoles]) => {
    const { auth, organizationReview } = authorizeReviewDecision(actorContext, operation, organizationId, allowedRoles);
    return auth.ok && organizationReview;
  });
}

function organizationReviewAdmission(organizationId) {
  return async (tx, { evidenceItemId, currentHead }) => {
    const evaluation = await evaluateOrganizationFactualReviewInTransaction(tx, { organizationId, evidenceItemId, currentHead });
    return evaluation.organizationMayReview ? null : organizationFactualReviewRefusal(evaluation);
  };
}

function isOrganizationApprovedAudiences(approvedAudiences) {
  return approvedAudiences === undefined
    || approvedAudiences === null
    || (Array.isArray(approvedAudiences)
      && approvedAudiences.length === ORGANIZATION_APPROVED_AUDIENCES.length
      && approvedAudiences.every((audience, index) => audience === ORGANIZATION_APPROVED_AUDIENCES[index]));
}

function organizationAudienceRefusal(organizationId) {
  return buildKaiError("authorization_denied", {
    blockers: [{
      validator_key: "VAL-KAI-ORG-FACTUAL-REVIEW-001",
      severity: "blocker",
      object_type: "operation",
      object_code: RECORD_CLAIM_REVIEW_DECISION_OPERATION,
      object_id: organizationId,
      message: "An organization administrator may approve a claim for internal use only.",
      blocking_reason: "audience_requires_get_kinder_review",
      required_fix: "Approve the claim for the internal audience, or ask Get Kinder to review it for funders or the public.",
      evidence: { bypass_allowed: false },
    }],
  });
}

function repositoryError(result) {
  return buildKaiError(result.error.code, {
    status: result.error.status,
    ...(Array.isArray(result.blockers) ? { blockers: result.blockers } : {}),
  });
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

  const { auth, organizationReview } = authorizeReviewDecision(
    actorContext,
    RECORD_EVIDENCE_REVIEW_DECISION_OPERATION,
    input.organizationId,
    RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES,
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

  const decidedByRole = organizationReview
    ? ORGANIZATION_DECISION_ROLE
    : resolveAuthorizedHumanRole({
      actorContext,
      auth,
      allowedRoles: RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES,
    });
  if (!decidedByRole) {
    return buildKaiError("authorization_denied");
  }

  const repository = dependencies.humanReviewRepository || createPostgresHumanReviewRepository();
  const result = await repository.recordEvidenceReviewDecision({
    ...(organizationReview ? { reviewAdmission: organizationReviewAdmission(input.organizationId) } : {}),
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
    return repositoryError(result);
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * Read-only projection of whether this actor would pass every authorization
 * step recordEvidenceReviewDecision applies before its repository call, for
 * this organization: a mapped human, the same operation, allowed roles, and
 * combineGlobalRoles option (so active same-organization membership), the
 * same tenant check, and an attributable decided_by role. It grants nothing:
 * recordEvidenceReviewDecision re-checks every request. Used to decide
 * whether a read surface may offer the decision action and its write
 * coordinates.
 */
export function canRecordEvidenceReviewDecision({ actorContext, organizationId } = {}) {
  if (!isNonEmptyString(organizationId) || !isMappedHumanActor(actorContext)) return false;
  const auth = validateActorCanPerformOperation(
    actorContext,
    RECORD_EVIDENCE_REVIEW_DECISION_OPERATION,
    organizationId,
    { allowedRoles: RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
  );
  if (!auth.ok) return false;
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") return false;
  return resolveAuthorizedHumanRole({
    actorContext,
    auth,
    allowedRoles: RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES,
  }) !== null;
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

  const { auth, organizationReview } = authorizeReviewDecision(
    actorContext,
    RECORD_CLAIM_REVIEW_DECISION_OPERATION,
    input.organizationId,
    RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES,
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }
  if (organizationReview && !isOrganizationApprovedAudiences(input.approvedAudiences)) {
    return organizationAudienceRefusal(input.organizationId);
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const decidedByRole = organizationReview
    ? ORGANIZATION_DECISION_ROLE
    : resolveAuthorizedHumanRole({
      actorContext,
      auth,
      allowedRoles: RECORD_CLAIM_REVIEW_DECISION_ALLOWED_ROLES,
    });
  if (!decidedByRole) {
    return buildKaiError("authorization_denied");
  }

  const repository = dependencies.humanReviewRepository || createPostgresHumanReviewRepository();
  const result = await repository.recordClaimReviewDecision({
    ...(organizationReview ? { reviewAdmission: organizationReviewAdmission(input.organizationId) } : {}),
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
    // The repository's governance-ceiling rejection is an internal/domain
    // reason, not a public KAI API code (Backend Contract taxonomy: the
    // claim-review transition itself is permitted, so this is a validator
    // blocker, not a state-transition denial or a system error).
    const publicCode =
      result.error.code === "governance_ceiling_exceeded" ? "validation_blocker" : result.error.code;
    return repositoryError({ ...result, error: { ...result.error, code: publicCode } });
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
  ORGANIZATION_DECISION_ROLE,
  ORGANIZATION_APPROVED_AUDIENCES,
});

export const __humanReviewServiceTestables = Object.freeze({
  isRecordEvidenceReviewDecisionInput,
  isRecordClaimReviewDecisionInput,
  isMappedHumanActor,
});
