import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { EXPORT_CANDIDATE_ALLOWED_ROLES } from "../dictionary/exportCandidateContract.js";

const CREATE_BOARD_REPORTING_CANDIDATE_OPERATION = "create_board_reporting_candidate";
const READ_BOARD_REPORTING_CANDIDATE_OPERATION = "read_board_reporting_candidate";
const REQUEST_BOARD_REPORTING_CANDIDATE_REVIEW_OPERATION = "request_board_reporting_candidate_review";
const BOARD_REPORTING_CANDIDATE_ALLOWED_ROLES = new Set(EXPORT_CANDIDATE_ALLOWED_ROLES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

function isCreateBoardReportingCandidateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "idempotencyKey", "actorContext", "now"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

function isReadBoardReportingCandidateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "boardReportingCandidateId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function isRequestBoardReportingCandidateReviewInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "boardReportingCandidateId", "actorContext", "now"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.boardReportingCandidateId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function createDefaultBoardReportingCandidateRepository() {
  const { createPostgresBoardReportingCandidateRepository } = await import(
    "../dictionary/postgresBoardReportingCandidateRepository.js"
  );
  return createPostgresBoardReportingCandidateRepository();
}

function authorize(input, operation) {
  if (!isMappedHumanActor(input.actorContext)) {
    return buildKaiError("authorization_denied", { data: null });
  }
  const auth = validateActorCanPerformOperation(
    input.actorContext,
    operation,
    input.organizationId,
    { allowedRoles: BOARD_REPORTING_CANDIDATE_ALLOWED_ROLES },
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

export async function createBoardReportingCandidate(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isCreateBoardReportingCandidateInput(input)) return buildKaiError("validation_blocker", { data: null });
  const authError = authorize(input, CREATE_BOARD_REPORTING_CANDIDATE_OPERATION);
  if (authError) return authError;

  const repository = dependencies.boardReportingCandidateRepository || (await createDefaultBoardReportingCandidateRepository());
  const result = await repository.createBoardReportingCandidate(input, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
    composeRenderModel: dependencies.composeRenderModel,
    renderModelDependencies: dependencies.renderModelDependencies,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });

  return {
    ok: true,
    data: {
      organizationId: result.data.organizationId,
      engagementId: result.data.engagementId,
      boardReportingCandidateId: result.data.boardReportingCandidateId,
      packetAudience: result.data.packetAudience,
      fingerprintContractVersion: result.data.fingerprintContractVersion,
      canonicalFingerprint: result.data.canonicalFingerprint,
      memberCount: Array.isArray(result.data.memberGeneratedContentDraftIds)
        ? result.data.memberGeneratedContentDraftIds.length
        : null,
      replayed: result.data.replayed,
    },
    error: null,
  };
}

export async function readBoardReportingCandidate(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isReadBoardReportingCandidateInput(input)) return buildKaiError("validation_blocker", { data: null });
  const authError = authorize(input, READ_BOARD_REPORTING_CANDIDATE_OPERATION);
  if (authError) return authError;

  const repository = dependencies.boardReportingCandidateRepository || (await createDefaultBoardReportingCandidateRepository());
  const result = await repository.readBoardReportingCandidate({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
    boardReportingCandidateId: input.boardReportingCandidateId,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });
  return result;
}

export async function requestBoardReportingCandidateReview(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isRequestBoardReportingCandidateReviewInput(input)) return buildKaiError("validation_blocker", { data: null });
  const authError = authorize(input, REQUEST_BOARD_REPORTING_CANDIDATE_REVIEW_OPERATION);
  if (authError) return authError;

  const repository = dependencies.boardReportingCandidateRepository || (await createDefaultBoardReportingCandidateRepository());
  const result = await repository.requestBoardReportingCandidateReview(input, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });

  return {
    ok: true,
    data: {
      organizationId: result.data.organizationId,
      engagementId: result.data.engagementId,
      boardReportingCandidateId: result.data.boardReportingCandidateId,
      canonicalFingerprint: result.data.canonicalFingerprint,
      reviewQueueItemId: result.data.reviewQueueItemId,
      queueStatus: result.data.queueStatus,
      reviewStatus: result.data.reviewStatus,
      reviewUpdatedAt: result.data.reviewUpdatedAt,
      replayed: result.data.replayed,
    },
    error: null,
  };
}

export const __boardReportingCandidateServiceContract = Object.freeze({
  CREATE_BOARD_REPORTING_CANDIDATE_OPERATION,
  READ_BOARD_REPORTING_CANDIDATE_OPERATION,
  REQUEST_BOARD_REPORTING_CANDIDATE_REVIEW_OPERATION,
  BOARD_REPORTING_CANDIDATE_ALLOWED_ROLES,
});

export const __boardReportingCandidateServiceTestables = Object.freeze({
  isCreateBoardReportingCandidateInput,
  isReadBoardReportingCandidateInput,
  isRequestBoardReportingCandidateReviewInput,
  isMappedHumanActor,
});
