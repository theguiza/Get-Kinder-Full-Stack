import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";

const EXPORT_REVIEW_ALLOWED_ROLES = new Set(["gk_admin"]);
const REQUEST_EXPORT_REVIEW_OPERATION = "request_generated_draft_export_review";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIENCES = new Set(["internal", "funder", "public"]);

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  let normalized = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    return false;
  }
  return normalized === value;
}

function isRequestExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "requestedExportAudience",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && AUDIENCES.has(input.requestedExportAudience)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
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

const EXPORT_REVIEW_RESULT_KEYS = new Set([
  "generatedContentDraftId",
  "requestedExportAudience",
  "exportReviewRequestAccepted",
  "replayed",
  "reviewQueueItemId",
  "queueStatus",
  "reviewStatus",
  "validatorResult",
]);

function isRequestExportReviewResultDto(data) {
  if (!hasExactKeys(data, EXPORT_REVIEW_RESULT_KEYS)) return false;
  if (!UUID_PATTERN.test(data.generatedContentDraftId)) return false;
  if (!AUDIENCES.has(data.requestedExportAudience)) return false;
  if (typeof data.exportReviewRequestAccepted !== "boolean") return false;
  if (typeof data.replayed !== "boolean") return false;
  if (!data.validatorResult || typeof data.validatorResult !== "object" || Array.isArray(data.validatorResult)) return false;

  if (data.exportReviewRequestAccepted) {
    if (!UUID_PATTERN.test(data.reviewQueueItemId)) return false;
    if (data.queueStatus !== "open" || data.reviewStatus !== "needs_gk_review") return false;
    return true;
  }
  return data.replayed === false
    && data.reviewQueueItemId === null
    && data.queueStatus === null
    && data.reviewStatus === null;
}

export async function requestGeneratedDraftExportReview(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isRequestExportReviewInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    REQUEST_EXPORT_REVIEW_OPERATION,
    input.organizationId,
    { allowedRoles: EXPORT_REVIEW_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const repository =
    dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.requestGeneratedDraftExportReview(input, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
  if (!isRequestExportReviewResultDto(result.data)) return buildKaiError("system_error", { data: null });
  return { ok: true, data: result.data, error: null };
}

export const __exportReviewServiceContract = Object.freeze({
  EXPORT_REVIEW_ALLOWED_ROLES,
  REQUEST_EXPORT_REVIEW_OPERATION,
});

export const __exportReviewServiceTestables = Object.freeze({
  isRequestExportReviewInput,
  isMappedHumanActor,
  isRequestExportReviewResultDto,
});
