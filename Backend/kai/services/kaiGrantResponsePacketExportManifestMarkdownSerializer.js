import {
  isKaiSprint2Enabled,
  isKaiGenerationEnabled,
  isKaiPublicExportEnabled,
} from "../config/kaiSprint2Config.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES,
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_OPERATION,
} from "../dictionary/grantResponsePacketExportManifestContract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { serializeGrantResponsePacketRenderModelToMarkdown } from "./kaiGrantResponsePacketMarkdownSerializer.js";

// ---------------------------------------------------------------------------
// P14-08C: governed Grant Response Packet FINAL Markdown delivery, authorized
// solely by an exact, existing grantResponsePacketExportManifestId - never by
// organizationId+engagementId alone, a candidate id without its manifest, a
// member-level manifest/candidate id, or a latest/newest/preferred
// selection. Reuses the EXISTING packet Markdown serializer's pure
// text-generation function unmodified (no new Markdown format) - only its
// existing, additive delivery-class/contract-version override parameters are
// used, so this pipeline's output correctly self-labels as FINAL rather than
// as the existing engagement-scoped PREVIEW_READ_ONLY route's own label.
// Delegates the entire manifest-bound render-model reconstruction (including
// the packet-native currentness/fingerprint proof) to the new P14-08C
// postgresGrantResponsePacketExportManifestRenderModelRepository.js - this
// file reimplements none of that. Reuses the exact same gk_admin-only
// CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES/_OPERATION gate
// P14-08B already established for this manifest track (mirroring how the
// existing P3-19 kaiExportManifestRenderModelService.js reuses its own
// CREATE_EXPORT_MANIFEST_* gate for reads). Creates no manifest, mutates no
// authority, and exposes no raw evidence/source body.
// ---------------------------------------------------------------------------

const FINAL_MARKDOWN_CONTRACT_VERSION = "kai-sprint2-grant-response-packet-markdown-final-v1";
const FINAL_DELIVERY_CLASS = "FINAL_MANIFEST_BOUND";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

// Exact-keys input contract: organizationId + grantResponsePacketExportManifestId
// + actorContext, and NOTHING else - no engagementId, candidate id,
// fingerprint, member list, eligibility, or authority state is ever accepted
// from a caller (an engagementId is never even needed - the manifest's own
// bound candidate resolves it).
function isSerializeGrantResponsePacketExportManifestToMarkdownInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "grantResponsePacketExportManifestId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.grantResponsePacketExportManifestId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

async function createDefaultDependencies() {
  const { createPostgresGrantResponsePacketExportManifestRenderModelRepository } = await import(
    "../dictionary/postgresGrantResponsePacketExportManifestRenderModelRepository.js"
  );
  return { repository: createPostgresGrantResponsePacketExportManifestRenderModelRepository() };
}

export async function serializeGrantResponsePacketExportManifestToMarkdown(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isKaiPublicExportEnabled(env)) return buildKaiError("feature_disabled", { data: null });
  if (!isSerializeGrantResponsePacketExportManifestToMarkdownInput(input)) {
    return buildKaiError("validation_blocker", { data: null });
  }
  // An assistant/system actorContext is refused here (before any repository
  // call) - only a mapped human actor may ever reach the gk_admin
  // authorization check below.
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied", { data: null });

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_OPERATION,
    input.organizationId,
    { allowedRoles: CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES },
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

  const defaults = dependencies.repository ? null : await createDefaultDependencies();
  const repository = dependencies.repository || defaults.repository;

  const result = await repository.composeGrantResponsePacketExportManifestRenderModel({
    organizationId: input.organizationId,
    grantResponsePacketExportManifestId: input.grantResponsePacketExportManifestId,
    actorContext: input.actorContext,
  }, dependencies.renderModelDependencies || {});
  if (!result.ok) return { ok: false, data: null, error: result.error };

  // Explicit allowlist projection - never a passthrough spread. No raw
  // render-model internals (blocks/citations bytes) are duplicated here
  // outside the markdown field itself.
  return {
    ok: true,
    data: {
      grantResponsePacketExportManifestId: result.data.grantResponsePacketExportManifestId,
      grantResponsePacketExportCandidateId: result.data.grantResponsePacketExportCandidateId,
      markdownContractVersion: FINAL_MARKDOWN_CONTRACT_VERSION,
      deliveryClass: FINAL_DELIVERY_CLASS,
      markdown: serializeGrantResponsePacketRenderModelToMarkdown(result.data.renderModel, {
        markdownContractVersion: FINAL_MARKDOWN_CONTRACT_VERSION,
        deliveryClass: FINAL_DELIVERY_CLASS,
      }),
    },
    error: null,
  };
}

export const __grantResponsePacketExportManifestMarkdownSerializerContract = Object.freeze({
  FINAL_MARKDOWN_CONTRACT_VERSION,
  FINAL_DELIVERY_CLASS,
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_ALLOWED_ROLES,
  CREATE_GRANT_RESPONSE_PACKET_EXPORT_MANIFEST_OPERATION,
});

export const __grantResponsePacketExportManifestMarkdownSerializerTestables = Object.freeze({
  isSerializeGrantResponsePacketExportManifestToMarkdownInput,
  isMappedHumanActor,
});
