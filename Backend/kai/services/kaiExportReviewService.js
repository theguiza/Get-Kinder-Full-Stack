import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { EXPORT_REVIEW_LIFECYCLE_PROFILES } from "../dictionary/exportReviewQueueContract.js";
import { createProductionMetadataOnlyAuditForGeneratedDraftExportReview } from "./kaiMetadataOnlyAuditComposition.js";

const EXPORT_REVIEW_ALLOWED_ROLES = new Set(["gk_admin"]);
const REQUEST_EXPORT_REVIEW_OPERATION = "request_generated_draft_export_review";
const GET_EXPORT_REVIEW_PACKET_OPERATION = "get_generated_draft_export_review_packet";
const START_EXPORT_REVIEW_OPERATION = "start_generated_draft_export_review";
const COMPLETE_EXPORT_REVIEW_OPERATION = "complete_generated_draft_export_review";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIENCES = new Set(["internal", "funder", "public"]);
const ALLOWED_GENERATED_CONTENT_TYPES = new Set([
  "evidence_summary",
  "impact_narrative",
  "readiness_assessment",
  "data_gap_memo",
  "case_for_support",
  "board_update",
  "annual_report_section",
  "funder_outcome_table",
]);

function stageBlocker(validatorKey, blockingReason) {
  return [{ validator_key: validatorKey, severity: "blocker", blocking_reason: blockingReason }];
}

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

function isCompleteExportReviewInput(input) {
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
  const {
    loadExportManifestIdentityForReviewQueueItemInTransaction,
    loadExportManifestHistoryForReviewQueueItemInTransaction,
  } = await import("../dictionary/postgresExportManifestRepository.js");
  return {
    runInTransaction: withTransaction,
    evaluatePacket: evaluateGeneratedDraftExportReviewPacketInTransaction,
    evaluator: evaluateClaimTraceabilityInTransaction,
    loadManifestIdentity: loadExportManifestIdentityForReviewQueueItemInTransaction,
    loadManifestHistory: loadExportManifestHistoryForReviewQueueItemInTransaction,
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

const COMPLETE_EXPORT_REVIEW_RESULT_KEYS = new Set([
  "generatedContentDraftId",
  "exportReviewQueueItemId",
  "queueStatus",
  "reviewStatus",
  "replayed",
]);

function isCompleteExportReviewResultDto(data) {
  if (!hasExactKeys(data, COMPLETE_EXPORT_REVIEW_RESULT_KEYS)) return false;
  if (!UUID_PATTERN.test(data.generatedContentDraftId)) return false;
  if (!UUID_PATTERN.test(data.exportReviewQueueItemId)) return false;
  if (data.queueStatus !== "resolved" || data.reviewStatus !== "resolved") return false;
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
  "limitationSnapshotConfirmed",
  "candidateReadyToPrepare",
  "validatorResult",
  "blocks",
  "exportReviewUpdatedAt",
]);
const BLOCK_KEYS = new Set(["ordinal", "text", "citations"]);
const BLOCK_KEYS_WITH_ID = new Set(["generatedContentBlockId", ...BLOCK_KEYS]);
const CITATION_KEYS = new Set([
  "claimId",
  "evidenceItemId",
  "sourceId",
  "sourceCode",
  "sourceVersionId",
  "supportStrength",
  "claimReviewStatus",
  "evidenceReviewStatus",
  "currentEligible",
  "blockerCodes",
  "affectedDimensionKeys",
  "affectedObjectIds",
  "approvedAudiences",
]);
const CITATION_KEYS_WITH_ID = new Set(["generatedContentCitationId", ...CITATION_KEYS]);
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

// Durable read recovery (P3-20 binding): the packet this page loads on
// mount/reload gains one new, optional field beyond the accepted
// EXPORT_REVIEW_PACKET_KEYS shape - exportManifestId - populated only from
// the exact P3-20 FK'd relationship, never re-derived, never a latest/
// current/timestamp selection. It is null whenever no exact single
// governed finalization is recoverable for this review item (none exists
// yet, or more than one exists and picking between them is not this
// package's decision to make). It is kept, unchanged, only for backend
// compatibility with the existing frontend read path (not modified by this
// package) - it is NOT authoritative history.
//
// Exact export-manifest history (read-model cardinality repair): the
// authoritative field is the plural exportManifestHistory - every manifest
// legitimately bound to this review item, in presentation order only
// (created_at ASC, exportManifestId ASC - never a currentness signal).
// 0 manifests -> []; N manifests -> all N exact identities. No entry is
// ever dropped because more than one exists.
const EXPORT_MANIFEST_HISTORY_ENTRY_KEYS = new Set(["exportManifestId", "exportCandidateId", "createdAt"]);

function isExportManifestHistoryEntryDto(entry) {
  if (!hasExactKeys(entry, EXPORT_MANIFEST_HISTORY_ENTRY_KEYS)) return false;
  if (!UUID_PATTERN.test(entry.exportManifestId)) return false;
  if (!UUID_PATTERN.test(entry.exportCandidateId)) return false;
  return isCanonicalUtcTimestamp(entry.createdAt);
}

function isExportManifestHistoryDto(value) {
  return Array.isArray(value) && value.every(isExportManifestHistoryEntryDto);
}

const EXPORT_REVIEW_PACKET_WITH_MANIFEST_KEYS = new Set([
  ...EXPORT_REVIEW_PACKET_KEYS,
  "exportManifestId",
  "exportManifestHistory",
]);

function isGeneratedDraftExportReviewPacketWithManifestDto(data) {
  if (!hasExactKeys(data, EXPORT_REVIEW_PACKET_WITH_MANIFEST_KEYS)) return false;
  if (!(data.exportManifestId === null || UUID_PATTERN.test(data.exportManifestId))) return false;
  if (!isExportManifestHistoryDto(data.exportManifestHistory)) return false;
  const { exportManifestId, exportManifestHistory, ...innerPacket } = data;
  return isGeneratedDraftExportReviewPacketDto(innerPacket);
}

function isGeneratedDraftExportReviewPacketDto(data) {
  if (!hasExactKeys(data, EXPORT_REVIEW_PACKET_KEYS)) return false;
  if (!UUID_PATTERN.test(data.generationRunId)) return false;
  if (!UUID_PATTERN.test(data.generatedContentDraftId)) return false;
  if (!ALLOWED_GENERATED_CONTENT_TYPES.has(data.contentType)) return false;
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
  if (typeof data.limitationSnapshotConfirmed !== "boolean") return false;
  if (typeof data.candidateReadyToPrepare !== "boolean") return false;
  if (!isValidatorResultDto(data.validatorResult, data.generatedContentDraftId)) return false;
  if (data.exportEligible !== (data.validatorResult.severity === "pass")) return false;
  // exportEligible reflects the FULL VAL-EXP-001 gate set (including
  // finalGate/affirmative human authority, which are always evaluated false
  // pre-candidate) and is therefore always false on this packet - it is
  // informational only here, not a precondition for candidateReadyToPrepare.
  // candidateReadyToPrepare instead reflects genuine pre-candidate readiness:
  // export-review resolution, a current limitation snapshot, an authorized
  // content type, and no VAL-EXP-001 gate failing other than the ones that
  // are expected-absent before a candidate/authority exist (see
  // EXPORT_REVIEW_READINESS_FAILED_GATES in postgresGeneratedContentRepository.js).
  if (!Array.isArray(data.blocks) || data.blocks.length < 1 || data.blocks.length > 20) return false;
  for (const [index, block] of data.blocks.entries()) {
    const blockHasId = Object.prototype.hasOwnProperty.call(block, "generatedContentBlockId");
    if (!hasExactKeys(block, blockHasId ? BLOCK_KEYS_WITH_ID : BLOCK_KEYS)) return false;
    if (blockHasId && !UUID_PATTERN.test(block.generatedContentBlockId)) return false;
    if (block.ordinal !== index + 1) return false;
    if (typeof block.text !== "string" || block.text.length < 1 || block.text.length > 4000) return false;
    if (!Array.isArray(block.citations) || block.citations.length < 1) return false;
    for (const citation of block.citations) {
      const citationHasId = Object.prototype.hasOwnProperty.call(citation, "generatedContentCitationId");
      if (!hasExactKeys(citation, citationHasId ? CITATION_KEYS_WITH_ID : CITATION_KEYS)) return false;
      if (citationHasId && !UUID_PATTERN.test(citation.generatedContentCitationId)) return false;
      if (!UUID_PATTERN.test(citation.claimId) || !UUID_PATTERN.test(citation.evidenceItemId)) return false;
      if (!UUID_PATTERN.test(citation.sourceId) || !UUID_PATTERN.test(citation.sourceVersionId)) return false;
      if (citation.sourceCode !== null && typeof citation.sourceCode !== "string") return false;
      if (typeof citation.supportStrength !== "string") return false;
      if (typeof citation.claimReviewStatus !== "string" || typeof citation.evidenceReviewStatus !== "string") return false;
      if (typeof citation.currentEligible !== "boolean") return false;
      if (!isStringArray(citation.blockerCodes)) return false;
      if (!isStringArray(citation.affectedDimensionKeys)) return false;
      if (!isStringArray(citation.affectedObjectIds)) return false;
      if (citation.approvedAudiences !== null) {
        if (!isStringArray(citation.approvedAudiences)) return false;
        if (!citation.approvedAudiences.every((value) => AUDIENCES.has(value))) return false;
      }
    }
  }
  if (!isCanonicalUtcTimestamp(data.exportReviewUpdatedAt)) return false;
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

  const metadataOnlyAudit =
    dependencies.metadataOnlyAudit
    || createProductionMetadataOnlyAuditForGeneratedDraftExportReview({
      organizationId: input.organizationId,
      generatedContentDraftId: input.generatedContentDraftId,
      actorContext: input.actorContext,
      now: input.now,
      route: "/api/kai/sprint2/intake/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-request",
    });

  const result = await repository.requestGeneratedDraftExportReview(input, {
    metadataOnlyAudit,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      blockers: result.blockers,
      data: null,
    });
  }
  if (!isRequestExportReviewResultDto(result.data)) return buildKaiError("system_error", { data: null });
  return { ok: true, data: result.data, error: null };
}

export async function startGeneratedDraftExportReview(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isStartExportReviewInput(input)) {
    return buildKaiError("validation_blocker", {
      blockers: stageBlocker("VAL-EXP-002", "export_review_start_request_shape_invalid"),
      data: null,
    });
  }
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

  const metadataOnlyAudit =
    dependencies.metadataOnlyAudit
    || createProductionMetadataOnlyAuditForGeneratedDraftExportReview({
      organizationId: input.organizationId,
      generatedContentDraftId: input.generatedContentDraftId,
      actorContext: input.actorContext,
      now: input.now,
      route: "/api/kai/sprint2/intake/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/start",
    });

  const result = await repository.startGeneratedDraftExportReview(input, {
    metadataOnlyAudit,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      blockers: result.blockers,
      data: null,
    });
  }
  if (!isStartExportReviewResultDto(result.data)) return buildKaiError("system_error", { data: null });
  return { ok: true, data: result.data, error: null };
}

export async function completeGeneratedDraftExportReview(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isCompleteExportReviewInput(input)) {
    return buildKaiError("validation_blocker", {
      blockers: stageBlocker("VAL-EXP-003", "export_review_complete_request_shape_invalid"),
      data: null,
    });
  }
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    COMPLETE_EXPORT_REVIEW_OPERATION,
    input.organizationId,
    { allowedRoles: EXPORT_REVIEW_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const repository =
    dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());

  const metadataOnlyAudit =
    dependencies.metadataOnlyAudit
    || createProductionMetadataOnlyAuditForGeneratedDraftExportReview({
      organizationId: input.organizationId,
      generatedContentDraftId: input.generatedContentDraftId,
      actorContext: input.actorContext,
      now: input.now,
      route: "/api/kai/sprint2/intake/admin/organizations/:organizationId/generated-content-drafts/:generatedContentDraftId/export-review-queue/:exportReviewQueueItemId/complete",
    });

  const result = await repository.completeGeneratedDraftExportReview(input, {
    metadataOnlyAudit,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      blockers: result.blockers,
      data: null,
    });
  }
  if (!isCompleteExportReviewResultDto(result.data)) return buildKaiError("system_error", { data: null });
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

  const needsDefaults = !dependencies.runInTransaction
    || !dependencies.evaluatePacket
    || !dependencies.evaluator
    || !dependencies.loadManifestIdentity
    || !dependencies.loadManifestHistory;
  const defaults = needsDefaults ? await createDefaultExportReviewPacketDependencies() : null;
  const runInTransaction = dependencies.runInTransaction || defaults.runInTransaction;
  const evaluatePacket = dependencies.evaluatePacket || defaults.evaluatePacket;
  const evaluator = dependencies.evaluator || defaults.evaluator;
  const loadManifestIdentity = dependencies.loadManifestIdentity || defaults.loadManifestIdentity;
  const loadManifestHistory = dependencies.loadManifestHistory || defaults.loadManifestHistory;

  let packetResult;
  let manifestIdentity;
  let manifestHistory;
  try {
    packetResult = await runInTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const inner = await evaluatePacket(tx, {
        organizationId: input.organizationId,
        generatedContentDraftId: input.generatedContentDraftId,
        exportReviewQueueItemId: input.exportReviewQueueItemId,
      }, evaluator);
      if (!inner?.ok) return inner;
      // Durable read recovery (P3-20 binding), same read-only transaction as
      // the unchanged packet composition above - never a separate best-
      // effort follow-up, and only reached once that composition itself
      // succeeds.
      manifestIdentity = await loadManifestIdentity(tx, {
        organizationId: input.organizationId,
        exportReviewQueueItemId: input.exportReviewQueueItemId,
      });
      // Exact export-manifest history (read-model cardinality repair): same
      // read-only transaction, same reachability rule as manifestIdentity
      // above - every legitimate historical manifest, never a guess.
      manifestHistory = await loadManifestHistory(tx, {
        organizationId: input.organizationId,
        exportReviewQueueItemId: input.exportReviewQueueItemId,
      });
      return inner;
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
  const projected = {
    ...packetResult.data,
    exportManifestId: manifestIdentity?.exportManifestId ?? null,
    exportManifestHistory: manifestHistory?.exportManifestHistory ?? [],
  };
  if (!isGeneratedDraftExportReviewPacketWithManifestDto(projected)) {
    return buildKaiError("system_error", { data: null });
  }
  return { ok: true, data: projected, error: null };
}

export const __exportReviewServiceContract = Object.freeze({
  EXPORT_REVIEW_ALLOWED_ROLES,
  REQUEST_EXPORT_REVIEW_OPERATION,
  GET_EXPORT_REVIEW_PACKET_OPERATION,
  START_EXPORT_REVIEW_OPERATION,
  COMPLETE_EXPORT_REVIEW_OPERATION,
});

export const __exportReviewServiceTestables = Object.freeze({
  isRequestExportReviewInput,
  isGeneratedDraftExportReviewPacketInput,
  isStartExportReviewInput,
  isCompleteExportReviewInput,
  isMappedHumanActor,
  isRequestExportReviewResultDto,
  isGeneratedDraftExportReviewPacketDto,
  isGeneratedDraftExportReviewPacketWithManifestDto,
  isExportManifestHistoryDto,
  isStartExportReviewResultDto,
  isCompleteExportReviewResultDto,
});
