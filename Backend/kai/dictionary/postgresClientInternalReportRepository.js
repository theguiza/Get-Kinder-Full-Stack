import { withTransaction } from "../db/kaiDb.js";
import { getScopedEvidenceItemById, getScopedEvidenceMeasurementByEvidenceItemId } from "../db/kaiIntakeQueries.js";
import { evaluateClaimTraceabilityInTransaction } from "./postgresClaimTraceabilityRepository.js";
import { GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES } from "./generatedContentReviewQueueContract.js";
import { evaluateGeneratedDraftReviewPacketInTransaction } from "./postgresGeneratedContentRepository.js";
import { evaluateInternalReportAvailabilityInTransaction } from "./postgresOrganizationInternalReviewRepository.js";
import { loadReportContextInTransaction } from "./postgresExportManifestRenderModelRepository.js";
import { MEASUREMENT_EVIDENCE_TYPE, measurementLimitationCodes } from "../validators/kaiSourceMeasurementValidators.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const INTERNAL_REPORT_MODEL_CONTRACT_VERSION = "kai-sprint2-internal-report-model-v1";
const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

function failure(code) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500 } };
}

function iso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toCitationRef(index) {
  return `CIT-${String(index + 1).padStart(3, "0")}`;
}

async function readDraftRow(tx, { organizationId, generatedContentDraftId }) {
  const { rows } = await tx.query(
    `SELECT validator_results, created_at, generation_run_id::text AS generation_run_id
       FROM kai.generated_content_drafts
      WHERE organization_id = $1::uuid AND generated_content_draft_id = $2::uuid`,
    [organizationId, generatedContentDraftId],
  );
  return rows[0] || null;
}

async function readEngagementType(tx, { organizationId, engagementId }) {
  if (!engagementId) return null;
  const { rows } = await tx.query(
    "SELECT engagement_type FROM kai.engagements WHERE organization_id = $1::uuid AND engagement_id = $2::uuid",
    [organizationId, engagementId],
  );
  return rows[0]?.engagement_type ?? null;
}

async function readDefinition(tx, { organizationId, sourceMeasurementDefinitionId }) {
  const { rows } = await tx.query(
    `SELECT definition_text, inclusion_rule, exclusion_rule, counted_unit, unit_label,
            period_start::text AS period_start, period_end::text AS period_end, created_at
       FROM kai.source_measurement_definitions
      WHERE organization_id = $1::uuid AND source_measurement_definition_id = $2::uuid`,
    [organizationId, sourceMeasurementDefinitionId],
  );
  return rows[0] || null;
}

async function readSourceVersion(tx, { organizationId, sourceVersionId }) {
  const { rows } = await tx.query(
    `SELECT created_at, profile_canonical_sha256
       FROM kai.source_versions
      WHERE organization_id = $1::uuid AND source_version_id = $2::uuid`,
    [organizationId, sourceVersionId],
  );
  return rows[0] || null;
}

// The facts behind one cited claim, re-read in this transaction: its current
// internal P2-06 evaluation, its measurement and definition when it is a
// measured claim, the limitation codes it carries, and whether its internal
// authority is a recorded review decision or the ordinary measurement (no
// identity is ever read).
async function readClaimFacts(tx, { organizationId, citation, citationRefs }) {
  const traceability = await evaluateClaimTraceabilityInTransaction(tx, {
    organizationId,
    claimId: citation.claimId,
    requestedAudience: "internal",
  });
  if (!traceability.ok) return null;
  const data = traceability.data;
  // Only measurement evidence has a measurement (P2-01M); any other evidence
  // is reported as its recorded claim.
  const evidenceItemRow = await getScopedEvidenceItemById({ organizationId, evidenceItemId: citation.evidenceItemId }, tx);
  const measurementRow = evidenceItemRow?.evidence_type === MEASUREMENT_EVIDENCE_TYPE
    ? await getScopedEvidenceMeasurementByEvidenceItemId({ organizationId, evidenceItemId: citation.evidenceItemId }, tx)
    : null;
  const definitionRow = measurementRow
    ? await readDefinition(tx, { organizationId, sourceMeasurementDefinitionId: measurementRow.source_measurement_definition_id })
    : null;
  const versionRow = await readSourceVersion(tx, { organizationId, sourceVersionId: citation.sourceVersionId });
  const decision = (head) => (head ? head.decision_outcome : null);
  return {
    citationRefs,
    claimId: citation.claimId,
    evidenceItemId: citation.evidenceItemId,
    sourceId: citation.sourceId,
    sourceCode: citation.sourceCode,
    sourceVersionId: citation.sourceVersionId,
    sourceVersionCreatedAt: iso(versionRow?.created_at),
    sourceVersionCurrent: data.source_version.is_current === true,
    profileCanonicalSha256: versionRow?.profile_canonical_sha256 ?? null,
    claimStatement: data.claim.statement,
    evidenceStatement: data.evidence.statement,
    currentlyEligible: data.eligible === true,
    blockerCodes: [...data.blockerCodes],
    evidenceReviewOutcome: decision(data.evidence_review_decision),
    claimReviewOutcome: decision(data.claim_review_decision),
    measurement: measurementRow && definitionRow
      ? {
        measuredValue: measurementRow.measured_value,
        unitLabel: measurementRow.unit_label,
        countedUnit: definitionRow.counted_unit,
        totalRecordCount: measurementRow.total_record_count,
        blankRecordCount: measurementRow.blank_record_count,
        duplicateRecordCount: measurementRow.duplicate_record_count,
        calculationMethod: measurementRow.calculation_method,
        periodStart: definitionRow.period_start,
        periodEnd: definitionRow.period_end,
        definitionText: definitionRow.definition_text,
        inclusionRule: definitionRow.inclusion_rule,
        exclusionRule: definitionRow.exclusion_rule,
        definitionRecordedAt: iso(definitionRow.created_at),
      }
      : null,
    limitationCodes: measurementRow ? measurementLimitationCodes({ measurementRow, dimensions: data.dimensions }) : [],
  };
}

/**
 * The organization's internal report for one generated internal draft
 * (owner decision 2026-10-25), read in one REPEATABLE READ READ ONLY
 * transaction: the persisted draft and its citations re-evaluated through the
 * review packet (P2-06 for every cited claim; a superseded source is a 409),
 * its availability for internal use (evaluateInternalReportAvailabilityInTransaction),
 * the validator results recorded when it was generated, the report context,
 * and the facts behind every cited claim. It writes nothing - no review,
 * snapshot, candidate, release decision or manifest - and the report is
 * available only while every check passes now.
 */
export function createPostgresClientInternalReportRepository({ runInTransaction = withTransaction } = {}) {
  return Object.freeze({
    async readInternalReport({ organizationId, generatedContentDraftId }) {
      if (![organizationId, generatedContentDraftId].every((id) => UUID_PATTERN.test(id ?? ""))) return failure("validation_blocker");
      try {
        return await runInTransaction(async (tx) => {
          await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const packetResult = await evaluateGeneratedDraftReviewPacketInTransaction(
            tx,
            { organizationId, generatedContentDraftId },
            evaluateClaimTraceabilityInTransaction,
            { allowedLifecycleProfiles: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES },
          );
          if (!packetResult.ok) return packetResult;
          const packet = packetResult.data;
          const draftRow = await readDraftRow(tx, { organizationId, generatedContentDraftId });
          if (!draftRow) return failure("not_found");

          const availability = await evaluateInternalReportAvailabilityInTransaction(tx, { organizationId, packet });
          const validatorResults = Array.isArray(draftRow.validator_results) ? draftRow.validator_results : [];
          const validatorsPassed = validatorResults.length > 0 && validatorResults.every((result) => result?.severity === "pass");
          const blockedReasons = [...availability.blockedReasons, ...(validatorsPassed ? [] : ["validator_results_not_passed"])];

          const citationRefByKey = new Map();
          const citations = [];
          const blocks = [...packet.blocks].sort((a, b) => a.ordinal - b.ordinal).map((block) => ({
            ordinal: block.ordinal,
            text: block.text,
            citationRefs: block.citations.map((citation) => {
              const key = `${citation.claimId}:${citation.evidenceItemId}:${citation.sourceVersionId}`;
              if (!citationRefByKey.has(key)) {
                citationRefByKey.set(key, toCitationRef(citations.length));
                citations.push(citation);
              }
              return citationRefByKey.get(key);
            }),
          }));

          const facts = [];
          for (const [index, citation] of citations.entries()) {
            const fact = await readClaimFacts(tx, { organizationId, citation, citationRefs: [toCitationRef(index)] });
            if (!fact) return failure("conflict_current_state_changed");
            facts.push(fact);
          }

          const context = await loadReportContextInTransaction(tx, { organizationId, generatedContentDraftId });
          const engagementType = await readEngagementType(tx, { organizationId, engagementId: context?.engagementId });
          return {
            ok: true,
            error: null,
            data: {
              modelContractVersion: INTERNAL_REPORT_MODEL_CONTRACT_VERSION,
              available: availability.getKinderReviewReasons.length === 0 && blockedReasons.length === 0,
              getKinderReviewReasons: availability.getKinderReviewReasons,
              blockedReasons,
              report: {
                generatedContentDraftId,
                generationRunId: draftRow.generation_run_id,
                contentType: packet.contentType,
                audience: packet.requestedAudience,
                createdAt: iso(draftRow.created_at),
                validatorKeys: validatorResults.map((result) => result?.validator_key).filter((key) => typeof key === "string"),
              },
              context: context ? { ...context, engagementType } : null,
              blocks,
              citations: citations.map((citation, index) => ({
                citationRef: toCitationRef(index),
                claimId: citation.claimId,
                evidenceItemId: citation.evidenceItemId,
                sourceId: citation.sourceId,
                sourceCode: citation.sourceCode,
                sourceVersionId: citation.sourceVersionId,
              })),
              facts,
            },
          };
        });
      } catch {
        return failure("system_error");
      }
    },
  });
}
