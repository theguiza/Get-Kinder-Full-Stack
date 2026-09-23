import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { __generatedContentServiceContract, __generatedContentReviewPacketServiceTestables } from "./kaiGeneratedContentService.js";
import { composeBoardReportingPacketFingerprint } from "./kaiBoardReportingPacketFingerprintService.js";
import { BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION } from "../dictionary/boardReportingCandidateContract.js";

const { GENERATED_CONTENT_REVIEW_ALLOWED_ROLES } = __generatedContentServiceContract;
const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;

export const BOARD_REPORTING_PACKET_AUDIENCE = "internal";
export const BOARD_REPORTING_PACKET_CONTENT_TYPES = Object.freeze(["evidence_summary", "impact_narrative"]);
export const GET_BOARD_REPORTING_PACKET_OPERATION = "get_board_reporting_packet";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

function isGetBoardReportingPacketInput(input) {
  return Boolean(input)
    && typeof input === "object"
    && !Array.isArray(input)
    && Object.keys(input).length === 3
    && Object.keys(input).every((key) => key === "organizationId" || key === "engagementId" || key === "actorContext")
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

async function createDefaultGeneratedContentRepository() {
  const { createPostgresGeneratedContentRepository } = await import(
    "../dictionary/postgresGeneratedContentRepository.js"
  );
  return createPostgresGeneratedContentRepository();
}

function projectBoardReportingMember(packet) {
  if (!isGeneratedDraftReviewPacketDto(packet)) return null;
  if (packet.requestedAudience !== BOARD_REPORTING_PACKET_AUDIENCE) return null;
  if (!BOARD_REPORTING_PACKET_CONTENT_TYPES.includes(packet.contentType)) return null;
  if (packet.queueStatus !== "resolved" || packet.reviewStatus !== "resolved") return null;
  if (packet.currentUseEligible !== true) return null;

  return {
    generationRunId: packet.generationRunId,
    generatedContentDraftId: packet.generatedContentDraftId,
    contentType: packet.contentType,
    draftStatus: packet.draftStatus,
    requestedAudience: packet.requestedAudience,
    reviewQueueItemId: packet.reviewQueueItemId,
    queueStatus: packet.queueStatus,
    reviewStatus: packet.reviewStatus,
    reviewUpdatedAt: packet.reviewUpdatedAt,
    currentUseEligible: packet.currentUseEligible,
    blocks: packet.blocks,
  };
}

function isBoardReportingMemberDto(member) {
  if (!(Boolean(member)
    && typeof member === "object"
    && !Array.isArray(member)
    && Object.keys(member).length === 11
    && Object.keys(member).every((key) => (
      key === "generationRunId"
      || key === "generatedContentDraftId"
      || key === "contentType"
      || key === "draftStatus"
      || key === "requestedAudience"
      || key === "reviewQueueItemId"
      || key === "queueStatus"
      || key === "reviewStatus"
      || key === "reviewUpdatedAt"
      || key === "currentUseEligible"
      || key === "blocks"
    )))) {
    return false;
  }
  return isGeneratedDraftReviewPacketDto({
    ...member,
    exportReviewQueueItemId: null,
    exportReviewQueueStatus: null,
    exportReviewStatus: null,
  })
    && member.requestedAudience === BOARD_REPORTING_PACKET_AUDIENCE
    && BOARD_REPORTING_PACKET_CONTENT_TYPES.includes(member.contentType)
    && member.queueStatus === "resolved"
    && member.reviewStatus === "resolved"
    && member.currentUseEligible === true;
}

// P4 Board successor-candidate closure: the packet DTO also carries the
// current authoritative Board composition identity - the SAME
// fingerprint_contract_version + canonical_fingerprint pair BR-02 candidate
// create/reuse already computes and stores (composeBoardReportingPacketFingerprint,
// BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION), so a caller can
// derive a composition-scoped idempotency key without the server ever
// exposing raw source/evidence content or recomputing a new algorithm. Both
// fields are null together whenever the current packet has no eligible
// members (composeBoardReportingPacketFingerprint's NO_ELIGIBLE_MEMBERS case) -
// never a partial pair.
function isBoardReportingPacketFingerprintIdentity(data) {
  if (data.canonicalFingerprint === null) return data.fingerprintContractVersion === null;
  return data.fingerprintContractVersion === BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION
    && typeof data.canonicalFingerprint === "string"
    && /^[a-f0-9]{64}$/.test(data.canonicalFingerprint);
}

function isBoardReportingPacketDto(data) {
  return Boolean(data)
    && typeof data === "object"
    && !Array.isArray(data)
    && Object.keys(data).length === 7
    && Object.keys(data).every((key) => (
      key === "organizationId"
      || key === "engagementId"
      || key === "packetAudience"
      || key === "supportedContentTypes"
      || key === "members"
      || key === "fingerprintContractVersion"
      || key === "canonicalFingerprint"
    ))
    && UUID_PATTERN.test(data.organizationId)
    && UUID_PATTERN.test(data.engagementId)
    && data.packetAudience === BOARD_REPORTING_PACKET_AUDIENCE
    && Array.isArray(data.supportedContentTypes)
    && data.supportedContentTypes.length === BOARD_REPORTING_PACKET_CONTENT_TYPES.length
    && data.supportedContentTypes.every((type, index) => type === BOARD_REPORTING_PACKET_CONTENT_TYPES[index])
    && Array.isArray(data.members)
    && data.members.every(isBoardReportingMemberDto)
    && isBoardReportingPacketFingerprintIdentity(data);
}

export async function getBoardReportingPacket(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isGetBoardReportingPacketInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    GET_BOARD_REPORTING_PACKET_OPERATION,
    input.organizationId,
    {
      allowedRoles: GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
      combineGlobalRoles: true,
    },
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
    dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.getBoardReportingPacket({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
  });
  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      blockers: result.blockers,
      data: null,
    });
  }

  if (result.data.packetAudience !== BOARD_REPORTING_PACKET_AUDIENCE) {
    return buildKaiError("system_error", { data: null });
  }

  const members = [];
  for (const packet of result.data.drafts) {
    const projected = projectBoardReportingMember(packet);
    if (!projected) return buildKaiError("system_error", { data: null });
    members.push(projected);
  }

  // Reuses the exact same fingerprint composition BR-02 candidate
  // create/reuse relies on (postgresBoardReportingCandidateRepository.js ->
  // composeBoardReportingPacketFingerprint) over this same organizationId +
  // engagementId + packetAudience + supportedContentTypes + members shape -
  // never a new algorithm, never computed in the browser. A NO_ELIGIBLE_MEMBERS
  // result (empty members) is not an error here: it means no candidate can
  // currently be created, and both identity fields are null.
  const { fingerprint } = composeBoardReportingPacketFingerprint({
    organizationId: result.data.organizationId,
    engagementId: result.data.engagementId,
    packetAudience: BOARD_REPORTING_PACKET_AUDIENCE,
    supportedContentTypes: [...BOARD_REPORTING_PACKET_CONTENT_TYPES],
    members,
  });

  const data = {
    organizationId: result.data.organizationId,
    engagementId: result.data.engagementId,
    packetAudience: BOARD_REPORTING_PACKET_AUDIENCE,
    supportedContentTypes: [...BOARD_REPORTING_PACKET_CONTENT_TYPES],
    members,
    fingerprintContractVersion: fingerprint ? BOARD_REPORTING_CANDIDATE_FINGERPRINT_CONTRACT_VERSION : null,
    canonicalFingerprint: fingerprint || null,
  };
  if (!isBoardReportingPacketDto(data)) return buildKaiError("system_error", { data: null });
  return { ok: true, data, error: null };
}

export const __boardReportingPacketServiceContract = Object.freeze({
  BOARD_REPORTING_PACKET_AUDIENCE,
  BOARD_REPORTING_PACKET_CONTENT_TYPES,
  GET_BOARD_REPORTING_PACKET_OPERATION,
  GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
});

export const __boardReportingPacketServiceTestables = Object.freeze({
  isGetBoardReportingPacketInput,
  isMappedHumanActor,
  isBoardReportingPacketDto,
  isBoardReportingMemberDto,
  projectBoardReportingMember,
});
