import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateExportManifestEligibility } from "../validators/kaiExportManifestEligibilityValidators.js";
import { GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES } from "../dictionary/generatedContentReviewQueueContract.js";

const EXPORT_ELIGIBILITY_ALLOWED_ROLES = new Set(["gk_admin"]);
const EVALUATE_EXPORT_ELIGIBILITY_OPERATION = "evaluate_generated_draft_export_eligibility";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIENCES = new Set(["internal", "funder", "public"]);

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isEvaluateExportEligibilityInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "generatedContentDraftId", "requestedExportAudience", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.generatedContentDraftId)
    && AUDIENCES.has(input.requestedExportAudience)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

async function createDefaultDependencies() {
  const { withTransaction } = await import("../db/kaiDb.js");
  const { evaluateGeneratedDraftReviewPacketInTransaction } = await import(
    "../dictionary/postgresGeneratedContentRepository.js"
  );
  const { evaluateClaimTraceabilityInTransaction } = await import(
    "../dictionary/postgresClaimTraceabilityRepository.js"
  );
  return {
    runInTransaction: withTransaction,
    evaluatePacket: evaluateGeneratedDraftReviewPacketInTransaction,
    evaluator: evaluateClaimTraceabilityInTransaction,
  };
}

const PACKET_FAILURE_TO_SERVICE_CODE = Object.freeze({
  not_found: "not_found",
});

export async function evaluateGeneratedDraftExportEligibility(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isEvaluateExportEligibilityInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    EVALUATE_EXPORT_ELIGIBILITY_OPERATION,
    input.organizationId,
    { allowedRoles: EXPORT_ELIGIBILITY_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const needsDefaults = !dependencies.runInTransaction || !dependencies.evaluatePacket || !dependencies.evaluator;
  const defaults = needsDefaults ? await createDefaultDependencies() : null;
  const runInTransaction = dependencies.runInTransaction || defaults.runInTransaction;
  const evaluatePacket = dependencies.evaluatePacket || defaults.evaluatePacket;
  const evaluator = dependencies.evaluator || defaults.evaluator;

  let packetResult;
  try {
    packetResult = await runInTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return evaluatePacket(
        tx,
        { organizationId: input.organizationId, generatedContentDraftId: input.generatedContentDraftId },
        evaluator,
        { allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES },
      );
    });
  } catch (error) {
    if (error?.name === "RollbackResultError" && error.result) {
      packetResult = error.result;
    } else {
      return buildKaiError("system_error", { data: null });
    }
  }

  if (!packetResult?.ok) {
    const code = PACKET_FAILURE_TO_SERVICE_CODE[packetResult?.error?.code] || "conflict_current_state_changed";
    return buildKaiError(code, { data: null });
  }

  const packet = packetResult.data;
  const validatorResult = validateExportManifestEligibility({
    generatedContentDraftId: packet.generatedContentDraftId,
    requestedExportAudience: input.requestedExportAudience,
    draftAudience: packet.requestedAudience,
    draftIsStillDraft: packet.draftStatus === "draft",
    reviewIsResolved: packet.queueStatus === "resolved" && packet.reviewStatus === "resolved",
    currentUseEligible: packet.currentUseEligible === true,
    finalGate: false,
    affirmativeHumanExportAuthority: false,
  });

  return {
    ok: true,
    data: {
      generatedContentDraftId: packet.generatedContentDraftId,
      requestedExportAudience: input.requestedExportAudience,
      exportEligible: validatorResult.severity === "pass",
      validatorResult,
      reviewQueueItemId: packet.reviewQueueItemId,
      draftStatus: packet.draftStatus,
      queueStatus: packet.queueStatus,
      reviewStatus: packet.reviewStatus,
      currentUseEligible: packet.currentUseEligible,
    },
    error: null,
  };
}

export const __exportEligibilityServiceContract = Object.freeze({
  EXPORT_ELIGIBILITY_ALLOWED_ROLES,
  EVALUATE_EXPORT_ELIGIBILITY_OPERATION,
});

export const __exportEligibilityServiceTestables = Object.freeze({
  isEvaluateExportEligibilityInput,
  isMappedHumanActor,
});
