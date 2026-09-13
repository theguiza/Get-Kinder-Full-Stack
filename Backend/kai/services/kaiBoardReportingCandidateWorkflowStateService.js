import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { EXPORT_CANDIDATE_ALLOWED_ROLES } from "../dictionary/exportCandidateContract.js";
import { BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES } from "../dictionary/boardReportingCandidateHumanAuthorityDecisionContract.js";

// ---------------------------------------------------------------------------
// Board Reporting candidate workflow-state read: the single browser-facing
// authoritative read surface a candidate detail view needs to rehydrate the
// full governed BR lifecycle for one exact candidate - current BR-03 review
// state, effective BR-04 final-release authority, current Board final
// eligibility (with its structured blockers/currentness), and this
// candidate's export-manifest history. This file composes four EXISTING
// authoritative read mechanisms and reimplements none of their governance,
// review, authority, eligibility, or manifest semantics:
//   - postgresBoardReportingCandidateRepository.readBoardReportingCandidateReviewStateById
//     (the existing BR-03 review-state read, already used unmodified by
//     kaiBoardReportingFinalEligibilityGateService.js)
//   - postgresBoardReportingCandidateHumanAuthorityDecisionRepository.evaluateEffectiveness
//     (the existing BR-04 authority-effectiveness evaluator)
//   - kaiBoardReportingFinalEligibilityGateService.evaluateBoardReportingFinalEligibility
//     (the existing, real final-eligibility gate composition)
//   - postgresBoardReportingCandidateExportManifestRepository.resolveExportManifestStateForCandidate
//     (the existing tenant+candidate-scoped export-manifest history read,
//     already deterministically ordered created_at ASC, id ASC - never a
//     latest/newest/preferred selection)
// This file performs no mutation, creates no review state, no authority, no
// eligibility result, and no manifest - every field returned is produced by
// one of the four calls above, verbatim or via an explicit allowlist
// projection using each mechanism's own field names.
// ---------------------------------------------------------------------------

const READ_BOARD_REPORTING_CANDIDATE_WORKFLOW_STATE_OPERATION = "read_board_reporting_candidate_workflow_state";
const BOARD_REPORTING_CANDIDATE_WORKFLOW_STATE_ALLOWED_ROLES = new Set(EXPORT_CANDIDATE_ALLOWED_ROLES);
const FINAL_RELEASE_AUTHORITY_DECISION_TYPE = BOARD_REPORTING_CANDIDATE_HUMAN_AUTHORITY_DECISION_TYPES[0];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// boardReportingCandidateId + actorContext, and NOTHING else. There is no
// caller-suppliable review outcome, authority outcome, eligibility result,
// blockers, candidate fingerprint/currentness, or manifest field - every one
// of those is produced only by the four composed reads below.
function isReadBoardReportingCandidateWorkflowStateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "boardReportingCandidateId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function authorize(input) {
  if (!isMappedHumanActor(input.actorContext)) {
    return buildKaiError("authorization_denied", { data: null });
  }
  const auth = validateActorCanPerformOperation(
    input.actorContext,
    READ_BOARD_REPORTING_CANDIDATE_WORKFLOW_STATE_OPERATION,
    input.organizationId,
    { allowedRoles: BOARD_REPORTING_CANDIDATE_WORKFLOW_STATE_ALLOWED_ROLES },
  );
  if (!auth.ok) return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant], data: null });
  }
  return null;
}

async function createDefaultDependencies() {
  const [
    { createPostgresBoardReportingCandidateRepository },
    { createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository },
    { createPostgresBoardReportingCandidateExportManifestRepository },
    { evaluateBoardReportingFinalEligibility },
  ] = await Promise.all([
    import("../dictionary/postgresBoardReportingCandidateRepository.js"),
    import("../dictionary/postgresBoardReportingCandidateHumanAuthorityDecisionRepository.js"),
    import("../dictionary/postgresBoardReportingCandidateExportManifestRepository.js"),
    import("./kaiBoardReportingFinalEligibilityGateService.js"),
  ]);
  return {
    candidateRepository: createPostgresBoardReportingCandidateRepository(),
    authorityRepository: createPostgresBoardReportingCandidateHumanAuthorityDecisionRepository(),
    exportManifestRepository: createPostgresBoardReportingCandidateExportManifestRepository(),
    evaluateEligibility: evaluateBoardReportingFinalEligibility,
  };
}

export async function readBoardReportingCandidateWorkflowState(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isReadBoardReportingCandidateWorkflowStateInput(input)) return buildKaiError("validation_blocker", { data: null });
  const authError = authorize(input);
  if (authError) return authError;

  const needsDefaults = !dependencies.candidateRepository
    || !dependencies.authorityRepository
    || !dependencies.exportManifestRepository
    || !dependencies.evaluateEligibility;
  const defaults = needsDefaults ? await createDefaultDependencies() : null;
  const candidateRepository = dependencies.candidateRepository || defaults.candidateRepository;
  const authorityRepository = dependencies.authorityRepository || defaults.authorityRepository;
  const exportManifestRepository = dependencies.exportManifestRepository || defaults.exportManifestRepository;
  const evaluateEligibility = dependencies.evaluateEligibility || defaults.evaluateEligibility;

  // 1) BR-03 review state - authoritative, persisted, exact-candidate scoped.
  // A missing/mismatched candidate (wrong organization or wrong engagement)
  // fails closed here as not_found - this is the exact same
  // organization+engagement+candidateId binding the BR-02/BR-03B repository
  // helpers already enforce, never re-derived by this file.
  const reviewStateResult = await candidateRepository.readBoardReportingCandidateReviewStateById({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    boardReportingCandidateId: input.boardReportingCandidateId,
  });
  if (!reviewStateResult.ok) return buildKaiError(reviewStateResult.error.code, { status: reviewStateResult.error.status, data: null });

  // 2) BR-04 effective final-release authority - the existing evaluator,
  // never re-derived. Tenant+candidate scoped by organizationId +
  // boardReportingCandidateId, which step 1 has already proven belongs to
  // this exact organization/engagement.
  const authorityResult = await authorityRepository.evaluateEffectiveness({
    organizationId: input.organizationId,
    boardReportingCandidateId: input.boardReportingCandidateId,
    decisionType: FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
  });
  if (!authorityResult.ok) return buildKaiError(authorityResult.error.code, { status: authorityResult.error.status, data: null });

  // 3) Final eligibility - the real, unmodified evaluator. Recomposes its
  // own review/authority/currentness gates independently; this file never
  // reuses steps 1-2 to shortcut or override its result.
  const eligibilityResult = await evaluateEligibility({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    boardReportingCandidateId: input.boardReportingCandidateId,
    actorContext: input.actorContext,
  }, dependencies.eligibilityDependencies || {});
  if (!eligibilityResult.ok) return buildKaiError(eligibilityResult.error.code, { status: eligibilityResult.error.status, data: null });

  // 4) Export-manifest history - exact tenant + exact candidate scoped,
  // already deterministically ordered (created_at ASC, id ASC) by the
  // repository itself; this ordering is presentation-only and never implies
  // latest/newest/preferred/current/winner.
  const manifestResult = await exportManifestRepository.resolveExportManifestStateForCandidate({
    organizationId: input.organizationId,
    boardReportingCandidateId: input.boardReportingCandidateId,
  });
  if (!manifestResult.ok) return buildKaiError(manifestResult.error.code, { status: manifestResult.error.status, data: null });

  return {
    ok: true,
    data: {
      organizationId: input.organizationId,
      engagementId: input.engagementId,
      boardReportingCandidateId: input.boardReportingCandidateId,
      reviewState: {
        reviewQueueItemId: reviewStateResult.data.reviewQueueItemId,
        queueStatus: reviewStateResult.data.queueStatus,
        reviewStatus: reviewStateResult.data.reviewStatus,
        reviewUpdatedAt: reviewStateResult.data.reviewUpdatedAt,
      },
      effectiveAuthority: {
        decisionType: FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
        effective: authorityResult.data.effective,
        reason: authorityResult.data.reason,
        headDecisionId: authorityResult.data.headDecisionId,
      },
      finalEligibility: {
        finalEligibility: eligibilityResult.data.finalEligibility,
        failedGates: eligibilityResult.data.failedGates,
        blockers: eligibilityResult.data.blockers,
        currentnessGate: eligibilityResult.data.currentnessGate,
      },
      exportManifests: manifestResult.data.manifests.map((manifest) => ({
        boardReportingCandidateExportManifestId: manifest.boardReportingCandidateExportManifestId,
        boardReportingCandidateId: manifest.boardReportingCandidateId,
        effectiveAuthorityDecisionId: manifest.effectiveAuthorityDecisionId,
        effectiveAuthorityDecisionType: manifest.effectiveAuthorityDecisionType,
        fingerprintContractVersion: manifest.fingerprintContractVersion,
        canonicalFingerprint: manifest.canonicalFingerprint,
        createdAt: manifest.createdAt,
      })),
    },
    error: null,
  };
}

export const __boardReportingCandidateWorkflowStateServiceContract = Object.freeze({
  READ_BOARD_REPORTING_CANDIDATE_WORKFLOW_STATE_OPERATION,
  BOARD_REPORTING_CANDIDATE_WORKFLOW_STATE_ALLOWED_ROLES,
  FINAL_RELEASE_AUTHORITY_DECISION_TYPE,
});

export const __boardReportingCandidateWorkflowStateServiceTestables = Object.freeze({
  isReadBoardReportingCandidateWorkflowStateInput,
  isMappedHumanActor,
});
