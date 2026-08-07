import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { EXPORT_REVIEW_LIFECYCLE_PROFILES } from "../dictionary/exportReviewQueueContract.js";

const EXPORT_REVIEW_ALLOWED_ROLES = new Set(["gk_admin"]);
const REQUEST_EXPORT_REVIEW_OPERATION = "request_generated_draft_export_review";
const GET_EXPORT_REVIEW_PACKET_OPERATION = "get_generated_draft_export_review_packet";
const START_EXPORT_REVIEW_OPERATION = "start_generated_draft_export_review";
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

function isGeneratedDraftExportReviewPacketInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "exportReviewQueueItemId",
    "actorContext",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function isStartExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "generatedContentDraftId",
    "exportReviewQueueItemId",
    "expectedUpdatedAt",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
    && isCanonicalUtcTimestamp(input.expectedUpdatedAt)
    && isCanonicalUtcTimestamp(input.now)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
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

async function createDefaultExportReviewPacketDependencies() {
  const { withTransaction } = await import("../db/kaiDb.js");
  const {
    evaluateGeneratedDraftExportReviewPacketInTransaction,
  } = await import("../dictionary/postgresGeneratedContentRepository.js");
  const { evaluateClaimTraceabilityInTransaction } = await import(
    "../dictionary/postgresClaimTraceabilityRepository.js"
  );
  return {
    runInTransaction: withTransaction,
    evaluatePacket: evaluateGeneratedDraftExportReviewPacketInTransaction,
    evaluator: evaluateClaimTraceabilityInTransaction,
  };
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

const START_EXPORT_REVIEW_RESULT_KEYS = new Set([
  "generatedContentDraftId",
  "exportReviewQueueItemId",
  "queueStatus",
  "reviewStatus",
  "replayed",
]);

function isStartExportReviewResultDto(data) {
  if (!hasExactKeys(data, START_EXPORT_REVIEW_RESULT_KEYS)) return false;
  if (!UUID_PATTERN.test(data.generatedContentDraftId)) return false;
  if (!UUID_PATTERN.test(data.exportReviewQueueItemId)) return false;
  if (data.queueStatus !== "in_progress" || data.reviewStatus !== "needs_gk_review") return false;
  return typeof data.replayed === "boolean";
}

const EXPORT_REVIEW_PACKET_KEYS = new Set([
  "generationRunId",
  "generatedContentDraftId",
  "contentType",
  "draftStatus",
  "requestedExportAudience",
  "generatedContentReviewQueueStatus",
  "generatedContentReviewStatus",
  "exportReviewQueueItemId",
  "exportReviewQueueStatus",
  "exportReviewStatus",
  "currentUseEligible",
  "exportEligible",
  "validatorResult",
  "blocks",
]);
const BLOCK_KEYS = new Set(["ordinal", "text", "citations"]);
const CITATION_KEYS = new Set([
  "claimId",
  "evidenceItemId",
  "sourceId",
  "sourceVersionId",
  "supportStrength",
  "claimReviewStatus",
  "evidenceReviewStatus",
  "currentEligible",
  "blockerCodes",
  "affectedDimensionKeys",
  "affectedObjectIds",
]);
const VALIDATOR_RESULT_KEYS = new Set([
  "validator_key",
  "severity",
  "object_type",
  "object_code",
  "object_id",
  "message",
  "blocking_reason",
  "required_fix",
  "evidence",
]);

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidatorResultDto(value, generatedContentDraftId) {
  if (!hasExactKeys(value, VALIDATOR_RESULT_KEYS)) return false;
  if (value.validator_key !== "VAL-EXP-001") return false;
  if (!["pass", "blocker", "warning"].includes(value.severity)) return false;
  if (value.object_type !== "generated_content_draft") return false;
  if (value.object_code !== "export_manifest_eligibility") return false;
  if (value.object_id !== generatedContentDraftId) return false;
  if (typeof value.message !== "string") return false;
  if (!(value.blocking_reason === null || typeof value.blocking_reason === "string")) return false;
  if (!(value.required_fix === null || typeof value.required_fix === "string")) return false;
  return Boolean(value.evidence) && typeof value.evidence === "object" && !Array.isArray(value.evidence);
}

function isGeneratedDraftExportReviewPacketDto(data) {
  if (!hasExactKeys(data, EXPORT_REVIEW_PACKET_KEYS)) return false;
  if (!UUID_PATTERN.test(data.generationRunId)) return false;
  if (!UUID_PATTERN.test(data.generatedContentDraftId)) return false;
  if (data.contentType !== "evidence_summary") return false;
  if (data.draftStatus !== "draft") return false;
  if (!AUDIENCES.has(data.requestedExportAudience)) return false;
  if (data.generatedContentReviewQueueStatus !== "resolved") return false;
  if (data.generatedContentReviewStatus !== "resolved") return false;
  if (!UUID_PATTERN.test(data.exportReviewQueueItemId)) return false;
  if (!EXPORT_REVIEW_LIFECYCLE_PROFILES.some(
    (profile) => data.exportReviewQueueStatus === profile.queueStatus && data.exportReviewStatus === profile.reviewStatus,
  )) return false;
  if (typeof data.currentUseEligible !== "boolean") return false;
  if (typeof data.exportEligible !== "boolean") return false;
  if (!isValidatorResultDto(data.validatorResult, data.generatedContentDraftId)) return false;
  if (data.exportEligible !== (data.validatorResult.severity === "pass")) return false;
  if (!Array.isArray(data.blocks) || data.blocks.length < 1 || data.blocks.length > 20) return false;
  for (const [index, block] of data.blocks.entries()) {
    if (!hasExactKeys(block, BLOCK_KEYS)) return false;
    if (block.ordinal !== index + 1) return false;
    if (typeof block.text !== "string" || block.text.length < 1 || block.text.length > 4000) return false;
    if (!Array.isArray(block.citations) || block.citations.length < 1) return false;
    for (const citation of block.citations) {
      if (!hasExactKeys(citation, CITATION_KEYS)) return false;
      if (!UUID_PATTERN.test(citation.claimId) || !UUID_PATTERN.test(citation.evidenceItemId)) return false;
      if (!UUID_PATTERN.test(citation.sourceId) || !UUID_PATTERN.test(citation.sourceVersionId)) return false;
      if (typeof citation.supportStrength !== "string") return false;
      if (typeof citation.claimReviewStatus !== "string" || typeof citation.evidenceReviewStatus !== "string") return false;
      if (typeof citation.currentEligible !== "boolean") return false;
      if (!isStringArray(citation.blockerCodes)) return false;
      if (!isStringArray(citation.affectedDimensionKeys)) return false;
      if (!isStringArray(citation.affectedObjectIds)) return false;
    }
  }
  return true;
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

export async function startGeneratedDraftExportReview(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isStartExportReviewInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    START_EXPORT_REVIEW_OPERATION,
    input.organizationId,
    { allowedRoles: EXPORT_REVIEW_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const repository =
    dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.startGeneratedDraftExportReview(input, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
  if (!isStartExportReviewResultDto(result.data)) return buildKaiError("system_error", { data: null });
  return { ok: true, data: result.data, error: null };
}

export async function getGeneratedDraftExportReviewPacket(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isGeneratedDraftExportReviewPacketInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    GET_EXPORT_REVIEW_PACKET_OPERATION,
    input.organizationId,
    { allowedRoles: EXPORT_REVIEW_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const needsDefaults = !dependencies.runInTransaction || !dependencies.evaluatePacket || !dependencies.evaluator;
  const defaults = needsDefaults ? await createDefaultExportReviewPacketDependencies() : null;
  const runInTransaction = dependencies.runInTransaction || defaults.runInTransaction;
  const evaluatePacket = dependencies.evaluatePacket || defaults.evaluatePacket;
  const evaluator = dependencies.evaluator || defaults.evaluator;

  let packetResult;
  try {
    packetResult = await runInTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return evaluatePacket(tx, {
        organizationId: input.organizationId,
        generatedContentDraftId: input.generatedContentDraftId,
        exportReviewQueueItemId: input.exportReviewQueueItemId,
      }, evaluator);
    });
  } catch (error) {
    return buildKaiError(error?.code === "22P02" ? "validation_blocker" : "system_error", { data: null });
  }

  if (!packetResult?.ok) {
    const code = packetResult?.error?.code === "not_found" ? "not_found" : "conflict_current_state_changed";
    return buildKaiError(code, { data: null });
  }
  if (!isGeneratedDraftExportReviewPacketDto(packetResult.data)) {
    return buildKaiError("system_error", { data: null });
  }
  return { ok: true, data: packetResult.data, error: null };
}

export const __exportReviewServiceContract = Object.freeze({
  EXPORT_REVIEW_ALLOWED_ROLES,
  REQUEST_EXPORT_REVIEW_OPERATION,
  GET_EXPORT_REVIEW_PACKET_OPERATION,
  START_EXPORT_REVIEW_OPERATION,
});

export const __exportReviewServiceTestables = Object.freeze({
  isRequestExportReviewInput,
  isGeneratedDraftExportReviewPacketInput,
  isStartExportReviewInput,
  isMappedHumanActor,
  isRequestExportReviewResultDto,
  isGeneratedDraftExportReviewPacketDto,
  isStartExportReviewResultDto,
});
