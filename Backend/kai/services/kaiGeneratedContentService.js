import {
  areKaiSprint2GenerationFeaturesEnabled,
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

const GENERATED_CONTENT_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const CREATE_EVIDENCE_SUMMARY_OPERATION = "create_evidence_summary_draft";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIENCES = new Set(["internal", "funder", "public"]);

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isCreateEvidenceSummaryDraftInput(input) {
  if (!hasExactKeys(input, new Set(["organizationId", "requestedAudience", "claimIds", "idempotencyKey", "actorContext", "now"]))) {
    return false;
  }
  let normalizedNow = null;
  try {
    normalizedNow = new Date(input.now).toISOString();
  } catch {
    return false;
  }
  return UUID_PATTERN.test(input.organizationId)
    && AUDIENCES.has(input.requestedAudience)
    && Array.isArray(input.claimIds)
    && input.claimIds.length >= 1
    && input.claimIds.every((claimId) => typeof claimId === "string" && UUID_PATTERN.test(claimId))
    && input.claimIds.length === new Set(input.claimIds).size
    && input.claimIds.every((claimId, index, arr) => index === 0 || arr[index - 1] < claimId)
    && typeof input.idempotencyKey === "string"
    && input.idempotencyKey === input.idempotencyKey.trim()
    && /^[ -~]{8,128}$/.test(input.idempotencyKey)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && typeof input.now === "string"
    && normalizedNow === input.now;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

async function createDefaultGeneratedContentRepository() {
  const { createPostgresGeneratedContentRepository } = await import(
    "../dictionary/postgresGeneratedContentRepository.js"
  );
  return createPostgresGeneratedContentRepository();
}

export async function createEvidenceSummaryDraft(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
  if (!isKaiGenerationEnabled(env) || !areKaiSprint2GenerationFeaturesEnabled(env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCreateEvidenceSummaryDraftInput(input)) {
    return buildKaiError("validation_blocker");
  }
  if (!isMappedHumanActor(input.actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CREATE_EVIDENCE_SUMMARY_OPERATION,
    input.organizationId,
    { allowedRoles: GENERATED_CONTENT_ALLOWED_ROLES },
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

  const repository =
    dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.createEvidenceSummaryDraft(input, {
    draftGenerator: dependencies.draftGenerator,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status });
  return { ok: true, data: result.data, error: null };
}

export const __generatedContentServiceContract = Object.freeze({
  GENERATED_CONTENT_ALLOWED_ROLES,
  CREATE_EVIDENCE_SUMMARY_OPERATION,
});
