import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { __generatedContentServiceContract, __generatedContentReviewPacketServiceTestables } from "./kaiGeneratedContentService.js";
import { __exportReviewServiceContract, __exportReviewServiceTestables } from "./kaiExportReviewService.js";

const {
  GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
  PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION,
} = __generatedContentServiceContract;
const { isGeneratedDraftReviewPacketDto } = __generatedContentReviewPacketServiceTestables;
const { EXPORT_REVIEW_ALLOWED_ROLES } = __exportReviewServiceContract;
// Reuses the exact P3-20 export-manifest-history shape/validator the
// single-draft export-review packet already exposes - no second manifest
// vocabulary invented for the Grant Response Packet.
const { isExportManifestHistoryDto } = __exportReviewServiceTestables;

// Deliberately reuses the exact single-draft review-packet operation/role
// gate (GENERATED_CONTENT_REVIEW_ALLOWED_ROLES, gk_admin/gk_reviewer) - a
// Grant Response Packet is a read-only regrouping of the same governed
// per-draft packets an actor with that authority can already read one at a
// time, never a broader or narrower authority surface.
const GET_GRANT_RESPONSE_PACKET_OPERATION = "get_grant_response_packet";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

function isGetGrantResponsePacketInput(input) {
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

// The composite grants no approval/finalization authority of its own - it
// is a read-only regrouping of drafts each already individually eligible
// per the existing single-draft review-packet contract
// (isGeneratedDraftReviewPacketDto), never a second packet-shape
// vocabulary. Membership order is exactly the repository's deterministic
// generated_content_draft_id ASC order - never re-sorted here.
//
// Export/reuse foundation: each member additionally carries exportManifestId
// / exportManifestHistory - the exact P3-20 durable-read recovery
// (loadExportManifestIdentityForReviewQueueItemInTransaction /
// loadExportManifestHistoryForReviewQueueItemInTransaction) the single-draft
// export-review packet already exposes, reused unmodified. This grants no
// new export/finalization authority: it only lets an actor who can already
// see a member's export-review state (exportReviewVisible) also see which
// already-governed single-draft export manifest(s), if any, that member's
// own export-review history has produced - so the existing single-draft
// Markdown/CSV/PDF/DOCX render/export routes
// (/export-manifests/:exportManifestId/{markdown,csv,pdf,docx}) can be
// reached per member without inventing a second, composite manifest
// identity. Nulled/emptied whenever exportReviewVisible is false, exactly
// like the other export-review-scoped fields above.
function projectPacketDraft(packet, exportReviewVisible) {
  const exportManifestId = exportReviewVisible ? (packet.exportManifestId ?? null) : null;
  const exportManifestHistory = exportReviewVisible ? (packet.exportManifestHistory ?? []) : [];
  if (!(exportManifestId === null || UUID_PATTERN.test(exportManifestId))) return null;
  if (!isExportManifestHistoryDto(exportManifestHistory)) return null;

  const projected = {
    ...packet,
    exportReviewQueueItemId: exportReviewVisible ? packet.exportReviewQueueItemId : null,
    exportReviewQueueStatus: exportReviewVisible ? packet.exportReviewQueueStatus : null,
    exportReviewStatus: exportReviewVisible ? packet.exportReviewStatus : null,
  };
  delete projected.exportManifestId;
  delete projected.exportManifestHistory;
  if (!isGeneratedDraftReviewPacketDto(projected)) return null;
  return { ...projected, exportManifestId, exportManifestHistory, exportReviewVisible };
}

export async function getGrantResponsePacket(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isGetGrantResponsePacketInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    GET_GRANT_RESPONSE_PACKET_OPERATION,
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

  const exportReviewAuth = validateActorCanPerformOperation(
    input.actorContext,
    PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION,
    input.organizationId,
    { allowedRoles: EXPORT_REVIEW_ALLOWED_ROLES },
  );
  const exportReviewVisible = exportReviewAuth.ok;

  const repository =
    dependencies.generatedContentRepository || (await createDefaultGeneratedContentRepository());
  const result = await repository.getGrantResponsePacket({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });

  const drafts = [];
  for (const packet of result.data.drafts) {
    const projected = projectPacketDraft(packet, exportReviewVisible);
    if (!projected) return buildKaiError("system_error", { data: null });
    drafts.push(projected);
  }

  return {
    ok: true,
    data: {
      organizationId: result.data.organizationId,
      engagementId: result.data.engagementId,
      packetAudience: result.data.packetAudience,
      drafts,
    },
    error: null,
  };
}

export const __grantResponsePacketServiceContract = Object.freeze({
  GET_GRANT_RESPONSE_PACKET_OPERATION,
  GENERATED_CONTENT_REVIEW_ALLOWED_ROLES,
});

export const __grantResponsePacketServiceTestables = Object.freeze({
  isGetGrantResponsePacketInput,
  isMappedHumanActor,
  projectPacketDraft,
});
