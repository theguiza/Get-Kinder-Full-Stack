import { withTransaction } from "../db/kaiDb.js";
import {
  evaluateExportCandidateCurrentnessInTransaction,
  loadExportCandidateCanonicalRepresentationInTransaction,
} from "./postgresExportCandidateRepository.js";

const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

const RENDER_MODEL_CONTRACT_VERSION = "kai-sprint2-export-manifest-render-model-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function failure(code, details = {}) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500, ...details } };
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

function isComposeExportManifestRenderModelInput(input) {
  return hasExactKeys(input, new Set(["organizationId", "exportManifestId"]))
    && UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.exportManifestId);
}

async function loadExportManifest(tx, { organizationId, exportManifestId }) {
  const { rows } = await tx.query(
    `SELECT export_manifest_id::text AS export_manifest_id,
            organization_id::text AS organization_id,
            export_candidate_id::text AS export_candidate_id,
            effective_authority_decision_id::text AS effective_authority_decision_id,
            effective_authority_decision_type,
            fingerprint_contract_version,
            canonical_fingerprint,
            created_at
       FROM kai.export_manifests
      WHERE organization_id = $1::uuid AND export_manifest_id = $2::uuid`,
    [organizationId, exportManifestId],
  );
  return rows[0] || null;
}

function citationKey(citation) {
  return [
    citation.claimId,
    citation.evidenceItemId,
    citation.sourceId,
    citation.sourceVersionId,
  ].join(":");
}

function toCitationRef(index) {
  return `CIT-${String(index + 1).padStart(3, "0")}`;
}

function pairKey(entry) {
  return `${entry.claimId}:${entry.evidenceItemId}`;
}

function composeRenderModel({ manifest, candidate, representation }) {
  const citationsByKey = new Map();
  const blocks = [...representation.blocks]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((block) => {
      const citationRefs = block.citations.map((citation) => {
        const normalized = {
          claimId: citation.claimId,
          evidenceItemId: citation.evidenceItemId,
          sourceId: citation.sourceId,
          sourceVersionId: citation.sourceVersionId,
        };
        const key = citationKey(normalized);
        if (!citationsByKey.has(key)) {
          citationsByKey.set(key, { citationRef: toCitationRef(citationsByKey.size), ...normalized });
        }
        return citationsByKey.get(key).citationRef;
      });
      return {
        ordinal: block.ordinal,
        text: block.text,
        citationRefs,
      };
    });

  const citations = [...citationsByKey.values()];
  const citationRefByPair = new Map(
    citations.map((citation) => [`${citation.claimId}:${citation.evidenceItemId}`, citation.citationRef]),
  );
  const limitations = [...representation.limitations]
    .sort((a, b) => (pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0))
    .map((limitation) => ({
      claimId: limitation.claimId,
      evidenceItemId: limitation.evidenceItemId,
      citationRef: citationRefByPair.get(`${limitation.claimId}:${limitation.evidenceItemId}`) || null,
      limitationCodes: [...limitation.limitationCodes].sort(),
    }));

  return {
    renderModelContractVersion: RENDER_MODEL_CONTRACT_VERSION,
    manifest: {
      exportManifestId: manifest.export_manifest_id,
      fingerprintContractVersion: manifest.fingerprint_contract_version,
      canonicalFingerprint: manifest.canonical_fingerprint,
      createdAt: manifest.created_at instanceof Date ? manifest.created_at.toISOString() : manifest.created_at,
    },
    exportCandidate: candidate,
    authority: {
      effectiveAuthorityDecisionId: manifest.effective_authority_decision_id,
      effectiveAuthorityDecisionType: manifest.effective_authority_decision_type,
    },
    content: { blocks },
    citations,
    limitations,
    methodNotes: {
      limitationSnapshotId: candidate.limitationSnapshotId,
      limitationEntries: limitations,
    },
  };
}

export function createPostgresExportManifestRenderModelRepository({
  runInTransaction = withTransaction,
  evaluateCandidateCurrentness = evaluateExportCandidateCurrentnessInTransaction,
  loadCandidateRepresentation = loadExportCandidateCanonicalRepresentationInTransaction,
} = {}) {
  return Object.freeze({
    async composeExportManifestRenderModel(input) {
      if (!isComposeExportManifestRenderModelInput(input)) return failure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

          const manifest = await loadExportManifest(tx, input);
          if (!manifest) return failure("not_found");

          const currentness = await evaluateCandidateCurrentness(tx, {
            organizationId: input.organizationId,
            exportCandidateId: manifest.export_candidate_id,
          });
          if (!currentness.ok) return currentness;
          if (currentness.data.current !== true) {
            return failure("conflict_current_state_changed", { reason: currentness.data.reason });
          }

          const candidateRepresentation = await loadCandidateRepresentation(tx, {
            organizationId: input.organizationId,
            exportCandidateId: manifest.export_candidate_id,
          });
          if (!candidateRepresentation.ok) return candidateRepresentation;
          if (!candidateRepresentation.data?.representation || !candidateRepresentation.data?.candidate) {
            return failure("conflict_current_state_changed", { reason: candidateRepresentation.data?.reason || null });
          }
          if (
            candidateRepresentation.data.fingerprint
            !== candidateRepresentation.data.candidate.canonicalFingerprint
          ) {
            return failure("conflict_current_state_changed", { reason: "fingerprint_mismatch" });
          }

          return success(composeRenderModel({
            manifest,
            candidate: candidateRepresentation.data.candidate,
            representation: candidateRepresentation.data.representation,
          }));
        });
      } catch {
        return failure("system_error");
      }
    },
  });
}

export const __exportManifestRenderModelRepositoryTestables = Object.freeze({
  RENDER_MODEL_CONTRACT_VERSION,
  isComposeExportManifestRenderModelInput,
  composeRenderModel,
});
