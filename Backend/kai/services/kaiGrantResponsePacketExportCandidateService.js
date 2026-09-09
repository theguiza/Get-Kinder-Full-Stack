import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { EXPORT_CANDIDATE_ALLOWED_ROLES } from "../dictionary/exportCandidateContract.js";

// Reuses the exact P3-16 governed export-candidate role boundary
// (gk_admin only) - creating/reusing a Grant Response Packet export
// candidate is analogous in governance weight to creating a single-draft
// export candidate, never a broader or narrower authority surface.
const CREATE_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_ROLES = new Set(EXPORT_CANDIDATE_ALLOWED_ROLES);
const CREATE_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_OPERATION = "create_grant_response_packet_export_candidate";
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

// Exact-keys input contract mirrors the P14-03 repository's own contract:
// organizationId + engagementId + actorContext + now, and nothing else - no
// packetAudience, packet identity id, candidate id, member ids, draft ids,
// member ordering, single-draft exportCandidateIds, exportManifestIds,
// canonicalFingerprint, memberCount, blocks, citations, or limitations is
// ever accepted from a caller of this service.
function isCreateGrantResponsePacketExportCandidateInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "engagementId", "actorContext", "now"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.engagementId)
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

// Creating/reusing a grant-response-packet export candidate grants NO
// approval, NO funder/public readiness, NO export authority, NO final
// release, and NO manifest. All server-derived state flows exclusively
// through the existing P14-03 path (getGrantResponsePacket ->
// composeGrantResponsePacketRenderModel -> fingerprint -> P14-02 structural
// identity -> P14-03 candidate -> authoritative member snapshot) via the one
// repository call below - this function creates no second fingerprint or
// membership implementation.
export async function createGrantResponsePacketExportCandidate(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isCreateGrantResponsePacketExportCandidateInput(input)) return buildKaiError("validation_blocker", { data: null });
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CREATE_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_OPERATION,
    input.organizationId,
    { allowedRoles: CREATE_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_ROLES },
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
  const result = await repository.createGrantResponsePacketExportCandidate(input, {
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
    composeRenderModel: dependencies.composeRenderModel,
    renderModelDependencies: dependencies.renderModelDependencies,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status, data: null });

  // Return only safe candidate metadata required for the next workflow
  // stage - never the raw ordered member list the render model produced.
  const data = {
    organizationId: result.data.organizationId,
    engagementId: result.data.engagementId,
    grantResponsePacketExportCandidateId: result.data.grantResponsePacketExportCandidateId,
    grantResponsePacketExportIdentityId: result.data.grantResponsePacketExportIdentityId,
    fingerprintContractVersion: result.data.fingerprintContractVersion,
    canonicalFingerprint: result.data.canonicalFingerprint,
    memberCount: Array.isArray(result.data.memberGeneratedContentDraftIds)
      ? result.data.memberGeneratedContentDraftIds.length
      : null,
    replayed: result.data.replayed,
  };

  return { ok: true, data, error: null };
}

export const __grantResponsePacketExportCandidateServiceContract = Object.freeze({
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_OPERATION,
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_CANDIDATE_ROLES,
});

export const __grantResponsePacketExportCandidateServiceTestables = Object.freeze({
  isCreateGrantResponsePacketExportCandidateInput,
  isMappedHumanActor,
});
