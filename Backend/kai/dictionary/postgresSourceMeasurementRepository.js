import { createHash } from "node:crypto";
import {
  getScopedSourceVersionById,
  getScopedSourceById,
  getScopedSourceCandidateByIdentity,
  getScopedPromotionDecisionBySourceVersionId,
  getScopedSensitivityProfileById,
  getScopedDataDictionaryById,
  getScopedEvidenceItemByStatementFingerprint,
  getScopedSourceLocatorByFingerprint,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
} from "../db/kaiIntakeQueries.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { validateEvidenceHasSourceLineage } from "../validators/kaiEvidenceLineageValidators.js";
import { readEffectiveAllowedUseProhibition } from "./postgresEffectiveAllowedUseResolver.js";
import { validateEffectiveAllowedUsePermitsOperation } from "../validators/kaiEffectiveAllowedUseValidators.js";
import { __evidenceLineageRepositorySharedWrites } from "./postgresEvidenceLineageRepository.js";
import {
  MEASUREMENT_TYPE_RECORD_COUNT,
  MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD,
  MEASUREMENT_EVIDENCE_TYPE,
  MEASUREMENT_DATA_CLASS,
  MEASUREMENT_LOCATOR_TYPE,
  MEASUREMENT_LOCATOR_COORDINATES,
  MEASUREMENT_DEFINITION_STATUS,
  MEASUREMENT_VALIDATOR_KEY,
  computeDefinitionFingerprint,
  composeMeasurementEvidenceStatement,
  deriveRecordCountMeasurement,
  describeMeasurementLimitationCode,
  measurementLimitationCodes,
  validateComposedStatement,
} from "../validators/kaiSourceMeasurementValidators.js";

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

const MEASUREMENT_AUDIT_OPERATION = "record_source_record_count_measurement";
const RESULT_STATUS = Object.freeze({
  validation_blocker: 422,
  conflict_current_state_changed: 409,
  not_found: 404,
  system_error: 500,
});

class RequiredMeasurementAuditRejectedError extends Error {
  constructor() {
    super("required measurement audit was rejected");
    this.name = "RequiredMeasurementAuditRejectedError";
  }
}

function failure(code, blockers = null) {
  return { ok: false, data: null, error: { code, status: RESULT_STATUS[code] || 500, ...(blockers ? { blockers } : {}) } };
}

function success(data) {
  return { ok: true, data, error: null };
}

function asIso(value) {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

// The CSV whole-version locator keeps its original identity; a worksheet
// locator adds the worksheet it is scoped to.
function locatorFingerprint({ organizationId, sourceVersionId, sheetKey }) {
  const scope = sheetKey ? `${MEASUREMENT_LOCATOR_COORDINATES.scope}|${sheetKey}` : MEASUREMENT_LOCATOR_COORDINATES.scope;
  return createHash("sha256")
    .update(`${organizationId}|${sourceVersionId}|${MEASUREMENT_LOCATOR_TYPE}|${scope}`)
    .digest("hex");
}

// Same identity formula as P2-01 (organization | version | type | statement).
function statementFingerprint({ organizationId, sourceVersionId, statement }) {
  return createHash("sha256")
    .update(`${organizationId}|${sourceVersionId}|${MEASUREMENT_EVIDENCE_TYPE}|${statement}`)
    .digest("hex");
}

const DEFINITION_COLUMNS = `
  source_measurement_definition_id::text AS source_measurement_definition_id,
  organization_id::text AS organization_id,
  source_version_id::text AS source_version_id,
  measurement_type, counted_unit, unit_label, definition_text, inclusion_rule, exclusion_rule,
  period_start::text AS period_start, period_end::text AS period_end,
  definition_fingerprint, definition_status, created_by::text AS created_by, created_by_type, created_at`;

const MEASUREMENT_COLUMNS = `
  evidence_item_id::text AS evidence_item_id,
  organization_id::text AS organization_id,
  source_version_id::text AS source_version_id,
  source_measurement_definition_id::text AS source_measurement_definition_id,
  measurement_type, measured_value::int AS measured_value, unit_label, calculation_method,
  profile_canonical_sha256, total_record_count::int AS total_record_count,
  blank_record_count::int AS blank_record_count, duplicate_record_count::int AS duplicate_record_count, created_at`;

// The worksheet a measurement's identity is scoped to: the selected worksheet
// of a multi-worksheet workbook. A CSV or one-worksheet count is of the whole
// version (null), exactly as before worksheets had their own identity.
function measurementWorksheetKey(measurement) {
  return measurement.calculationMethod === MEASUREMENT_XLSX_SELECTED_CALCULATION_METHOD ? measurement.sheetKey : null;
}

// worksheet_key is read for identity only; the response records keep their
// existing shape (the worksheet is already on the locator and the basis).
function rowToDefinitionRecord({ worksheet_key: _identity, ...row }) {
  return { ...row, created_at: asIso(row.created_at) };
}

function rowToMeasurementRecord({ worksheet_key: _identity, ...row }) {
  return { ...row, created_at: asIso(row.created_at) };
}

async function readFileProfile(tx, { organizationId, fileProfileId }) {
  const { rows } = await tx.query(
    `SELECT file_profile_id::text AS file_profile_id, profile, profile_canonical_sha256
       FROM kai.intake_file_profiles
      WHERE organization_id = $1::uuid
        AND file_profile_id = $2::uuid`,
    [organizationId, fileProfileId],
  );
  return rows[0] || null;
}

// The identity conflict target: one definition and one measurement per
// organization, source version, measurement type, and worksheet.
const WORKSHEET_IDENTITY = "(organization_id, source_version_id, measurement_type, (COALESCE(worksheet_key, '')))";

async function insertDefinitionIfAbsent(tx, { organizationId, sourceVersionId, worksheetKey, definition, fingerprint, actorUserId }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.source_measurement_definitions (
       organization_id, source_version_id, measurement_type, counted_unit, unit_label, definition_text,
       inclusion_rule, exclusion_rule, period_start, period_end, definition_fingerprint, definition_status,
       created_by, created_by_type, worksheet_key
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::date, $10::date, $11, $12, $13::uuid, 'human', $14)
     ON CONFLICT ${WORKSHEET_IDENTITY} DO NOTHING
     RETURNING ${DEFINITION_COLUMNS}, worksheet_key`,
    [
      organizationId, sourceVersionId, MEASUREMENT_TYPE_RECORD_COUNT, definition.countedUnit, definition.unitLabel,
      definition.definitionText, definition.inclusionRule, definition.exclusionRule, definition.periodStart,
      definition.periodEnd, fingerprint, MEASUREMENT_DEFINITION_STATUS, actorUserId, worksheetKey,
    ],
  );
  return rows[0] || null;
}

async function readDefinition(tx, { organizationId, sourceVersionId, worksheetKey }) {
  const { rows } = await tx.query(
    `SELECT ${DEFINITION_COLUMNS}, worksheet_key
       FROM kai.source_measurement_definitions
      WHERE organization_id = $1::uuid AND source_version_id = $2::uuid AND measurement_type = $3
        AND COALESCE(worksheet_key, '') = COALESCE($4::text, '')`,
    [organizationId, sourceVersionId, MEASUREMENT_TYPE_RECORD_COUNT, worksheetKey],
  );
  return rows[0] || null;
}

// Without an identifiable worksheet, the version's definition is returned only
// when it is the version's only one; with several, the caller must name the
// worksheet, and none is chosen for it.
async function readOnlyDefinitionOfVersion(tx, { organizationId, sourceVersionId }) {
  const { rows } = await tx.query(
    `SELECT ${DEFINITION_COLUMNS}, worksheet_key
       FROM kai.source_measurement_definitions
      WHERE organization_id = $1::uuid AND source_version_id = $2::uuid AND measurement_type = $3
      LIMIT 2`,
    [organizationId, sourceVersionId, MEASUREMENT_TYPE_RECORD_COUNT],
  );
  return rows.length === 1 ? rows[0] : null;
}

async function insertLocatorIfAbsent(tx, { organizationId, sourceVersionId, coordinates, fingerprint }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.source_locators (
       organization_id, source_version_id, locator_type, coordinates, locator_fingerprint, created_by_type
     ) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, 'system')
     ON CONFLICT (organization_id, source_version_id, locator_fingerprint) DO NOTHING
     RETURNING source_locator_id, organization_id, source_version_id, locator_type,
               coordinates, locator_fingerprint, created_by_type, created_at`,
    [organizationId, sourceVersionId, MEASUREMENT_LOCATOR_TYPE, JSON.stringify(coordinates), fingerprint],
  );
  return rows[0] || null;
}

async function insertMeasurementEvidenceIfAbsent(tx, { organizationId, sourceId, sourceVersionId, sourceLocatorId, statement, fingerprint, actorUserId }) {
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
    [organizationId, sourceId, sourceVersionId, sourceLocatorId, MEASUREMENT_EVIDENCE_TYPE, MEASUREMENT_DATA_CLASS, statement, fingerprint, actorUserId],
  );
  return rows[0] || null;
}

async function insertMeasurementIfAbsent(tx, { organizationId, sourceVersionId, worksheetKey, evidenceItemId, definitionId, measurement, unitLabel, profileCanonicalSha256 }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.evidence_measurements (
       evidence_item_id, organization_id, source_version_id, source_measurement_definition_id, measurement_type,
       measured_value, unit_label, calculation_method, profile_canonical_sha256, total_record_count,
       blank_record_count, duplicate_record_count, worksheet_key
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT ${WORKSHEET_IDENTITY} DO NOTHING
     RETURNING ${MEASUREMENT_COLUMNS}, worksheet_key`,
    [
      evidenceItemId, organizationId, sourceVersionId, definitionId, MEASUREMENT_TYPE_RECORD_COUNT,
      measurement.measuredValue, unitLabel, measurement.calculationMethod, profileCanonicalSha256,
      measurement.totalRecordCount, measurement.blankRecordCount, measurement.duplicateRecordCount, worksheetKey,
    ],
  );
  return rows[0] || null;
}

async function readMeasurement(tx, { organizationId, sourceVersionId, worksheetKey }) {
  const { rows } = await tx.query(
    `SELECT ${MEASUREMENT_COLUMNS}, worksheet_key
       FROM kai.evidence_measurements
      WHERE organization_id = $1::uuid AND source_version_id = $2::uuid AND measurement_type = $3
        AND COALESCE(worksheet_key, '') = COALESCE($4::text, '')`,
    [organizationId, sourceVersionId, MEASUREMENT_TYPE_RECORD_COUNT, worksheetKey],
  );
  return rows[0] || null;
}

function definitionConflict(sourceVersionId, worksheetKey) {
  return failure("conflict_current_state_changed", [{
    validator_key: MEASUREMENT_VALIDATOR_KEY,
    severity: "blocker",
    object_type: "source_measurement_definition",
    object_code: "record_source_record_count_measurement",
    object_id: sourceVersionId,
    message: worksheetKey
      ? `A different record-count definition is already recorded for worksheet ${worksheetKey} of this source version.`
      : "A different record-count definition is already recorded for this source version.",
    blocking_reason: "measurement_definition_already_recorded",
    required_fix: "A recorded definition is immutable for its source version; upload a new intake version to measure it under another definition.",
    evidence: {},
  }]);
}

// The worksheet whose recorded definition the basis reports: the measured
// worksheet when the selection derives a measurement, else a listed worksheet
// the caller named (it may be refused for its own structure), else none.
function basisWorksheetIdentity(profile, derived, worksheetKey) {
  if (derived.ok) return { worksheetKey: measurementWorksheetKey(derived.measurement) };
  const multiWorksheet = profile?.format === "xlsx" && Array.isArray(profile.sheets) && profile.sheets.length > 1;
  if (!multiWorksheet) return { worksheetKey: null };
  if (worksheetKey !== null && profile.sheets.some((sheet) => sheet?.sheet_key === worksheetKey)) return { worksheetKey };
  return { ambiguous: true };
}

function sameMeasurement(row, { evidenceItemId, definitionId, measurement, profileCanonicalSha256 }) {
  return row.evidence_item_id === evidenceItemId
    && row.source_measurement_definition_id === definitionId
    && row.calculation_method === measurement.calculationMethod
    && row.measured_value === measurement.measuredValue
    && row.total_record_count === measurement.totalRecordCount
    && row.blank_record_count === measurement.blankRecordCount
    && row.duplicate_record_count === measurement.duplicateRecordCount
    && row.profile_canonical_sha256 === profileCanonicalSha256;
}

// The exact promoted, current, permitted source version a record count is
// measured from: the unchanged P2-01 lineage and currentness validators, the
// effective allowed use, the committed P1 profile the version was derived
// from, and the deterministic derivation. Shared by the write and the
// read-only basis so both answer from the same rules.
async function loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey = null }) {
  const refuse = (code, blockers) => ({ ok: false, failure: failure(code, blockers) });
  const sourceVersionRow = await getScopedSourceVersionById({ organizationId, sourceVersionId }, tx);
  if (!sourceVersionRow) return refuse("not_found");
  const sourceRow = await getScopedSourceById({ organizationId, sourceId: sourceVersionRow.source_id }, tx);
  if (!sourceRow) return refuse("not_found");
  const candidateRow = await getScopedSourceCandidateByIdentity(
    { organizationId, intakeSourceCandidateId: sourceVersionRow.intake_source_candidate_id },
    tx,
  );
  if (!candidateRow) return refuse("not_found");
  const decisionRow = await getScopedPromotionDecisionBySourceVersionId({ organizationId, sourceVersionId }, tx);
  if (!decisionRow) return refuse("not_found");
  const profileRow = await getScopedSensitivityProfileById(
    { organizationId, intakeSensitivityProfileId: candidateRow.intake_sensitivity_profile_id },
    tx,
  );
  if (!profileRow) return refuse("not_found");
  const dictionaryRow = await getScopedDataDictionaryById({ organizationId, dataDictionaryId: candidateRow.data_dictionary_id }, tx);
  if (!dictionaryRow) return refuse("not_found");

  const lineage = validateEvidenceHasSourceLineage({ sourceVersionRow, sourceRow, candidateRow, decisionRow, profileRow, dictionaryRow });
  if (!lineage.ok) return refuse(lineage.code);

  const allowedUse = validateEffectiveAllowedUsePermitsOperation(
    await readEffectiveAllowedUseProhibition(tx, { organizationId, intakeSensitivityProfileId: profileRow.intake_sensitivity_profile_id }),
    { operation: "record_source_record_count_measurement", objectType: "source_version", objectId: sourceVersionId },
  );
  if (!allowedUse.ok) return refuse(allowedUse.code, allowedUse.blockers);

  // The exact profile the promoted version was derived from.
  const fileProfileRow = await readFileProfile(tx, { organizationId, fileProfileId: candidateRow.file_profile_id });
  if (!fileProfileRow) return refuse("not_found");
  if (fileProfileRow.profile_canonical_sha256 !== sourceVersionRow.profile_canonical_sha256) {
    return refuse("conflict_current_state_changed");
  }
  return { ok: true, sourceVersionRow, sourceRow, fileProfileRow, derived: deriveRecordCountMeasurement(fileProfileRow.profile, worksheetKey) };
}

function worksheetOptions(profile) {
  if (profile?.format !== "xlsx" || !Array.isArray(profile.sheets) || profile.sheets.length < 2) return [];
  return profile.sheets.map((sheet) => ({
    sheet_key: sheet.sheet_key,
    sheet_name: sheet.safe_sheet_name ?? `Worksheet ${String(sheet.sheet_key).replace("sheet_", "")}`,
    data_record_count: sheet.record_count_basis?.data_record_count ?? null,
    blank_record_count: sheet.record_count_basis?.blank_record_count ?? null,
    duplicate_record_count: sheet.record_count_basis?.duplicate_record_count ?? null,
  }));
}

async function resolveDefaultRunInTransaction() {
  const { withTransaction } = await import("../db/kaiDb.js");
  return withTransaction;
}

/**
 * KAI P2-01M record-count measurement repository: in one transaction, the
 * human definition of what a record is, the measurement derived from the
 * committed P1 profile of the exact promoted, current source version, its
 * data-records locator (the whole CSV version, or a workbook's one worksheet),
 * the measurement evidence item, the evidence-review
 * queue item, and one required actor-attributed audit. Lineage, currentness,
 * and the effective allowed use are the unchanged P2-01 validators. Each
 * selected worksheet of a multi-worksheet workbook has its own definition and
 * measurement; a CSV or one-worksheet count is one per version. Idempotent:
 * the same definition replays with zero writes; a different definition for a
 * version (or worksheet) that already has one is a conflict. Concurrent calls
 * serialize on the source candidate row lock and converge on the unique
 * worksheet identity indexes.
 */
export function createPostgresSourceMeasurementRepository({ runInTransaction, insertAuditEvent = insertRequiredSuccessfulAuditEvent } = {}) {
  return Object.freeze({
    // Read-only (Plan A Prompt 8): what an organization administrator needs
    // to define the count - the authoritative profile counts and the
    // calculation, or why this version cannot be measured - and whatever is
    // already recorded for it, with the measured claim's status.
    async readSourceRecordCountMeasurementBasis({ organizationId, sourceVersionId, worksheetKey = null }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        // Writes nothing. Not a READ ONLY transaction: the shared loader takes
        // the same source-candidate row lock the write serializes on, so the
        // basis is read in the write's own order.
        return await run(async (tx) => {
          const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey });
          if (!measurable.ok) return measurable.failure;
          const { sourceVersionRow, sourceRow, derived } = measurable;
          const identity = basisWorksheetIdentity(measurable.fileProfileRow.profile, derived, worksheetKey);
          const definitionRow = identity.ambiguous
            ? await readOnlyDefinitionOfVersion(tx, { organizationId, sourceVersionId })
            : await readDefinition(tx, { organizationId, sourceVersionId, worksheetKey: identity.worksheetKey });
          const measurementRow = definitionRow
            ? await readMeasurement(tx, { organizationId, sourceVersionId, worksheetKey: definitionRow.worksheet_key })
            : null;
          const claimRow = measurementRow ? (await tx.query(
            `SELECT claim_id::text AS claim_id, statement, claim_status, claim_review_status, claim_strength
               FROM kai.claims
              WHERE organization_id = $1::uuid AND evidence_item_id = $2::uuid
              ORDER BY created_at ASC, claim_id ASC
              LIMIT 1`,
            [organizationId, measurementRow.evidence_item_id],
          )).rows[0] || null : null;
          const limitationCodes = measurementRow
            ? measurementLimitationCodes({ measurementRow: { ...measurementRow, period_start: definitionRow.period_start }, dimensions: null })
            : [];
          return success({
            sourceVersion: rowToSourceVersionRecord(sourceVersionRow),
            source: { source_id: sourceRow.source_id, source_code: sourceRow.source_code, reviewed_source_type: sourceRow.reviewed_source_type },
            basis: derived.ok
              ? {
                  measurable: true,
                  calculation_method: derived.measurement.calculationMethod,
                  source_format: derived.measurement.sheetKey ? "xlsx" : "csv",
                  worksheet: derived.measurement.sheetKey ? { sheet_key: derived.measurement.sheetKey, sheet_name: derived.measurement.sheetName } : null,
                  data_record_count: derived.measurement.totalRecordCount,
                  blank_record_count: derived.measurement.blankRecordCount,
                  duplicate_record_count: derived.measurement.duplicateRecordCount,
                  counted_record_count: derived.measurement.measuredValue,
                  worksheet_options: worksheetOptions(measurable.fileProfileRow.profile),
                }
              : { measurable: false, blockers: derived.blockers || [], worksheet_options: worksheetOptions(measurable.fileProfileRow.profile) },
            recorded: definitionRow
              ? {
                  definition: rowToDefinitionRecord(definitionRow),
                  measurement: measurementRow ? rowToMeasurementRecord(measurementRow) : null,
                  claim: claimRow,
                  limitations: limitationCodes.map((code) => ({ code, description: describeMeasurementLimitationCode(code) })),
                }
              : null,
          });
        });
      } catch (error) {
        const shaped = shapeEvidenceLineageError(error);
        return failure(shaped.error.code);
      }
    },
    async recordSourceRecordCountMeasurement({ organizationId, sourceVersionId, definition, worksheetKey = null, actorUserId, now }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      try {
        return await run(async (tx) => {
          const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey });
          if (!measurable.ok) return measurable.failure;
          const { sourceVersionRow, sourceRow, fileProfileRow, derived } = measurable;
          if (!derived.ok) return failure(derived.code, derived.blockers);
          const { measurement } = derived;

          const statement = composeMeasurementEvidenceStatement({ measurement, definition });
          const composable = validateComposedStatement(statement);
          if (!composable.ok) return failure(composable.code, composable.blockers);

          // The fingerprint is the definition's content, compared within its
          // worksheet identity; it is unchanged so every recorded one stays valid.
          const worksheetIdentity = measurementWorksheetKey(measurement);
          const fingerprint = computeDefinitionFingerprint({ organizationId, sourceVersionId, definition });
          let definitionRow = await insertDefinitionIfAbsent(tx, {
            organizationId, sourceVersionId, worksheetKey: worksheetIdentity, definition, fingerprint, actorUserId,
          });
          let definitionFresh = Boolean(definitionRow);
          if (!definitionRow) {
            definitionRow = await readDefinition(tx, { organizationId, sourceVersionId, worksheetKey: worksheetIdentity });
            if (!definitionRow) throw new MalformedInsertedRowError("source_measurement_definitions");
            definitionFresh = false;
          }
          if (definitionRow.definition_fingerprint !== fingerprint) return definitionConflict(sourceVersionId, worksheetIdentity);

          const locatorPrint = locatorFingerprint({ organizationId, sourceVersionId, sheetKey: measurement.sheetKey });
          let locatorRow = await insertLocatorIfAbsent(tx, {
            organizationId,
            sourceVersionId,
            coordinates: measurement.locatorCoordinates,
            fingerprint: locatorPrint,
          });
          if (!locatorRow) {
            locatorRow = await getScopedSourceLocatorByFingerprint({ organizationId, sourceVersionId, locatorFingerprint: locatorPrint }, tx);
            if (!locatorRow) throw new MalformedInsertedRowError("source_locators");
          }

          const evidencePrint = statementFingerprint({ organizationId, sourceVersionId, statement });
          let evidenceRow = await insertMeasurementEvidenceIfAbsent(tx, {
            organizationId,
            sourceId: sourceRow.source_id,
            sourceVersionId,
            sourceLocatorId: locatorRow.source_locator_id,
            statement,
            fingerprint: evidencePrint,
            actorUserId,
          });
          const evidenceFresh = Boolean(evidenceRow);
          if (!evidenceRow) {
            evidenceRow = await getScopedEvidenceItemByStatementFingerprint({ organizationId, sourceVersionId, statementFingerprint: evidencePrint }, tx);
            if (!evidenceRow) throw new MalformedInsertedRowError("evidence_items");
          }
          if (evidenceRow.evidence_type !== MEASUREMENT_EVIDENCE_TYPE || evidenceRow.source_locator_id !== locatorRow.source_locator_id) {
            throw new ConcurrentStateChangedError("evidence_item");
          }

          const measurementFacts = {
            evidenceItemId: evidenceRow.evidence_item_id,
            definitionId: definitionRow.source_measurement_definition_id,
            measurement,
            profileCanonicalSha256: fileProfileRow.profile_canonical_sha256,
          };
          let measurementRow = await insertMeasurementIfAbsent(tx, {
            organizationId,
            sourceVersionId,
            worksheetKey: worksheetIdentity,
            evidenceItemId: evidenceRow.evidence_item_id,
            definitionId: definitionRow.source_measurement_definition_id,
            measurement,
            unitLabel: definitionRow.unit_label,
            profileCanonicalSha256: fileProfileRow.profile_canonical_sha256,
          });
          const measurementFresh = Boolean(measurementRow);
          if (!measurementRow) {
            measurementRow = await readMeasurement(tx, { organizationId, sourceVersionId, worksheetKey: worksheetIdentity });
            if (!measurementRow) throw new MalformedInsertedRowError("evidence_measurements");
          }
          if (!sameMeasurement(measurementRow, measurementFacts)) throw new ConcurrentStateChangedError("evidence_measurement");

          // The review queue item is created only with THIS call's own fresh
          // evidence item (P2-01 rule), never as a repair of a missing one.
          let queueRow;
          if (evidenceFresh) {
            queueRow = await insertEvidenceReviewQueueItemIfAbsent(tx, {
              organizationId,
              evidenceItemId: evidenceRow.evidence_item_id,
              createdByType: "system",
            });
            if (!queueRow) throw new ConcurrentStateChangedError("review_queue_item");
          } else {
            queueRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId({ organizationId, evidenceItemId: evidenceRow.evidence_item_id }, tx);
            if (!queueRow) throw new ConcurrentStateChangedError("review_queue_item");
          }

          const freshWrites = [definitionFresh, evidenceFresh, measurementFresh].filter(Boolean).length;
          if (freshWrites > 0) {
            const audit = await insertAuditEvent({
              operation: MEASUREMENT_AUDIT_OPERATION,
              operation_type: MEASUREMENT_AUDIT_OPERATION,
              actor_user_id: actorUserId,
              actor_type: "human",
              organization_id: organizationId,
              object_type: "evidence_item",
              target_object_type: "evidence_item",
              object_id: evidenceRow.evidence_item_id,
              reason_code: "source_record_count_measured",
              validator_key: MEASUREMENT_VALIDATOR_KEY,
              created_at: now,
            }, tx);
            if (audit?.ok !== true) throw new RequiredMeasurementAuditRejectedError();
          }

          return success({
            sourceVersion: rowToSourceVersionRecord(sourceVersionRow),
            definition: rowToDefinitionRecord(definitionRow),
            measurement: rowToMeasurementRecord(measurementRow),
            evidenceItem: rowToEvidenceRecord(evidenceRow),
            sourceLocator: rowToLocatorRecord(locatorRow),
            reviewQueueItem: rowToReviewQueueRecord(queueRow),
            replayed: freshWrites === 0,
          });
        });
      } catch (error) {
        if (error instanceof RequiredMeasurementAuditRejectedError) return failure("validation_blocker");
        const shaped = shapeEvidenceLineageError(error);
        return failure(shaped.error.code);
      }
    },
  });
}

export const __sourceMeasurementRepositoryContract = Object.freeze({
  MEASUREMENT_AUDIT_OPERATION,
});
