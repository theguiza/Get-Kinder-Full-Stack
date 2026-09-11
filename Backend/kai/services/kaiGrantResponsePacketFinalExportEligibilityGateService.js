import { validateExportManifestEligibility } from "../validators/kaiExportManifestEligibilityValidators.js";
import { createValidatorResult } from "../validators/types.js";
import { GRANT_RESPONSE_PACKET_AUDIENCE } from "../dictionary/grantResponsePacketExportCandidateContract.js";
import { GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES } from "../dictionary/grantResponsePacketHumanAuthorityDecisionContract.js";

// ---------------------------------------------------------------------------
// P14-07: Grant Response Packet final-export eligibility evaluation. READ /
// EVALUATION ONLY - creates no manifest, no packet bytes, and no new human
// authority decision. This is the packet-level analogue of the existing
// single-draft P3-18 evaluateFinalExportEligibility/VAL-EXP-001 gate, but it
// cannot reuse that service's repository wiring directly: P3-18's mandatory
// `affirmativeHumanExportAuthority` input can only be sourced from a
// persisted `kai.human_authority_decisions` row keyed to
// `kai.export_candidates`, a structurally disjoint table from
// `kai.grant_response_packet_export_candidates` (see the P14-07B1 ExecPlan
// finding). P14-07B1 closed that persistence gap with a sibling ledger table
// + repository; this evaluator is the first consumer of that repository's
// real `evaluateEffectiveness`, and reuses the exact same pure VAL-EXP-001
// gate logic (`validateExportManifestEligibility`) the single-draft flow
// uses, unmodified - it does not reimplement or fork that gate logic.
//
// Every gate below is checked for the EXACT grantResponsePacketExportCandidateId
// given, resolved once by the caller through the authoritative
// current-candidate lookup (P14-06D) - this evaluator never selects a
// latest/newest/preferred candidate itself, and never accepts a fingerprint,
// member list, review state, eligibility, authority state, requestedAudience,
// or actor identity from an HTTP client: organizationId/engagementId/
// grantResponsePacketExportCandidateId/actorContext are the only inputs, and
// all state used to decide eligibility is re-derived/re-checked here (or by
// the B1 repository it delegates to) from those ids alone.
// ---------------------------------------------------------------------------

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINAL_RELEASE_AUTHORITY_DECISION_TYPE = GRANT_RESPONSE_PACKET_HUMAN_AUTHORITY_DECISION_TYPES[0];
const VALIDATOR_KEY = "VAL-EXP-001";
const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  not_found: 404,
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

// Exact-keys input contract: organizationId + engagementId +
// grantResponsePacketExportCandidateId + actorContext, and NOTHING else - no
// fingerprint, member list, requestedAudience, review state, eligibility, or
// authority state is ever accepted from a caller.
function isEvaluateGrantResponsePacketFinalExportEligibilityInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "actorContext",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && isMappedHumanActor(input.actorContext);
}

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

async function createDefaultDependencies() {
  const { createPostgresGrantResponsePacketExportCandidateRepository } = await import(
    "../dictionary/postgresGrantResponsePacketExportCandidateRepository.js"
  );
  const { createPostgresGrantResponsePacketHumanAuthorityDecisionRepository } = await import(
    "../dictionary/postgresGrantResponsePacketHumanAuthorityDecisionRepository.js"
  );
  const { composeGrantResponsePacketRenderModel } = await import("./kaiGrantResponsePacketRenderModelService.js");
  return {
    candidateRepository: createPostgresGrantResponsePacketExportCandidateRepository(),
    authorityRepository: createPostgresGrantResponsePacketHumanAuthorityDecisionRepository(),
    composeRenderModel: composeGrantResponsePacketRenderModel,
  };
}

// A stale/superseded candidate (its own stored canonical_fingerprint no
// longer equals the live-recomposed one - the SAME B1 currentness proof
// evaluateEffectiveness already performs) can never be final-export
// eligible, regardless of what its own historical review/member state might
// have been. Rather than fabricate reviewIsResolved/currentUseEligible
// values for a row this evaluator deliberately does not re-derive live state
// for, this returns its own explicit blocker built with the SAME
// createValidatorResult helper VAL-EXP-001 itself uses (never a duplicated
// gate implementation) so the caller still gets one consistent
// validator-result shape either way.
function staleCandidateValidatorResult(grantResponsePacketExportCandidateId) {
  return createValidatorResult({
    validator_key: VALIDATOR_KEY,
    severity: "blocker",
    object_type: "grant_response_packet_export_candidate",
    object_code: "export_manifest_eligibility",
    object_id: grantResponsePacketExportCandidateId,
    message: "Packet export candidate is no longer the current candidate for its packet.",
    blocking_reason: "export_manifest_not_eligible",
    evidence: { failed_gates: ["packet_candidate_superseded"] },
  });
}

export async function evaluateGrantResponsePacketFinalExportEligibility(input, dependencies = {}) {
  if (!isEvaluateGrantResponsePacketFinalExportEligibilityInput(input)) return failure("validation_blocker");

  const needsDefaults = !dependencies.candidateRepository
    || !dependencies.authorityRepository
    || !dependencies.composeRenderModel;
  const defaults = needsDefaults ? await createDefaultDependencies() : null;
  const candidateRepository = dependencies.candidateRepository || defaults.candidateRepository;
  const authorityRepository = dependencies.authorityRepository || defaults.authorityRepository;
  const composeRenderModel = dependencies.composeRenderModel || defaults.composeRenderModel;

  // Real B1 evaluateEffectiveness - never reimplemented. This one call
  // proves organization ownership, engagement ownership (through the
  // candidate's own P14-02 packet identity), and current-fingerprint
  // currentness for the EXACT candidate id given, and returns the real
  // export_authority_granted effectiveness for it.
  const effectiveness = await authorityRepository.evaluateEffectiveness({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
    decisionType: FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
    actorContext: input.actorContext,
  }, { composeRenderModel, renderModelDependencies: dependencies.renderModelDependencies || dependencies });
  if (!effectiveness.ok) return effectiveness;
  // "candidate_missing" covers: nonexistent candidate id, a candidate from
  // another organization, a candidate whose packet identity belongs to a
  // different engagement, and a member-level export_candidate_id
  // substituted for a packet candidate id (none of those rows are ever
  // matched by B1's own organization-/engagement-scoped query) - every one
  // of these fails closed as not_found here, never as a fabricated BLOCKED
  // eligibility state for a candidate that does not exist.
  if (effectiveness.data.reason === "candidate_missing") return failure("not_found");

  const stale = effectiveness.data.reason === "packet_candidate_superseded";

  const reviewStateResult = await candidateRepository.readGrantResponsePacketExportCandidateReviewStateById({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
  });
  if (!reviewStateResult.ok) return reviewStateResult;

  let validatorResult;
  let reviewResolved = false;
  let memberCurrentUseEligible = false;

  if (stale) {
    validatorResult = staleCandidateValidatorResult(input.grantResponsePacketExportCandidateId);
  } else {
    reviewResolved = reviewStateResult.data.queueStatus === "resolved"
      && reviewStateResult.data.reviewStatus === "resolved";

    const renderModelResult = await composeRenderModel({
      organizationId: input.organizationId,
      engagementId: input.engagementId,
      actorContext: input.actorContext,
    }, dependencies.renderModelDependencies || dependencies);
    if (!renderModelResult.ok) return renderModelResult;

    const members = Array.isArray(renderModelResult.data.members) ? renderModelResult.data.members : [];
    memberCurrentUseEligible = members.length > 0 && members.every((member) => member.currentUseEligible === true);

    validatorResult = validateExportManifestEligibility({
      generatedContentDraftId: input.grantResponsePacketExportCandidateId,
      requestedExportAudience: GRANT_RESPONSE_PACKET_AUDIENCE,
      draftAudience: renderModelResult.data.packetAudience,
      draftIsStillDraft: false,
      reviewIsResolved: reviewResolved,
      currentUseEligible: memberCurrentUseEligible,
      finalGate: true,
      affirmativeHumanExportAuthority: effectiveness.data.effective === true,
    });
  }

  return {
    ok: true,
    data: {
      grantResponsePacketExportCandidateId: input.grantResponsePacketExportCandidateId,
      packetCandidateCurrent: !stale,
      reviewResolved,
      memberCurrentUseEligible,
      effectiveHumanExportAuthority: effectiveness.data.effective === true,
      effectivenessReason: effectiveness.data.reason,
      finalExportEligible: validatorResult.severity === "pass",
      validatorResult,
    },
    error: null,
  };
}

export const __grantResponsePacketFinalExportEligibilityGateServiceContract = Object.freeze({
  FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
  VALIDATOR_KEY,
});

export const __grantResponsePacketFinalExportEligibilityGateServiceTestables = Object.freeze({
  isEvaluateGrantResponsePacketFinalExportEligibilityInput,
  isMappedHumanActor,
  staleCandidateValidatorResult,
});
