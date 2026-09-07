import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateExportManifestEligibility } from "../validators/kaiExportManifestEligibilityValidators.js";

const FINAL_EXPORT_ELIGIBILITY_ALLOWED_ROLES = new Set(["gk_admin"]);
const EVALUATE_FINAL_EXPORT_ELIGIBILITY_OPERATION = "evaluate_final_export_eligibility";
const FINAL_RELEASE_AUTHORITY_DECISION_TYPE = "export_authority_granted";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isEvaluateFinalExportEligibilityInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "exportCandidateId",
    "exportReviewQueueItemId",
    "actorContext",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportCandidateId)
    && UUID_PATTERN.test(input.exportReviewQueueItemId)
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
  const { evaluateGeneratedDraftExportReviewPacketInTransaction } = await import(
    "../dictionary/postgresGeneratedContentRepository.js"
  );
  const { evaluateClaimTraceabilityInTransaction } = await import(
    "../dictionary/postgresClaimTraceabilityRepository.js"
  );
  const {
    loadExportCandidateForAuthority,
    createPostgresHumanAuthorityDecisionRepository,
  } = await import("../dictionary/postgresHumanAuthorityDecisionRepository.js");
  return {
    runInTransaction: withTransaction,
    evaluatePacket: evaluateGeneratedDraftExportReviewPacketInTransaction,
    evaluator: evaluateClaimTraceabilityInTransaction,
    loadCandidate: loadExportCandidateForAuthority,
    humanAuthorityDecisionRepository: createPostgresHumanAuthorityDecisionRepository(),
  };
}

// ---------------------------------------------------------------------------
// Internal, transaction-scoped composition. Executes candidate load, packet
// evaluation, and P3-17 authority-effectiveness evaluation against the SAME
// passed-in `tx` (via dependencies.evaluateAuthorityEffectiveness - the
// exported evaluateHumanAuthorityEffectivenessInTransaction - rather than the
// repository's evaluateEffectiveness() wrapper, which opens its own separate
// transaction). This closes the gap between "authority checked" and any
// write that must happen atomically with it (e.g. P3-19 export-manifest
// creation). Returns everything the public evaluateFinalExportEligibility
// returns today PLUS effectiveAuthorityDecisionId (the granting decision's
// id) - an internal-only field never exposed by the public wrapper below.
// ---------------------------------------------------------------------------
export async function evaluateFinalExportEligibilityInTransaction(tx, input, dependencies) {
  const {
    evaluatePacket,
    evaluator,
    loadCandidate,
    evaluateAuthorityEffectiveness,
    evaluateCandidateCurrentness,
  } = dependencies;

  const candidate = await loadCandidate(tx, {
    organizationId: input.organizationId,
    exportCandidateId: input.exportCandidateId,
  });
  if (!candidate) return buildKaiError("not_found", { data: null });

  const packetResult = await evaluatePacket(
    tx,
    {
      organizationId: input.organizationId,
      generatedContentDraftId: candidate.generated_content_draft_id,
      exportReviewQueueItemId: input.exportReviewQueueItemId,
    },
    evaluator,
  );
  if (!packetResult?.ok) {
    const code = packetResult?.error?.code === "not_found" ? "not_found" : "conflict_current_state_changed";
    return buildKaiError(code, { data: null });
  }
  const packet = packetResult.data;
  if (packet.requestedExportAudience !== candidate.requested_audience) {
    return buildKaiError("conflict_current_state_changed", { data: null });
  }

  const effectiveness = await evaluateAuthorityEffectiveness(
    tx,
    {
      organizationId: input.organizationId,
      exportCandidateId: input.exportCandidateId,
      decisionType: FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    },
    evaluateCandidateCurrentness,
  );
  if (!effectiveness.ok) {
    return buildKaiError(effectiveness.error.code, { status: effectiveness.error.status, data: null });
  }

  const validatorResult = validateExportManifestEligibility({
    generatedContentDraftId: candidate.generated_content_draft_id,
    requestedExportAudience: candidate.requested_audience,
    draftAudience: candidate.requested_audience,
    draftIsStillDraft: packet.draftStatus === "draft",
    reviewIsResolved: packet.generatedContentReviewQueueStatus === "resolved"
      && packet.generatedContentReviewStatus === "resolved"
      && packet.exportReviewQueueStatus === "resolved"
      && packet.exportReviewStatus === "resolved",
    currentUseEligible: packet.currentUseEligible === true,
    finalGate: true,
    affirmativeHumanExportAuthority: effectiveness.data.effective === true,
  });

  return {
    ok: true,
    data: {
      generatedContentDraftId: candidate.generated_content_draft_id,
      exportCandidateId: input.exportCandidateId,
      requestedExportAudience: candidate.requested_audience,
      finalExportEligible: validatorResult.severity === "pass",
      validatorResult,
      effectiveHumanExportAuthority: effectiveness.data.effective,
      effectivenessReason: effectiveness.data.reason,
      effectiveAuthorityDecisionId: effectiveness.data.headDecisionId,
    },
    error: null,
  };
}

export async function evaluateFinalExportEligibility(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isEvaluateFinalExportEligibilityInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    EVALUATE_FINAL_EXPORT_ELIGIBILITY_OPERATION,
    input.organizationId,
    { allowedRoles: FINAL_EXPORT_ELIGIBILITY_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const needsDefaults = !dependencies.runInTransaction
    || !dependencies.evaluatePacket
    || !dependencies.evaluator
    || !dependencies.loadCandidate
    || !dependencies.humanAuthorityDecisionRepository;
  const defaults = needsDefaults ? await createDefaultDependencies() : null;
  const runInTransaction = dependencies.runInTransaction || defaults.runInTransaction;
  const evaluatePacket = dependencies.evaluatePacket || defaults.evaluatePacket;
  const evaluator = dependencies.evaluator || defaults.evaluator;
  const loadCandidate = dependencies.loadCandidate || defaults.loadCandidate;
  const humanAuthorityDecisionRepository =
    dependencies.humanAuthorityDecisionRepository || defaults.humanAuthorityDecisionRepository;
  // Preserves today's exact external behavior: the repository's
  // evaluateEffectiveness() opens its OWN separate transaction and is called
  // with a single effectiveness-input argument - `tx` is accepted here only
  // to satisfy evaluateFinalExportEligibilityInTransaction's shared call
  // signature (also used, with a genuinely tx-scoped implementation, by the
  // P3-19 manifest write) and is intentionally unused by this adapter.
  const evaluateAuthorityEffectiveness = (_tx, effectivenessInput) =>
    humanAuthorityDecisionRepository.evaluateEffectiveness(effectivenessInput);
  const evaluateCandidateCurrentness = dependencies.evaluateCandidateCurrentness;

  let inner;
  try {
    inner = await runInTransaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      return evaluateFinalExportEligibilityInTransaction(tx, input, {
        evaluatePacket,
        evaluator,
        loadCandidate,
        evaluateAuthorityEffectiveness,
        evaluateCandidateCurrentness,
      });
    });
  } catch {
    return buildKaiError("system_error", { data: null });
  }

  if (!inner.ok) return inner;

  // Explicit allowlist projection - never a passthrough spread - so the
  // public DTO is pinned by construction. effectiveAuthorityDecisionId
  // (internal-only) is deliberately never placed on this object.
  return {
    ok: true,
    data: {
      generatedContentDraftId: inner.data.generatedContentDraftId,
      exportCandidateId: inner.data.exportCandidateId,
      requestedExportAudience: inner.data.requestedExportAudience,
      finalExportEligible: inner.data.finalExportEligible,
      validatorResult: inner.data.validatorResult,
      effectiveHumanExportAuthority: inner.data.effectiveHumanExportAuthority,
      effectivenessReason: inner.data.effectivenessReason,
    },
    error: null,
  };
}

export const __finalExportEligibilityGateServiceContract = Object.freeze({
  FINAL_EXPORT_ELIGIBILITY_ALLOWED_ROLES,
  EVALUATE_FINAL_EXPORT_ELIGIBILITY_OPERATION,
  FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
});

export const __finalExportEligibilityGateServiceTestables = Object.freeze({
  isEvaluateFinalExportEligibilityInput,
  isMappedHumanActor,
});
