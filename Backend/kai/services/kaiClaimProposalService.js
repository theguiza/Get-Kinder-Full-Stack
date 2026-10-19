import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresClaimProposalRepository } from "../dictionary/postgresClaimProposalRepository.js";
import { __humanReviewServiceContract } from "./kaiHumanReviewService.js";

// client_admin (owner decision 2026-10-18): an active organization administrator
// of this exact organization may propose a review-gated claim. Organization
// membership only. The decision-bound continuation below keeps its own set.
const CLAIM_PROPOSAL_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer", "client_admin"]);
const CLAIM_PROPOSAL_OPERATION = "propose_claim";

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

function isProposeClaimInput(value) {
  const allowedKeys = new Set(["organizationId", "evidenceItemId", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.evidenceItemId) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

/**
 * AUTH-KAI-003 (reapplied from P1-06 through P2-01): P2-03 claim proposal may
 * only be performed by a mapped human actor. Every non-human actor type (ai,
 * system, import, code, or any other generic-service actor) is rejected
 * outright - there is no bypass.
 */
function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * KAI P2-03 dormant deterministic claim-proposal seam.
 *
 * Human-authorized, idempotent proposal of exactly one internal-only, GK-
 * review-gated `finding` claim per already-committed P2-01
 * `kai.evidence_items` row, atomically compounded with the canonical
 * `kai.claim_evidence_links` row and one open `claim_review`
 * `kai.review_queue_items` row. Requires `KAI_SPRINT2_ENABLED` before any
 * repository read, lock, validator side effect, or audit activity - if it is
 * disabled, this returns the canonical `feature_disabled` result with zero
 * repository calls. Like P2-01/P2-02, this package has no route, worker,
 * listener, or production composition and so remains dormant under
 * `KAI_SPRINT2_ENABLED` alone; no package-specific feature flag is added.
 *
 * Contains no SQL and imports no database pool: persistence, lineage re-reads,
 * and every fail-closed validator are delegated entirely to the injected P2-03
 * repository. Authorization and tenant-membership checks are delegated to the
 * existing shared validator-group mechanisms (`validateActorCanPerformOperation`,
 * `validateTenantBoundaryConsistency`) rather than reimplemented locally.
 */
export async function proposeClaim(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isProposeClaimInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    CLAIM_PROPOSAL_OPERATION,
    input.organizationId,
    { allowedRoles: CLAIM_PROPOSAL_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    // The validator's own refusal: authorization_denied with role_not_allowed
    // or missing_active_organization_membership, tenant_boundary_violation
    // only for a missing organization scope. A genuine tenant inconsistency
    // is the separate check below.
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const claimProposalRepository = dependencies.claimProposalRepository || createPostgresClaimProposalRepository();

  const result = await claimProposalRepository.proposeClaim({
    organizationId: input.organizationId,
    evidenceItemId: input.evidenceItemId,
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(Array.isArray(result.error.blockers) ? { blockers: result.error.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null, warnings: result.data?.warnings || [] };
}

/**
 * J3-3 / Decision C Option A (owner-accepted 2026-10-13): the governed
 * decision-bound P2-03 continuation, called only by the P2-12 evidence-review
 * handoff (Backend/kai/services/kaiEvidenceReviewClaimProposalHandoffService.js).
 *
 * Same input shape as `proposeClaim` - no decision object, id, or marker is
 * accepted. Authority is NOT the P2-03 role set: it is the P2-12
 * evidence-review authority the actor holds now (the roles and
 * combineGlobalRoles option recordEvidenceReviewDecision applies) together
 * with the persisted current evidence-review decision this same actor made,
 * which the repository verifies inside the proposal transaction. Everything
 * else - the lineage validators, the review-gated internal-only claim, its
 * evidence link and claim_review queue item, idempotent replay, and the
 * required audit (which also records the authorizing decision) - is the
 * unchanged P2-03 path. It grants no claim-review or approval authority. The
 * direct `proposeClaim` entry above and its route are unchanged.
 */
export async function proposeClaimFromEvidenceReviewDecision(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isProposeClaimInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    CLAIM_PROPOSAL_OPERATION,
    input.organizationId,
    {
      allowedRoles: __humanReviewServiceContract.RECORD_EVIDENCE_REVIEW_DECISION_ALLOWED_ROLES,
      combineGlobalRoles: true,
    },
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

  const claimProposalRepository = dependencies.claimProposalRepository || createPostgresClaimProposalRepository();

  const result = await claimProposalRepository.proposeClaimFromEvidenceReviewDecision({
    organizationId: input.organizationId,
    evidenceItemId: input.evidenceItemId,
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(result.error.blockers ? { blockers: result.error.blockers } : {}),
    });
  }
  return { ok: true, data: result.data, error: null, warnings: result.data?.warnings || [] };
}

export const __claimProposalServiceContract = Object.freeze({
  CLAIM_PROPOSAL_OPERATION,
  CLAIM_PROPOSAL_ALLOWED_ROLES,
});
