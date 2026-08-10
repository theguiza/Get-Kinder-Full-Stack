import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresEvidenceLineageRepository } from "../dictionary/postgresEvidenceLineageRepository.js";

const EVIDENCE_LINEAGE_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const EVIDENCE_LINEAGE_OPERATION = "extract_evidence_lineage";

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

function isExtractEvidenceFromSourceVersionInput(value) {
  const allowedKeys = new Set(["organizationId", "sourceVersionId", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.sourceVersionId) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

/**
 * AUTH-KAI-003 (reapplied from P1-06/P1-07/P1-08): P2-01 evidence-lineage
 * extraction may only be performed by a mapped human actor. Every non-human actor
 * type (ai, system, import, code, or any other generic-service actor) is rejected
 * outright - there is no bypass.
 */
function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * KAI P2-01 dormant deterministic evidence-lineage extraction seam.
 *
 * Human-authorized, idempotent extraction of one deterministic
 * `dictionary_field_presence_fact` evidence statement per already-committed
 * `kai.data_dictionary_fields` row from the CURRENT `kai.source_versions` row of a
 * fully promoted P1-08 source, each fact bound to a `kai.source_locators` 'column'
 * coordinate, each evidence item paired with exactly one open `evidence_review`
 * `kai.review_queue_items` row. Requires `KAI_SPRINT2_ENABLED` before any
 * repository read, lock, validator side effect, or audit activity - if it is
 * disabled, this returns the canonical `feature_disabled` result with zero
 * repository calls. P2-01C correction: this package's own
 * `KAI_EVIDENCE_LINEAGE_ENABLED` flag has been removed; P2-01 has no route,
 * worker, listener, or production composition and so remains dormant under
 * `KAI_SPRINT2_ENABLED` alone, exactly like every other still-unwired P2 package.
 * It is not composed into any route, listener, scheduler, or production path.
 *
 * Contains no SQL and imports no database pool: persistence, lineage re-reads, and
 * every fail-closed validator are delegated entirely to the injected P2-01
 * repository. Authorization and tenant-membership checks are delegated to the
 * existing shared validator-group mechanisms (`validateActorCanPerformOperation`,
 * `validateTenantBoundaryConsistency`) rather than reimplemented locally.
 */
export async function extractEvidenceFromSourceVersion(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isExtractEvidenceFromSourceVersionInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    EVIDENCE_LINEAGE_OPERATION,
    input.organizationId,
    { allowedRoles: EVIDENCE_LINEAGE_ALLOWED_ROLES },
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

  const evidenceLineageRepository = dependencies.evidenceLineageRepository || createPostgresEvidenceLineageRepository();

  const result = await evidenceLineageRepository.extractEvidenceFromSourceVersion({
    organizationId: input.organizationId,
    sourceVersionId: input.sourceVersionId,
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __evidenceLineageServiceContract = Object.freeze({
  EVIDENCE_LINEAGE_OPERATION,
  EVIDENCE_LINEAGE_ALLOWED_ROLES,
});
