import { createValidatorResult } from "../validators/types.js";
import { BOARD_REPORTING_CANDIDATE_AUDIENCE, BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION } from "../dictionary/boardReportingCandidateContract.js";
import { BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES } from "../dictionary/boardReportingCandidateHumanAuthorityDecisionContract.js";
import { composeBoardReportingRenderModel } from "./kaiBoardReportingPacketRenderModelService.js";
import { composeBoardReportingPacketFingerprint } from "./kaiBoardReportingPacketFingerprintService.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINAL_RELEASE_AUTHORITY_DECISION_TYPE = BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES[0];
const VALIDATOR_KEY = "BR-FINAL-ELIGIBILITY-001";
const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
  conflict_current_state_changed: 409,
  system_error: 500,
});

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

function isEvaluateBoardReportingFinalEligibilityInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "boardReportingCandidateId",
    "actorContext",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && isMappedHumanActor(input.actorContext);
}

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function isValidCandidateContract(candidate, expected) {
  return candidate?.organizationId === expected.organizationId
    && candidate.engagementId === expected.engagementId
    && candidate.boardReportingCandidateId === expected.boardReportingCandidateId
    && candidate.packetAudience === BOARD_REPORTING_CANDIDATE_AUDIENCE
    && candidate.fingerprintContractVersion === BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION
    && candidate.candidateStatus === "created"
    && typeof candidate.canonicalFingerprint === "string"
    && /^[0-9a-f]{64}$/.test(candidate.canonicalFingerprint)
    && Array.isArray(candidate.members)
    && candidate.members.length > 0
    && candidate.members.every((member, index) => member.ordinal === index);
}

function buildValidatorResult({ boardReportingCandidateId, finalEligible, failedGates }) {
  if (finalEligible) {
    return createValidatorResult({
      validator_key: VALIDATOR_KEY,
      severity: "pass",
      object_type: "board_reporting_candidate",
      object_code: "board_reporting_final_eligibility",
      object_id: boardReportingCandidateId,
      message: "Board Reporting final eligibility gates passed.",
      evidence: {},
    });
  }
  return createValidatorResult({
    validator_key: VALIDATOR_KEY,
    severity: "blocker",
    object_type: "board_reporting_candidate",
    object_code: "board_reporting_final_eligibility",
    object_id: boardReportingCandidateId,
    message: "Board Reporting final eligibility gates failed.",
    blocking_reason: "board_reporting_final_eligibility_blocked",
    evidence: { failed_gates: failedGates },
  });
}

async function createDefaultDependencies() {
  const { createPostgresBoardReportingCandidateRepository } = await import(
    "../dictionary/postgresBoardReportingCandidateRepository.js"
  );
  const { createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository } = await import(
    "../dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js"
  );
  return {
    candidateRepository: createPostgresBoardReportingCandidateRepository(),
    authorityRepository: createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository(),
    composeRenderModel: composeBoardReportingRenderModel,
  };
}

export async function evaluateBoardReportingFinalEligibility(input, dependencies = {}) {
  if (!isEvaluateBoardReportingFinalEligibilityInput(input)) return failure("validation_blocker");

  const needsDefaults = !dependencies.candidateRepository
    || !dependencies.authorityRepository
    || !dependencies.composeRenderModel;
  const defaults = needsDefaults ? await createDefaultDependencies() : null;
  const candidateRepository = dependencies.candidateRepository || defaults.candidateRepository;
  const authorityRepository = dependencies.authorityRepository || defaults.authorityRepository;
  const composeRenderModel = dependencies.composeRenderModel || defaults.composeRenderModel;

  const candidateResult = await candidateRepository.readBoardReportingCandidate({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    boardReportingCandidateId: input.boardReportingCandidateId,
  });
  if (!candidateResult.ok) return candidateResult;

  const candidate = candidateResult.data;
  if (
    candidate.organizationId !== input.organizationId
    || candidate.engagementId !== input.engagementId
  ) {
    return failure("not_found");
  }

  const failedGates = [];
  const candidateContractValid = isValidCandidateContract(candidate, input);
  if (!candidateContractValid) failedGates.push("candidate_contract_invalid");

  const reviewStateResult = await candidateRepository.readBoardReportingCandidateReviewStateById({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    boardReportingCandidateId: input.boardReportingCandidateId,
  });
  if (!reviewStateResult.ok) return reviewStateResult;
  const reviewResolved = reviewStateResult.data.queueStatus === "resolved"
    && reviewStateResult.data.reviewStatus === "resolved";
  if (!reviewResolved) failedGates.push("board_reporting_candidate_review_unresolved");

  const authorityResult = await authorityRepository.evaluateEffectiveness({
    organizationId: input.organizationId,
    boardReportingCandidateId: input.boardReportingCandidateId,
    decisionType: FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
  });
  if (!authorityResult.ok) return authorityResult;
  const authorityEffective = authorityResult.data.effective === true;
  if (!authorityEffective) {
    failedGates.push(
      authorityResult.data.reason === "head_is_revoke"
        ? "human_release_authority_revoked"
        : "human_release_authority_absent",
    );
  }

  const renderModelResult = await composeRenderModel({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    actorContext: input.actorContext,
  }, dependencies.renderModelDependencies || dependencies);
  if (!renderModelResult.ok) return renderModelResult;
  const { fingerprint: freshFingerprint, error: fingerprintError } =
    composeBoardReportingPacketFingerprint(renderModelResult.data);
  if (!freshFingerprint) {
    return fingerprintError === "no_eligible_members" || fingerprintError === "not_internal_audience"
      ? failure("conflict_current_state_changed")
      : failure("system_error");
  }

  const current = freshFingerprint === candidate.canonicalFingerprint;
  if (!current) failedGates.push("board_reporting_candidate_stale");

  const finalEligible = failedGates.length === 0;
  const validatorResult = buildValidatorResult({
    boardReportingCandidateId: input.boardReportingCandidateId,
    finalEligible,
    failedGates,
  });

  return {
    ok: true,
    data: {
      boardReportingCandidateId: input.boardReportingCandidateId,
      organizationId: input.organizationId,
      engagementId: input.engagementId,
      candidateGate: {
        exists: true,
        belongsToOrganization: true,
        belongsToEngagement: true,
        contractValid: candidateContractValid,
      },
      reviewGate: {
        resolved: reviewResolved,
        reviewQueueItemId: reviewStateResult.data.reviewQueueItemId,
        queueStatus: reviewStateResult.data.queueStatus,
        reviewStatus: reviewStateResult.data.reviewStatus,
        reviewUpdatedAt: reviewStateResult.data.reviewUpdatedAt,
      },
      authorityGate: {
        effective: authorityEffective,
        reason: authorityResult.data.reason,
        headDecisionId: authorityResult.data.headDecisionId,
      },
      currentnessGate: {
        current,
        stale: !current,
      },
      finalEligibility: finalEligible,
      failedGates,
      blockers: finalEligible ? [] : failedGates,
      candidateFingerprint: candidate.canonicalFingerprint,
      freshFingerprint,
      validatorResult,
    },
    error: null,
  };
}

export const __boardReportingFinalEligibilityGateServiceContract = Object.freeze({
  FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
  VALIDATOR_KEY,
});

export const __boardReportingFinalEligibilityGateServiceTestables = Object.freeze({
  isEvaluateBoardReportingFinalEligibilityInput,
  isMappedHumanActor,
  isValidCandidateContract,
  buildValidatorResult,
});
