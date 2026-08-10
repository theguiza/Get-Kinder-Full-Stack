import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresClaimProposalRepository } from "../dictionary/postgresClaimProposalRepository.js";

const CLAIM_PROPOSAL_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
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
    return buildKaiError("tenant_boundary_violation", { blockers: auth.blockers });
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
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null, warnings: result.data?.warnings || [] };
}

export const __claimProposalServiceContract = Object.freeze({
  CLAIM_PROPOSAL_OPERATION,
  CLAIM_PROPOSAL_ALLOWED_ROLES,
});
