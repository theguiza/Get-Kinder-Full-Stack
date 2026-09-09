import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { EXPORT_CANDIDATE_ALLOWED_ROLES } from "../dictionary/exportCandidateContract.js";

// Reuses the exact existing export-review authority (gk_admin only) - never
// broadened, never a second review authority for packets.
const REQUEST_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_ROLES = new Set(EXPORT_CANDIDATE_ALLOWED_ROLES);
const REQUEST_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_OPERATION = "request_grant_response_packet_export_review";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

// Exact-keys input contract: organizationId + engagementId +
// grantResponsePacketExportCandidateId + actorContext + now, and NOTHING
// else - no members, generatedContentDraftIds, member ordering,
// canonicalFingerprint, memberCount, packet audience, manifest identity, or
// approval/final-release decision is ever accepted from a caller.
function isRequestGrantResponsePacketExportReviewInput(input) {
  return hasExactKeys(input, new Set([
    "organizationId",
    "engagementId",
    "grantResponsePacketExportCandidateId",
    "actorContext",
    "now",
  ]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && UUID_PATTERN.test(input.grantResponsePacketExportCandidateId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext)
    && isCanonicalUtcTimestamp(input.now);
}

async function createDefaultGrantResponsePacketExportCandidateRepository() {
  const { createPostgresGrantResponsePacketExportCandidateRepository } = await import(
    "../dictionary/postgresGrantResponsePacketExportCandidateRepository.js"
  );
  return createPostgresGrantResponsePacketExportCandidateRepository();
}

// Requesting export review for a grant-response-packet export candidate
// grants NO approval, NO funder/public readiness, NO export authority, NO
// final release, and NO manifest. It reuses the one existing governed
// 'export_review' queue_type/lifecycle - it does not create a parallel
// packet review state machine.
export async function requestGrantResponsePacketExportReview(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isRequestGrantResponsePacketExportReviewInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    REQUEST_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_OPERATION,
    input.organizationId,
    { allowedRoles: REQUEST_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers, data: null });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant], data: null });
  }

  const repository =
    dependencies.grantResponsePacketExportCandidateRepository
    || (await createDefaultGrantResponsePacketExportCandidateRepository());
  const result = await repository.requestGrantResponsePacketExportReview(input, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });

  const data = {
    organizationId: result.data.organizationId,
    engagementId: result.data.engagementId,
    grantResponsePacketExportCandidateId: result.data.grantResponsePacketExportCandidateId,
    reviewQueueItemId: result.data.reviewQueueItemId,
    queueStatus: result.data.queueStatus,
    reviewStatus: result.data.reviewStatus,
    replayed: result.data.replayed,
  };

  return { ok: true, data, error: null };
}

export const __grantResponsePacketExportReviewServiceContract = Object.freeze({
  REQUEST_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_OPERATION,
  REQUEST_GRANT_RESPONSE_PACKET_EXPORT_REVIEW_ROLES,
});

export const __grantResponsePacketExportReviewServiceTestables = Object.freeze({
  isRequestGrantResponsePacketExportReviewInput,
  isMappedHumanActor,
});
