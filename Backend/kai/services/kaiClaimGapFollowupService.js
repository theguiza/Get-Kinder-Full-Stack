import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresClaimGapFollowupRepository } from "../dictionary/postgresClaimGapFollowupRepository.js";

const CLAIM_GAP_FOLLOWUP_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const CLAIM_GAP_FOLLOWUP_OPERATION = "generate_claim_gap_followups";

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

function isGenerateClaimGapFollowupsInput(value) {
  const allowedKeys = new Set(["organizationId", "claimId", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.claimId) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

/**
 * AUTH-KAI-003 (reapplied from P1-06 through P2-03): claim-gap/client-followup
 * generation may only be performed by a mapped human actor. Every non-human
 * actor type (ai, system, import, code, or any other generic-service actor) is
 * rejected outright - there is no bypass.
 */
function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * KAI P2-04 dormant deterministic claim-gap/client-followup seam.
 *
 * Human-authorized, idempotent generation of `kai.gap_log_items`,
 * `kai.client_followup_items`, and their `client_followup`
 * `kai.review_queue_items` rows, derived only from the already-accepted P2-02
 * read-only evidence-coverage-assessment dimension functions invoked against
 * this package's own transaction-scoped authoritative reads of one already
 * proposed P2-03 `kai.claims` row and its canonical evidence/source lineage.
 * Requires `KAI_SPRINT2_ENABLED` before any repository read, lock, validator
 * side effect, or audit activity - if it is disabled, this returns the
 * canonical `feature_disabled` result with zero repository calls. Like
 * P2-01/P2-02/P2-03, this package has no route, worker, listener, or
 * production composition and so remains dormant under `KAI_SPRINT2_ENABLED`
 * alone; no package-specific feature flag is added.
 *
 * Contains no SQL and imports no database pool: persistence, lineage re-reads,
 * dimension assessment, and every fail-closed validator are delegated entirely
 * to the injected P2-04 repository. Authorization and tenant-membership checks
 * are delegated to the existing shared validator-group mechanisms
 * (`validateActorCanPerformOperation`, `validateTenantBoundaryConsistency`)
 * rather than reimplemented locally.
 */
export async function generateClaimGapFollowups(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isGenerateClaimGapFollowupsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    CLAIM_GAP_FOLLOWUP_OPERATION,
    input.organizationId,
    { allowedRoles: CLAIM_GAP_FOLLOWUP_ALLOWED_ROLES },
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

  const claimGapFollowupRepository = dependencies.claimGapFollowupRepository || createPostgresClaimGapFollowupRepository();

  const result = await claimGapFollowupRepository.generateClaimGapsAndFollowups({
    organizationId: input.organizationId,
    claimId: input.claimId,
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __claimGapFollowupServiceContract = Object.freeze({
  CLAIM_GAP_FOLLOWUP_OPERATION,
  CLAIM_GAP_FOLLOWUP_ALLOWED_ROLES,
});
