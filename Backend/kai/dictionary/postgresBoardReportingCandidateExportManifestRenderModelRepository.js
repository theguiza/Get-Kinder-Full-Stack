import { withTransaction } from "../db/kaiDb.js";
import { composeBoardReportingRenderModel } from "../services/kaiBoardReportingPacketRenderModelService.js";
import { composeBoardReportingPacketFingerprint } from "../services/kaiBoardReportingPacketFingerprintService.js";

// ---------------------------------------------------------------------------
// Board Reporting export-manifest-bound final render-model composition - the
// Board-scoped analogue of the existing P14-08C
// postgresGrantResponsePacketExportManifestRenderModelRepository.js (packet-
// level) and P3-19 postgresExportManifestRenderModelRepository.js (member-
// level), bound instead to the exact, existing
// kai.board_reporting_candidate_export_manifests row and its exact,
// immutable BR-02 kai.board_reporting_candidates row - never a client-
// selected latest/newest/preferred manifest or candidate, and never a
// candidate resolved by organizationId+engagementId alone.
//
// A BR-02 candidate row never stores full block/citation content - only its
// own canonical_fingerprint (see boardReportingCandidateContract.js). Exactly
// like the packet-level P14-08C pattern and the existing Board final-
// eligibility "currentness" pattern already established in
// kaiBoardReportingFinalEligibilityGateService.js, this recomposes the
// Board's CURRENT render model (composeBoardReportingRenderModel, itself
// actor-gated and unable to run inside an open tx) and recomputes its
// existing BR-02 fingerprint (composeBoardReportingPacketFingerprint), then
// proves - inside a read-only transaction, against the exact candidate row
// the manifest names - that the recomputed fingerprint still equals the
// candidate's own stored canonical_fingerprint. Equality is exactly what it
// means for this exact candidate to still be reconstructable from current
// state; inequality (any member revision, re-review, or superseded
// candidate) fails closed as conflict_current_state_changed rather than
// silently rendering different content under the same manifest identity.
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

// Exact-keys input contract: organizationId + boardReportingCandidateExportManifestId
// + actorContext, and NOTHING else - no candidate id, engagement id,
// fingerprint, member list, eligibility, or authority state is ever accepted
// from a caller. actorContext is required (not optional) because
// reconstructing this exact candidate's current content requires
// re-invoking the same actor-gated composeBoardReportingRenderModel chain
// the existing final-eligibility gate already uses - never a second, weaker
// read path.
function isComposeBoardReportingCandidateExportManifestRenderModelInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "boardReportingCandidateExportManifestId", "actorContext"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.boardReportingCandidateExportManifestId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

async function loadBoardReportingCandidateExportManifest(tx, { organizationId, boardReportingCandidateExportManifestId }) {
  const { rows } = await tx.query(
    `SELECT board_reporting_candidate_export_manifest_id::text AS board_reporting_candidate_export_manifest_id,
            organization_id::text AS organization_id,
            board_reporting_candidate_id::text AS board_reporting_candidate_id
       FROM kai.board_reporting_candidate_export_manifests
      WHERE organization_id = $1::uuid AND board_reporting_candidate_export_manifest_id = $2::uuid`,
    [organizationId, boardReportingCandidateExportManifestId],
  );
  return rows[0] || null;
}

// Tenant/candidate-safe: proves this exact candidate belongs to
// organizationId AND resolves its own BR-02 engagementId - never trusts a
// caller-supplied engagementId (this route never accepts one).
async function loadBoardReportingCandidateForRenderModel(tx, { organizationId, boardReportingCandidateId }) {
  const { rows } = await tx.query(
    `SELECT board_reporting_candidate_id::text AS board_reporting_candidate_id,
            engagement_id::text AS engagement_id,
            canonical_fingerprint
       FROM kai.board_reporting_candidates
      WHERE organization_id = $1::uuid
        AND board_reporting_candidate_id = $2::uuid`,
    [organizationId, boardReportingCandidateId],
  );
  return rows[0] || null;
}

export function createPostgresBoardReportingCandidateExportManifestRenderModelRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async composeBoardReportingCandidateExportManifestRenderModel(input, dependencies = {}) {
      if (!isComposeBoardReportingCandidateExportManifestRenderModelInput(input)) return failure("validation_blocker");

      let loaded;
      try {
        loaded = await runInTransaction(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const manifest = await loadBoardReportingCandidateExportManifest(tx, input);
          if (!manifest) return null;
          const candidate = await loadBoardReportingCandidateForRenderModel(tx, {
            organizationId: input.organizationId,
            boardReportingCandidateId: manifest.board_reporting_candidate_id,
          });
          if (!candidate) return null;
          return { manifest, candidate };
        });
      } catch {
        return failure("system_error");
      }
      if (!loaded) return failure("not_found");
      const { manifest, candidate } = loaded;

      const composeRenderModel = dependencies.composeRenderModel || composeBoardReportingRenderModel;
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

      const { fingerprint } = composeBoardReportingPacketFingerprint(renderModelResult.data);
      if (!fingerprint || fingerprint !== candidate.canonical_fingerprint) {
        return failure("conflict_current_state_changed");
      }

      return success({
        boardReportingCandidateExportManifestId: manifest.board_reporting_candidate_export_manifest_id,
        boardReportingCandidateId: manifest.board_reporting_candidate_id,
        renderModel: renderModelResult.data,
      });
    },
  });
}

export const __boardReportingCandidateExportManifestRenderModelRepositoryTestables = Object.freeze({
  isComposeBoardReportingCandidateExportManifestRenderModelInput,
});
