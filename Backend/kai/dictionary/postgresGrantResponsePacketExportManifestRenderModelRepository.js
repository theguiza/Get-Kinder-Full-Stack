import { withTransaction } from "../db/kaiDb.js";
import { composeGrantResponsePacketRenderModel } from "../services/kaiGrantResponsePacketRenderModelService.js";
import { composeGrantResponsePacketExportCandidateFingerprint } from "../services/kaiGrantResponsePacketExportCandidateFingerprintService.js";

// ---------------------------------------------------------------------------
// P14-08C: Grant Response Packet export-manifest-bound final render-model
// composition. The packet-level analogue of the existing P3-19
// postgresExportManifestRenderModelRepository.js, bound instead to the exact
// P14-08A kai.grant_response_packet_export_manifests row and its exact P14-03
// grant_response_packet_export_candidates row - never a member-level
// kai.export_manifests/kai.export_candidates row, never a client-selected
// latest/newest/preferred manifest or candidate.
//
// A packet candidate's own persisted row never stores full block/citation
// content (see P14-03) - only its own canonical_fingerprint and ordered
// member generatedContentDraftIds. Exactly like the member-level P3-19
// pattern (loadExportCandidateCanonicalRepresentationInTransaction) and the
// packet-level P14-06D/P14-07/P14-07B1 "packet-native currentness" pattern
// already established, this recomposes the packet's CURRENT render model
// (composeGrantResponsePacketRenderModel, itself actor-gated and unable to
// run inside an open tx) and recomputes its P14-03 fingerprint, then proves
// - inside a read-only transaction, against the exact candidate row the
// manifest names - that the recomputed fingerprint still equals the
// candidate's own stored canonical_fingerprint. Equality is exactly what it
// means for this exact candidate to still be reconstructable from current
// state (never a latest/newest choice); inequality (any member revision,
// re-review, or superseded candidate) fails closed as
// conflict_current_state_changed rather than silently rendering different
// content under the same manifest identity.
// ---------------------------------------------------------------------------

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function success(data) {
  return { ok: true, data, error: null };
}

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

// Exact-keys input contract: organizationId + grantResponsePacketExportManifestId
// + actorContext, and NOTHING else - no candidate id, fingerprint, member
// list, eligibility, or authority state is ever accepted from a caller.
// actorContext is required (not optional) because reconstructing this exact
// candidate's current content requires re-invoking the same actor-gated
// composeGrantResponsePacketRenderModel chain P14-06D/P14-07/P14-07B1 already
// use for packet-native currentness - never a second, weaker read path.
function isComposeGrantResponsePacketExportManifestRenderModelInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "grantResponsePacketExportManifestId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.grantResponsePacketExportManifestId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

async function loadGrantResponsePacketExportManifest(tx, { organizationId, grantResponsePacketExportManifestId }) {
  const { rows } = await tx.query(
    `SELECT grant_response_packet_export_manifest_id::text AS grant_response_packet_export_manifest_id,
            organization_id::text AS organization_id,
            grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id
       FROM kai.grant_response_packet_export_manifests
      WHERE organization_id = $1::uuid AND grant_response_packet_export_manifest_id = $2::uuid`,
    [organizationId, grantResponsePacketExportManifestId],
  );
  return rows[0] || null;
}

// Tenant/candidate-safe: proves this exact candidate belongs to
// organizationId AND resolves its own P14-02 packet identity's engagementId -
// never trusts a caller-supplied engagementId (this route never accepts one).
async function loadGrantResponsePacketExportCandidateForRenderModel(tx, { organizationId, grantResponsePacketExportCandidateId }) {
  const { rows } = await tx.query(
    `SELECT c.grant_response_packet_export_candidate_id::text AS grant_response_packet_export_candidate_id,
            c.canonical_fingerprint,
            i.engagement_id::text AS engagement_id
       FROM kai.grant_response_packet_export_candidates c
       JOIN kai.grant_response_packet_export_identities i
         ON i.grant_response_packet_export_identity_id = c.grant_response_packet_export_identity_id
        AND i.organization_id = c.organization_id
      WHERE c.organization_id = $1::uuid
        AND c.grant_response_packet_export_candidate_id = $2::uuid`,
    [organizationId, grantResponsePacketExportCandidateId],
  );
  return rows[0] || null;
}

export function createPostgresGrantResponsePacketExportManifestRenderModelRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async composeGrantResponsePacketExportManifestRenderModel(input, dependencies = {}) {
      if (!isComposeGrantResponsePacketExportManifestRenderModelInput(input)) return failure("validation_blocker");

      let loaded;
      try {
        loaded = await runInTransaction(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const manifest = await loadGrantResponsePacketExportManifest(tx, input);
          if (!manifest) return null;
          const candidate = await loadGrantResponsePacketExportCandidateForRenderModel(tx, {
            organizationId: input.organizationId,
            grantResponsePacketExportCandidateId: manifest.grant_response_packet_export_candidate_id,
          });
          if (!candidate) return null;
          return { manifest, candidate };
        });
      } catch {
        return failure("system_error");
      }
      if (!loaded) return failure("not_found");
      const { manifest, candidate } = loaded;

      const composeRenderModel = dependencies.composeRenderModel || composeGrantResponsePacketRenderModel;
      const renderModelResult = await composeRenderModel({
        organizationId: input.organizationId,
        engagementId: candidate.engagement_id,
        actorContext: input.actorContext,
      }, dependencies.renderModelDependencies || {});
      if (!renderModelResult?.ok) {
        // Propagate the authoritative render-model/packet failure verbatim -
        // never a substitute error code.
        return {
          ok: false,
          data: null,
          error: renderModelResult?.error || { code: "system_error", status: 500 },
        };
      }

      const { fingerprint } = composeGrantResponsePacketExportCandidateFingerprint(renderModelResult.data);
      if (!fingerprint || fingerprint !== candidate.canonical_fingerprint) {
        return failure("conflict_current_state_changed");
      }

      return success({
        grantResponsePacketExportManifestId: manifest.grant_response_packet_export_manifest_id,
        grantResponsePacketExportCandidateId: manifest.grant_response_packet_export_candidate_id,
        renderModel: renderModelResult.data,
      });
    },
  });
}

export const __grantResponsePacketExportManifestRenderModelRepositoryTestables = Object.freeze({
  isComposeGrantResponsePacketExportManifestRenderModelInput,
});
