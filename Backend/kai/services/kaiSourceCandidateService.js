import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresSourceCandidateRepository } from "../dictionary/postgresSourceCandidateRepository.js";

const SOURCE_CANDIDATE_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const SOURCE_CANDIDATE_OPERATION = "create_source_candidate_stub";

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

function isCreateSourceCandidateStubInput(value) {
  const allowedKeys = new Set(["organizationId", "intakeSensitivityProfileId", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.intakeSensitivityProfileId) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

/**
 * AUTH-KAI-003 (reapplied from P1-06): a P1-07 source-candidate stub may only be
 * created by a mapped human actor. Every non-human actor type (ai, system, import,
 * code, or any other generic-service actor) is rejected outright - there is no
 * bypass. Kept local for the same reason P1-06 keeps it local: it is strictly
 * narrower than the shared assistant-boundary validator's recognized non-human
 * actor-type set.
 */
function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * KAI P1-07 dormant source-candidate creation seam.
 *
 * Idempotent creation of exactly one metadata-only `kai.intake_source_candidates`
 * stub, plus its corresponding `source_candidate_review` `kai.review_queue_items`
 * row, for an existing, tenant-scoped, committed P1-05
 * `kai.intake_sensitivity_profiles` row that satisfies the VAL-KAI-P1-07-001
 * creation-trigger predicate (human review required and public/funder/LLM/
 * product-learning use all still denied, retention still restricted pending
 * review). This never creates a source, source_version, evidence, claim, or any
 * promotion/approval record, and it never transitions candidate_status beyond
 * null -> 'needs_gk_review'. It is not composed into any route, listener,
 * scheduler, or production path.
 *
 * Contains no SQL and imports no database pool: persistence is delegated entirely
 * to the injected P1-07 source-candidate repository. Authorization and
 * tenant-membership checks are delegated to the existing shared validator-group
 * mechanisms (`validateActorCanPerformOperation`, `validateTenantBoundaryConsistency`)
 * rather than reimplemented locally; their structured blockers are preserved on the
 * returned error.
 */
export async function createSourceCandidateStub(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCreateSourceCandidateStubInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    SOURCE_CANDIDATE_OPERATION,
    input.organizationId,
    { allowedRoles: SOURCE_CANDIDATE_ALLOWED_ROLES },
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

  const sourceCandidateRepository = dependencies.sourceCandidateRepository || createPostgresSourceCandidateRepository();

  const result = await sourceCandidateRepository.createSourceCandidateStub({
    identity: {
      organizationId: input.organizationId,
      intakeSensitivityProfileId: input.intakeSensitivityProfileId,
    },
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __sourceCandidateServiceContract = Object.freeze({
  SOURCE_CANDIDATE_OPERATION,
  SOURCE_CANDIDATE_ALLOWED_ROLES,
});
