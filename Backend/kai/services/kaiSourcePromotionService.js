import { areKaiSprint2SourcePromotionFeaturesEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresSourcePromotionRepository } from "../dictionary/postgresSourcePromotionRepository.js";

const SOURCE_PROMOTION_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const SOURCE_PROMOTION_OPERATION = "create_source_promotion_decision";

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

function isCreateSourcePromotionDecisionInput(value) {
  const allowedKeys = new Set(["organizationId", "intakeSourceCandidateId", "reviewedSourceType", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.intakeSourceCandidateId) &&
    isNonEmptyString(value.reviewedSourceType) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

/**
 * AUTH-KAI-003 (reapplied from P1-06/P1-07): a P1-08 promotion decision may only
 * be created by a mapped human actor. Every non-human actor type (ai, system,
 * import, code, or any other generic-service actor) is rejected outright - there
 * is no bypass. A resolved review item is never itself promotion authority: this
 * gate, plus the shared tenant-membership/role check below, is what establishes
 * that an eligible decision was made by an authorized mapped human with active
 * tenant membership, before the repository's own fail-closed validators run.
 */
function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * KAI P1-08 dormant source-promotion seam.
 *
 * Human-authorized creation of exactly one `kai.intake_promotion_decisions` row
 * for a complete, immutable P1-07 candidate/review pair, compounded atomically
 * with deterministic `kai.sources`/`kai.source_versions` creation-or-authoritative-
 * replay and the candidate's/review item's required transitions. Requires both
 * `KAI_SPRINT2_ENABLED` and `KAI_SOURCE_PROMOTION_ENABLED` before any repository
 * read, lock, validator side effect, or audit activity - if either flag is
 * disabled, this returns the canonical `feature_disabled` result with zero
 * repository calls. It is not composed into any route, listener, scheduler, or
 * production path.
 *
 * Contains no SQL and imports no database pool: persistence, lineage re-reads, and
 * every fail-closed validator are delegated entirely to the injected P1-08
 * repository. Authorization and tenant-membership checks are delegated to the
 * existing shared validator-group mechanisms (`validateActorCanPerformOperation`,
 * `validateTenantBoundaryConsistency`) rather than reimplemented locally; their
 * structured blockers are preserved on the returned error.
 */
export async function createSourcePromotionDecision(input, dependencies = {}) {
  if (!areKaiSprint2SourcePromotionFeaturesEnabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCreateSourcePromotionDecisionInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    SOURCE_PROMOTION_OPERATION,
    input.organizationId,
    { allowedRoles: SOURCE_PROMOTION_ALLOWED_ROLES },
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

  const sourcePromotionRepository = dependencies.sourcePromotionRepository || createPostgresSourcePromotionRepository();

  const result = await sourcePromotionRepository.createSourcePromotionDecision({
    identity: {
      organizationId: input.organizationId,
      intakeSourceCandidateId: input.intakeSourceCandidateId,
    },
    reviewedSourceType: input.reviewedSourceType,
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __sourcePromotionServiceContract = Object.freeze({
  SOURCE_PROMOTION_OPERATION,
  SOURCE_PROMOTION_ALLOWED_ROLES,
});
