import { isFreeImpactAssessmentBlocks } from "../services/kaiFreeImpactAssessmentComposition.js";
import { DOCUMENT_EVIDENCE_LOCATOR_TYPE, DOCUMENT_EVIDENCE_TYPE, documentLocatorLabel } from "../validators/kaiDocumentEvidenceValidators.js";
import { withTransaction } from "../db/kaiDb.js";
import {
  evaluateExportCandidateCurrentnessInTransaction,
  loadExportCandidateCanonicalRepresentationInTransaction,
} from "./postgresExportCandidateRepository.js";
import { createDefaultEligibilityDependencies } from "./postgresExportManifestRepository.js";
import { evaluateFinalExportEligibilityInTransaction } from "../services/kaiFinalExportEligibilityGateService.js";

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
            export_review_queue_item_id::text AS export_review_queue_item_id,
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

// Plan A Prompt 7: who the released content is about. The organization and the
// engagement the draft was generated under (P14-01 binding), read in the same
// render transaction. Display context only: not part of any fingerprint.
async function loadReportContextInTransaction(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT r.engagement_id::text AS engagement_id, e.engagement_code,
            (SELECT o.name FROM kai.organizations o WHERE o.organization_id = d.organization_id) AS organization_name
       FROM kai.generated_content_drafts d
       JOIN kai.generation_runs r ON r.organization_id = d.organization_id AND r.generation_run_id = d.generation_run_id
       LEFT JOIN kai.engagements e ON e.organization_id = r.organization_id AND e.engagement_id = r.engagement_id
      WHERE d.organization_id = $1::uuid AND d.generated_content_draft_id = $2::uuid`,
    [organizationId, generatedContentDraftId],
  );
  const row = rows[0];
  if (!row) return null;
  const context = {
    organizationId,
    organizationName: row.organization_name ?? null,
    engagementId: row.engagement_id ?? null,
    engagementCode: row.engagement_code ?? null,
  };
  // Free Impact Assessment display context: the engagement's recorded
  // reporting period and, per cited claim, the human-stated indicator label
  // or the document locator, and the source's file kind. Display only.
  const assessment = await loadAssessmentDisplayContext(tx, { organizationId, generatedContentDraftId, engagementId: row.engagement_id });
  return assessment ? { ...context, ...assessment } : context;
}

async function loadAssessmentDisplayContext(tx, { organizationId, generatedContentDraftId, engagementId }) {
  const { rows: blockRows } = await tx.query(
    `SELECT text FROM kai.generated_content_blocks
      WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid ORDER BY ordinal`,
    [organizationId, generatedContentDraftId],
  );
  if (!isFreeImpactAssessmentBlocks(blockRows.map((block, index) => ({ ordinal: index + 1, text: block.text })))) return null;
  const { rows: [period] } = await tx.query(
    `SELECT e.project_metadata->'engagement_requirement_target'->>'reporting_period_start' AS period_start,
            e.project_metadata->'engagement_requirement_target'->>'reporting_period_end' AS period_end,
            e.project_metadata->'engagement_requirement_target'->>'report_identity' AS report_identity
       FROM kai.engagements e WHERE e.organization_id = $1::uuid AND e.engagement_id = $2::uuid`,
    [organizationId, engagementId],
  );
  const derivedPresent = (await tx.query("SELECT to_regclass('kai.evidence_derived_measurements') IS NOT NULL AS present")).rows[0]?.present === true;
  const { rows } = await tx.query(
    `SELECT DISTINCT c.claim_id::text AS claim_id, e.evidence_type, f.file_extension, l.locator_type, l.coordinates,
            ${derivedPresent ? `(SELECT i.indicator_label FROM kai.evidence_derived_measurements edm
                JOIN kai.source_derived_measurement_interpretations i ON i.organization_id = edm.organization_id AND i.interpretation_id = edm.interpretation_id
               WHERE edm.organization_id = e.organization_id AND edm.evidence_item_id = e.evidence_item_id)` : "NULL::text"} AS indicator_label
       FROM kai.generated_content_blocks b
       JOIN kai.generated_content_citations gc ON gc.organization_id = b.organization_id AND gc.generated_content_block_id = b.generated_content_block_id
       JOIN kai.claims c ON c.organization_id = gc.organization_id AND c.claim_id = gc.claim_id
       JOIN kai.evidence_items e ON e.organization_id = c.organization_id AND e.evidence_item_id = c.evidence_item_id
       LEFT JOIN kai.source_locators l ON l.organization_id = e.organization_id AND l.source_locator_id = e.source_locator_id
       JOIN kai.source_versions sv ON sv.organization_id = e.organization_id AND sv.source_version_id = e.source_version_id
       JOIN kai.intake_source_candidates isc ON isc.organization_id = sv.organization_id AND isc.intake_source_candidate_id = sv.intake_source_candidate_id
       JOIN kai.intake_files f ON f.organization_id = isc.organization_id AND f.intake_file_id = isc.intake_file_id
      WHERE b.organization_id = $1::uuid AND b.generated_content_draft_id = $2::uuid`,
    [organizationId, generatedContentDraftId],
  );
  const citationLabels = {};
  for (const claim of rows) {
    const kind = claim.evidence_type === DOCUMENT_EVIDENCE_TYPE ? "document_statement" : "measurement";
    const label = kind === "document_statement"
      ? `Source-reported statement (${claim.locator_type === DOCUMENT_EVIDENCE_LOCATOR_TYPE ? documentLocatorLabel(claim.coordinates) : "located excerpt"})`
      : claim.indicator_label || "Recorded measurement";
    citationLabels[claim.claim_id] = { kind, label, fileKind: String(claim.file_extension || "").replace(/^\./, "").toUpperCase() || null };
  }
  return {
    reportingPeriodStart: period?.period_start ?? null,
    reportingPeriodEnd: period?.period_end ?? null,
    reportIdentity: period?.report_identity ?? null,
    citationLabels,
  };
}

function composeRenderModel({ manifest, candidate, representation, context = null }) {
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
          // Every source version a multi-source measurement combines.
          ...(Array.isArray(citation.contributingSources) ? { contributingSources: citation.contributingSources.map((source) => ({ ...source })) } : {}),
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
    ...(context ? { context } : {}),
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

// Plan A Prompt 7: a manifest is released content, so every render (and so
// every Markdown/CSV/PDF/DOCX retrieval) re-runs the same P3-18 final
// eligibility gate the manifest was created under, in this read-only
// transaction: a revoked release authority, a claim that is no longer
// currently eligible (stale source, withdrawn review), or an audience
// mismatch now fails closed instead of rendering.
async function evaluateFinalEligibilityForRender(tx, input) {
  return evaluateFinalExportEligibilityInTransaction(tx, input, await createDefaultEligibilityDependencies());
}

export function createPostgresExportManifestRenderModelRepository({
  runInTransaction = withTransaction,
  evaluateCandidateCurrentness = evaluateExportCandidateCurrentnessInTransaction,
  loadCandidateRepresentation = loadExportCandidateCanonicalRepresentationInTransaction,
  evaluateFinalEligibility = evaluateFinalEligibilityForRender,
  loadReportContext = loadReportContextInTransaction,
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

          const eligibility = await evaluateFinalEligibility(tx, {
            organizationId: input.organizationId,
            exportCandidateId: manifest.export_candidate_id,
            exportReviewQueueItemId: manifest.export_review_queue_item_id,
          });
          if (!eligibility?.ok || eligibility.data?.finalExportEligible !== true) {
            return failure("conflict_current_state_changed", {
              reason: eligibility?.ok
                ? (eligibility.data.effectiveHumanExportAuthority === true ? "final_export_ineligible" : "release_authority_not_effective")
                : "final_export_eligibility_unavailable",
            });
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

          const context = await loadReportContext(tx, {
            organizationId: input.organizationId,
            generatedContentDraftId: candidateRepresentation.data.candidate.generatedContentDraftId,
          });

          return success(composeRenderModel({
            manifest,
            candidate: candidateRepresentation.data.candidate,
            representation: candidateRepresentation.data.representation,
            context,
          }));
        });
      } catch {
        return failure("system_error");
      }
    },
  });
}

export { loadReportContextInTransaction };

export const __exportManifestRenderModelRepositoryTestables = Object.freeze({
  RENDER_MODEL_CONTRACT_VERSION,
  isComposeExportManifestRenderModelInput,
  composeRenderModel,
});
