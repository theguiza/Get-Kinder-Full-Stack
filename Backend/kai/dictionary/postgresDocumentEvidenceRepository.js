import { createHash } from "node:crypto";
import {
  getScopedEvidenceItemByStatementFingerprint,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
  getScopedSourceLocatorByFingerprint,
} from "../db/kaiIntakeQueries.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { __evidenceLineageRepositorySharedWrites } from "./postgresEvidenceLineageRepository.js";
import { __sourceMeasurementRepositoryShared } from "./postgresSourceMeasurementRepository.js";
import {
  DOCUMENT_EVIDENCE_DATA_CLASS,
  DOCUMENT_EVIDENCE_FORMATS,
  DOCUMENT_EVIDENCE_LOCATOR_TYPE,
  DOCUMENT_EVIDENCE_METHOD,
  DOCUMENT_EVIDENCE_OPERATION,
  DOCUMENT_EVIDENCE_SCHEMA_READY_SQL,
  DOCUMENT_EVIDENCE_TYPE,
  DOCUMENT_EVIDENCE_VALIDATOR_KEY,
  identifyDocumentStatementCandidates,
  isDocumentLocatorCoordinates,
} from "../validators/kaiDocumentEvidenceValidators.js";

const {
  insertEvidenceReviewQueueItemIfAbsent,
  rowToEvidenceRecord,
  rowToLocatorRecord,
  rowToReviewQueueRecord,
  rowToSourceVersionRecord,
  shapeEvidenceLineageError,
  MalformedInsertedRowError,
  ConcurrentStateChangedError,
} = __evidenceLineageRepositorySharedWrites;
const {
  loadMeasurableSourceVersion,
  failure,
  success,
  resolveDefaultRunInTransaction,
  RequiredMeasurementAuditRejectedError,
} = __sourceMeasurementRepositoryShared;


const CONTENT_REFUSALS = Object.freeze({
  document_format_unsupported: ["Evidence can be read from the text of a promoted PDF or plain-text document only.", "Use the extraction or measurement action for this file's format."],
  document_upload_not_eligible: ["This source version's upload is no longer a confirmed, passed upload of the profiled file.", "Upload the file again as a new intake version."],
  document_bytes_unavailable: ["KAI could not read this source version's verified file.", "Try again; if it persists, upload the file again as a new intake version."],
  document_checksum_mismatch: ["This source version's stored file does not match the file KAI profiled.", "Upload the file again as a new intake version."],
  document_text_not_readable: ["KAI could not read this document's text as it was profiled.", "Upload the file again as a new intake version."],
  document_text_temporarily_unavailable: ["KAI could not read this document's text right now.", "Try again in a moment; nothing was written."],
  document_pdf_security_blocked: ["This PDF has active, embedded or protected content, so its text is not read.", "Upload a corrected file without attachments, scripts or protection."],
});

function refusal(code, blockingReason, message, requiredFix) {
  return failure(code, [{
    validator_key: DOCUMENT_EVIDENCE_VALIDATOR_KEY,
    severity: "blocker",
    object_type: "source_version",
    object_code: DOCUMENT_EVIDENCE_OPERATION,
    object_id: null,
    message,
    blocking_reason: blockingReason,
    required_fix: requiredFix,
    evidence: {},
  }]);
}

// Same identity formulas as P2-01 and the measurement repositories.
function locatorFingerprint({ organizationId, sourceVersionId, coordinates }) {
  return createHash("sha256")
    .update(`${organizationId}|${sourceVersionId}|${DOCUMENT_EVIDENCE_LOCATOR_TYPE}|${JSON.stringify(coordinates)}`)
    .digest("hex");
}

function statementFingerprint({ organizationId, sourceVersionId, statement }) {
  return createHash("sha256")
    .update(`${organizationId}|${sourceVersionId}|${DOCUMENT_EVIDENCE_TYPE}|${statement}`)
    .digest("hex");
}

async function insertLocatorIfAbsent(tx, { organizationId, sourceVersionId, coordinates, fingerprint }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.source_locators (
       organization_id, source_version_id, locator_type, coordinates, locator_fingerprint, created_by_type
     ) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, 'system')
     ON CONFLICT (organization_id, source_version_id, locator_fingerprint) DO NOTHING
     RETURNING source_locator_id, organization_id, source_version_id, locator_type,
               coordinates, locator_fingerprint, created_by_type, created_at`,
    [organizationId, sourceVersionId, DOCUMENT_EVIDENCE_LOCATOR_TYPE, JSON.stringify(coordinates), fingerprint],
  );
  return rows[0] || null;
}

async function insertEvidenceIfAbsent(tx, { organizationId, sourceId, sourceVersionId, sourceLocatorId, statement, fingerprint, actorUserId }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.evidence_items (
       organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class,
       sensitivity_level, support_strength, statement, statement_fingerprint, created_by, created_by_type
     ) VALUES ($1, $2, $3, $4::uuid, $5, $6, 'unknown', 'unassessed', $7, $8, $9, 'human')
     ON CONFLICT (organization_id, source_version_id, statement_fingerprint) DO NOTHING
     RETURNING evidence_item_id, organization_id, source_id, source_version_id, source_locator_id,
               evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint,
               evidence_review_status, internal_only, public_use_allowed, funder_use_allowed,
               llm_processing_allowed, product_learning_allowed, created_by, created_by_type, created_at`,
    [organizationId, sourceId, sourceVersionId, sourceLocatorId, DOCUMENT_EVIDENCE_TYPE, DOCUMENT_EVIDENCE_DATA_CLASS, statement, fingerprint, actorUserId],
  );
  return rows[0] || null;
}

async function schemaAdmitsDocumentEvidence(tx) {
  const { rows } = await tx.query(`SELECT ${DOCUMENT_EVIDENCE_SCHEMA_READY_SQL} AS ready`);
  return rows[0]?.ready === true;
}

function sameJson(a, b) {
  const canonical = (value) => (Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
      : JSON.stringify(value));
  return canonical(a) === canonical(b);
}

// One candidate's locator, evidence item and review queue item; a replay
// finds and verifies all three and writes nothing.
async function ensureCandidateEvidence(tx, { organizationId, sourceId, sourceVersionId, candidate, actorUserId }) {
  const print = locatorFingerprint({ organizationId, sourceVersionId, coordinates: candidate.coordinates });
  let locatorRow = await insertLocatorIfAbsent(tx, { organizationId, sourceVersionId, coordinates: candidate.coordinates, fingerprint: print });
  const locatorFresh = Boolean(locatorRow);
  if (!locatorRow) {
    locatorRow = await getScopedSourceLocatorByFingerprint({ organizationId, sourceVersionId, locatorFingerprint: print }, tx);
    if (!locatorRow) throw new MalformedInsertedRowError("source_locators");
  }
  if (locatorRow.locator_type !== DOCUMENT_EVIDENCE_LOCATOR_TYPE || !sameJson(locatorRow.coordinates, candidate.coordinates)) {
    throw new ConcurrentStateChangedError("source_locator");
  }

  const evidencePrint = statementFingerprint({ organizationId, sourceVersionId, statement: candidate.statement });
  let evidenceRow = await insertEvidenceIfAbsent(tx, {
    organizationId, sourceId, sourceVersionId, sourceLocatorId: locatorRow.source_locator_id, statement: candidate.statement, fingerprint: evidencePrint, actorUserId,
  });
  const evidenceFresh = Boolean(evidenceRow);
  if (!evidenceRow) {
    evidenceRow = await getScopedEvidenceItemByStatementFingerprint({ organizationId, sourceVersionId, statementFingerprint: evidencePrint }, tx);
    if (!evidenceRow) throw new MalformedInsertedRowError("evidence_items");
  }
  if (evidenceRow.evidence_type !== DOCUMENT_EVIDENCE_TYPE || evidenceRow.source_locator_id !== locatorRow.source_locator_id || evidenceRow.statement !== candidate.statement) {
    throw new ConcurrentStateChangedError("evidence_item");
  }

  let queueRow;
  if (evidenceFresh) {
    queueRow = await insertEvidenceReviewQueueItemIfAbsent(tx, { organizationId, evidenceItemId: evidenceRow.evidence_item_id, createdByType: "system" });
    if (!queueRow) throw new ConcurrentStateChangedError("review_queue_item");
  } else {
    queueRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId({ organizationId, evidenceItemId: evidenceRow.evidence_item_id }, tx);
    if (!queueRow) throw new ConcurrentStateChangedError("review_queue_item");
  }
  return { locatorRow, evidenceRow, queueRow, writes: [locatorFresh, evidenceFresh].filter(Boolean).length };
}

function documentResult({ sourceVersionRow, format, outcome, evidenceItems = [], sourceLocators = [], reviewQueueItems = [], replayed = false, identified = null, statements = [] }) {
  return {
    applicable: true,
    sourceVersion: rowToSourceVersionRecord(sourceVersionRow),
    evidenceItems,
    sourceLocators,
    reviewQueueItems,
    replayed,
    documentEvidence: {
      method: DOCUMENT_EVIDENCE_METHOD,
      format,
      outcome,
      statement_count: evidenceItems.length,
      excluded_counts: identified?.exclusions ?? {},
      candidate_limit_reached: identified?.limited ?? false,
      statements,
    },
  };
}

/**
 * KAI document-statement evidence repository. In one transaction, for one
 * promoted, current, permitted PDF or plain-text source version (the shared
 * measurement loader: P2-01 lineage, currentness, the internal-processing
 * permission predicate, effective allowed use and the exact bound profile):
 * the governed content reader reads and checks the version's own bytes, the
 * pure extractor identifies complete statements, and each becomes a
 * `document_text_span` locator, a `source_document_statement` evidence item
 * (internal-only, needs_gk_review, no public/funder/LLM/product-learning
 * use - all pinned by the schema) and its evidence-review queue item, with
 * one required actor-attributed audit when anything was written. A replay
 * writes nothing and returns the same records. A document with no complete
 * statement writes nothing and says so.
 */
export function createPostgresDocumentEvidenceRepository({
  runInTransaction,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
  documentContentReader = null,
} = {}) {
  return Object.freeze({
    /**
     * `{ applicable: false }` (nothing read) when the version's profile is
     * not a document format this extractor reads; the caller then uses the
     * field-presence extraction.
     */
    async extractDocumentEvidence({ organizationId, sourceVersionId, actorUserId, now }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      return run(async (tx) => {
        const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, operation: DOCUMENT_EVIDENCE_OPERATION });
        if (!measurable.ok) return measurable.failure;
        const { sourceVersionRow, sourceRow, fileProfileRow } = measurable;
        const format = fileProfileRow.profile?.format;
        if (!DOCUMENT_EVIDENCE_FORMATS.includes(format) || fileProfileRow.profile?.status !== "profiled") {
          return success({ applicable: false });
        }
        // Before the document-evidence schema change is installed nothing can
        // be written: say so as this version's outcome (no bytes are read),
        // never as a completed extraction.
        if (!(await schemaAdmitsDocumentEvidence(tx))) {
          return success(documentResult({ sourceVersionRow, format, outcome: "document_evidence_not_enabled" }));
        }
        if (!documentContentReader) return failure("validation_blocker");
        const read = await documentContentReader.read(tx, {
          organizationId, intakeFileId: fileProfileRow.intake_file_id, checksum: fileProfileRow.checksum, format,
        });
        if (!read.ok) {
          const [message, fix] = CONTENT_REFUSALS[read.reason] ?? ["KAI could not read this document.", "Upload the file again as a new intake version."];
          return refusal("conflict_current_state_changed", read.reason, message, fix);
        }
        const identified = identifyDocumentStatementCandidates(read.document);
        const evidenceItems = [];
        const sourceLocators = [];
        const reviewQueueItems = [];
        const statements = [];
        let writes = 0;
        for (const candidate of identified.candidates) {
          if (!isDocumentLocatorCoordinates(candidate.coordinates)) throw new MalformedInsertedRowError("document_locator");
          const ensured = await ensureCandidateEvidence(tx, {
            organizationId, sourceId: sourceRow.source_id, sourceVersionId, candidate, actorUserId,
          });
          writes += ensured.writes;
          evidenceItems.push(rowToEvidenceRecord(ensured.evidenceRow));
          sourceLocators.push(rowToLocatorRecord(ensured.locatorRow));
          reviewQueueItems.push(rowToReviewQueueRecord(ensured.queueRow));
          statements.push({ evidence_item_id: ensured.evidenceRow.evidence_item_id, assertion_kind: candidate.assertion_kind, signals: candidate.signals });
        }
        if (writes > 0) {
          const audit = await insertAuditEvent({
            operation: DOCUMENT_EVIDENCE_OPERATION,
            operation_type: DOCUMENT_EVIDENCE_OPERATION,
            actor_user_id: actorUserId,
            actor_type: "human",
            organization_id: organizationId,
            object_type: "evidence_item",
            target_object_type: "evidence_item",
            object_id: evidenceItems[0].evidence_item_id,
            reason_code: "source_document_statement_evidence_extracted",
            validator_key: DOCUMENT_EVIDENCE_VALIDATOR_KEY,
            created_at: now,
          }, tx);
          if (audit?.ok !== true) throw new RequiredMeasurementAuditRejectedError();
        }
        return success(documentResult({
          sourceVersionRow,
          format,
          outcome: evidenceItems.length > 0 ? "statements_extracted" : "no_supportable_statements",
          evidenceItems,
          sourceLocators,
          reviewQueueItems,
          // A replay found every statement already recorded; a read that
          // found none wrote nothing but is not a replay of earlier evidence.
          replayed: evidenceItems.length > 0 && writes === 0,
          identified,
          statements,
        }));
      }).catch((error) => {
        if (error instanceof RequiredMeasurementAuditRejectedError) return failure("validation_blocker");
        return failure(shapeEvidenceLineageError(error).error.code);
      });
    },
  });
}

export async function createDefaultDocumentEvidenceRepository() {
  const [{ createDocumentContentReader }, { getKaiIntakeParserReadDependencies }] = await Promise.all([
    import("../parsing/documentContentReader.js"),
    import("../services/kaiIntakeRuntimeService.js"),
  ]);
  return createPostgresDocumentEvidenceRepository({
    documentContentReader: createDocumentContentReader(getKaiIntakeParserReadDependencies()),
  });
}

export const __documentEvidenceRepositoryContract = Object.freeze({
  DOCUMENT_EVIDENCE_OPERATION,
  DOCUMENT_EVIDENCE_SCHEMA_READY_SQL,
});
