import { projectReportingPeriodState, projectPeriodProblem } from "../../../shared/kaiProjectReportingPeriod.js";
import { createHash } from "node:crypto";
import {
  getScopedEvidenceItemByStatementFingerprint,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
  getScopedSourceLocatorByFingerprint,
  getScopedSourceVersionEngagementReportingPeriod,
  listScopedDerivedMeasurementRowsBySourceVersion,
} from "../db/kaiIntakeQueries.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { committedOutcomeHeadingSuggestion } from "../profiling/outcomeHeadingSuggestion.js";
import { profileWithCurrentPairedBasis } from "./pairedOutcomeBasisRecovery.js";
import { __evidenceLineageRepositorySharedWrites } from "./postgresEvidenceLineageRepository.js";
import { __sourceMeasurementRepositoryShared } from "./postgresSourceMeasurementRepository.js";
import {
  DERIVED_MEASUREMENT_DATA_CLASS,
  DERIVED_MEASUREMENT_EVIDENCE_TYPE,
  DERIVED_MEASUREMENT_FAMILIES,
  DERIVED_MEASUREMENT_LOCATOR_TYPE,
  DERIVED_MEASUREMENT_VALIDATOR_KEY,
  composeDerivedMeasurementEvidenceStatement,
  crossSourceWorkerMapping,
  deriveCrossSourceReachMeasurements,
  derivePersistablePairedOutcomes,
  deriveTabularMeasurement,
  derivedMeasurementArithmeticHolds,
  derivedMeasurementLimitationCodes,
  derivedMeasurementLocatorCoordinates,
  describeDerivedLimitationCode,
  describeTabularMeasurementOptions,
  describePeriodMonthCoverage,
  SCHEMA_ADMITTED_DERIVED_METHODS,
  calculateTabularMeasurementFromRecords,
  composeMeasurementTargetComparison,
  validateMeasurementTargetInput,
  resolveTabularDefinitionForSourceRecords,
  validateTabularMeasurementDefinition,
  derivedMeasurementLabelsAdmitted,
  withholdDerivedMeasurementLabels,
  resolveCrossSourceReachMapping,
  validateDerivedMeasurementInterpretation,
  validateDerivedStatements,
} from "../validators/kaiDerivedMeasurementValidators.js";

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

export const DERIVED_MEASUREMENT_RECORD_OPERATION = "record_source_derived_measurement";
export const DERIVED_MEASUREMENT_INTERPRETATION_OPERATION = "record_source_derived_measurement_interpretation";
export const MEASUREMENT_TARGET_OPERATION = "record_measurement_target";
const DERIVED_MEASUREMENT_READ_OPERATION = "read_source_derived_measurement_basis";

const MEASUREMENT_COLUMNS = `
  source_derived_measurement_id::text AS source_derived_measurement_id,
  organization_id::text AS organization_id,
  source_version_id::text AS source_version_id,
  worksheet_key, measurement_family, calculation_method, basis_version, measurement_key, definition, field_keys,
  measured_value::int AS measured_value, numerator::int AS numerator, denominator::int AS denominator,
  percentage::text AS percentage, component_counts, exclusions, row_locators, profile_canonical_sha256,
  created_by::text AS created_by, created_at`;

const INTERPRETATION_COLUMNS = `
  interpretation_id::text AS interpretation_id,
  source_derived_measurement_id::text AS source_derived_measurement_id,
  supersedes_interpretation_id::text AS supersedes_interpretation_id,
  indicator_label, meaning_text, score_direction, evidence_basis, interpretation_status,
  created_by::text AS created_by, created_at`;

function asIso(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

function locatorFingerprint({ organizationId, sourceVersionId, coordinates }) {
  return createHash("sha256")
    .update(`${organizationId}|${sourceVersionId}|${DERIVED_MEASUREMENT_LOCATOR_TYPE}|${JSON.stringify(coordinates)}`)
    .digest("hex");
}

// Same identity formula as P2-01 (organization | version | type | statement).
function statementFingerprint({ organizationId, sourceVersionId, statement }) {
  return createHash("sha256")
    .update(`${organizationId}|${sourceVersionId}|${DERIVED_MEASUREMENT_EVIDENCE_TYPE}|${statement}`)
    .digest("hex");
}

function refusal(code, blockingReason, message, requiredFix, objectType = "source_derived_measurement") {
  return failure(code, [{
    validator_key: DERIVED_MEASUREMENT_VALIDATOR_KEY,
    severity: "blocker",
    object_type: objectType,
    object_code: DERIVED_MEASUREMENT_RECORD_OPERATION,
    object_id: null,
    message,
    blocking_reason: blockingReason,
    required_fix: requiredFix,
    evidence: {},
  }]);
}

// The persisted row shape the pure statement and arithmetic functions read.
function measurementAsRow(measurement) {
  return {
    measurement_family: measurement.family,
    calculation_method: measurement.calculationMethod,
    worksheet_key: measurement.sheetKey,
    definition: measurement.definition,
    field_keys: measurement.fieldKeys,
    measured_value: measurement.measuredValue,
    numerator: measurement.numerator,
    denominator: measurement.denominator,
    percentage: measurement.percentage,
    component_counts: measurement.componentCounts,
    exclusions: measurement.exclusions,
  };
}

// jsonb stores object keys in its own order; compare content, not key order.
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function insertLocatorIfAbsent(tx, { organizationId, sourceVersionId, coordinates, fingerprint }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.source_locators (
       organization_id, source_version_id, locator_type, coordinates, locator_fingerprint, created_by_type
     ) VALUES ($1::uuid, $2::uuid, $3, $4::jsonb, $5, 'system')
     ON CONFLICT (organization_id, source_version_id, locator_fingerprint) DO NOTHING
     RETURNING source_locator_id, organization_id, source_version_id, locator_type,
               coordinates, locator_fingerprint, created_by_type, created_at`,
    [organizationId, sourceVersionId, DERIVED_MEASUREMENT_LOCATOR_TYPE, JSON.stringify(coordinates), fingerprint],
  );
  return rows[0] || null;
}

function sameArithmetic(row, measurement, profileCanonicalSha256) {
  return row.calculation_method === measurement.calculationMethod
    && row.measurement_family === measurement.family
    && row.measured_value === measurement.measuredValue
    && row.numerator === measurement.numerator
    && (row.denominator ?? null) === (measurement.denominator ?? null)
    && (row.percentage ?? null) === (measurement.percentage ?? null)
    && canonicalJson(row.component_counts) === canonicalJson(measurement.componentCounts)
    && canonicalJson(row.definition) === canonicalJson(measurement.definition)
    && row.profile_canonical_sha256 === profileCanonicalSha256;
}

async function insertMeasurementIfAbsent(tx, { organizationId, sourceVersionId, measurement, profileCanonicalSha256, actorUserId }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.source_derived_measurements (
       organization_id, source_version_id, worksheet_key, measurement_family, calculation_method, basis_version,
       measurement_key, definition, field_keys, measured_value, numerator, denominator, percentage,
       component_counts, exclusions, row_locators, profile_canonical_sha256, created_by, created_by_type
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13::numeric,
               $14::jsonb, $15::jsonb, $16::jsonb, $17, $18::uuid, 'human')
     ON CONFLICT (organization_id, source_version_id, (COALESCE(worksheet_key, '')), measurement_key) DO NOTHING
     RETURNING ${MEASUREMENT_COLUMNS}`,
    [
      organizationId, sourceVersionId, measurement.sheetKey, measurement.family, measurement.calculationMethod,
      measurement.basisVersion, measurement.measurementKey, JSON.stringify(measurement.definition),
      JSON.stringify(measurement.fieldKeys), measurement.measuredValue, measurement.numerator, measurement.denominator,
      measurement.percentage, JSON.stringify(measurement.componentCounts), JSON.stringify(measurement.exclusions),
      measurement.rowLocators ? JSON.stringify(measurement.rowLocators) : null, profileCanonicalSha256, actorUserId,
    ],
  );
  return rows[0] || null;
}

async function readMeasurementByKey(tx, { organizationId, sourceVersionId, worksheetKey, measurementKey }) {
  const { rows } = await tx.query(
    `SELECT ${MEASUREMENT_COLUMNS}
       FROM kai.source_derived_measurements
      WHERE organization_id = $1::uuid AND source_version_id = $2::uuid
        AND COALESCE(worksheet_key, '') = COALESCE($3::text, '') AND measurement_key = $4`,
    [organizationId, sourceVersionId, worksheetKey, measurementKey],
  );
  return rows[0] || null;
}

async function readMeasurementById(tx, { organizationId, measurementId }) {
  const { rows } = await tx.query(
    `SELECT ${MEASUREMENT_COLUMNS}
       FROM kai.source_derived_measurements
      WHERE organization_id = $1::uuid AND source_derived_measurement_id = $2::uuid`,
    [organizationId, measurementId],
  );
  return rows[0] || null;
}

async function readCurrentInterpretation(tx, { organizationId, measurementId }) {
  const { rows } = await tx.query(
    `SELECT ${INTERPRETATION_COLUMNS}
       FROM kai.source_derived_measurement_interpretations c
      WHERE c.organization_id = $1::uuid AND c.source_derived_measurement_id = $2::uuid
        AND NOT EXISTS (
          SELECT 1 FROM kai.source_derived_measurement_interpretations n
           WHERE n.source_derived_measurement_id = c.source_derived_measurement_id
             AND n.supersedes_interpretation_id = c.interpretation_id
        )`,
    [organizationId, measurementId],
  );
  if (rows.length > 1) throw new ConcurrentStateChangedError("source_derived_measurement_interpretation");
  return rows[0] || null;
}

async function insertInterpretation(tx, { organizationId, measurementId, supersedesId, interpretation, actorUserId }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.source_derived_measurement_interpretations (
       organization_id, source_derived_measurement_id, supersedes_interpretation_id, indicator_label, meaning_text,
       score_direction, evidence_basis, interpretation_status, created_by, created_by_type
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'human_stated', $8::uuid, 'human')
     ON CONFLICT (source_derived_measurement_id, (COALESCE(supersedes_interpretation_id::text, ''))) DO NOTHING
     RETURNING ${INTERPRETATION_COLUMNS}`,
    [
      organizationId, measurementId, supersedesId, interpretation.indicatorLabel, interpretation.meaningText,
      interpretation.scoreDirection, interpretation.evidenceBasis, actorUserId,
    ],
  );
  if (!rows[0]) throw new ConcurrentStateChangedError("source_derived_measurement_interpretation");
  return rows[0];
}

function sameInterpretation(row, interpretation) {
  return Boolean(row)
    && row.indicator_label === interpretation.indicatorLabel
    && row.meaning_text === interpretation.meaningText
    && (row.score_direction ?? null) === (interpretation.scoreDirection ?? null)
    && row.evidence_basis === interpretation.evidenceBasis;
}

function interpretationRecord(row) {
  return row ? { ...row, created_at: asIso(row.created_at) } : null;
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
    [organizationId, sourceId, sourceVersionId, sourceLocatorId, DERIVED_MEASUREMENT_EVIDENCE_TYPE, DERIVED_MEASUREMENT_DATA_CLASS, statement, fingerprint, actorUserId],
  );
  return rows[0] || null;
}

async function insertEvidenceLinkIfAbsent(tx, { organizationId, sourceVersionId, evidenceItemId, measurementId, interpretationId }) {
  const { rows } = await tx.query(
    `INSERT INTO kai.evidence_derived_measurements (
       evidence_item_id, organization_id, source_version_id, source_derived_measurement_id, interpretation_id
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
     ON CONFLICT DO NOTHING
     RETURNING evidence_item_id::text AS evidence_item_id`,
    [evidenceItemId, organizationId, sourceVersionId, measurementId, interpretationId],
  );
  return rows[0] || null;
}

async function readEvidenceLink(tx, { organizationId, measurementId, interpretationId }) {
  const { rows } = await tx.query(
    `SELECT evidence_item_id::text AS evidence_item_id, source_derived_measurement_id::text AS source_derived_measurement_id,
            interpretation_id::text AS interpretation_id
       FROM kai.evidence_derived_measurements
      WHERE organization_id = $1::uuid AND source_derived_measurement_id = $2::uuid
        AND COALESCE(interpretation_id::text, '') = COALESCE($3::text, '')`,
    [organizationId, measurementId, interpretationId],
  );
  return rows[0] || null;
}

/**
 * The measurement's evidence under its current interpretation (or none):
 * the fields locator, the evidence item, the evidence link and the review
 * queue item, created only with this call's own fresh evidence item.
 */
async function ensureCurrentEvidence(tx, { organizationId, sourceRow, sourceVersionId, measurementRow, interpretationRow, actorUserId }) {
  const interpretation = interpretationRow
    ? { indicator_label: interpretationRow.indicator_label, meaning_text: interpretationRow.meaning_text, score_direction: interpretationRow.score_direction, evidence_basis: interpretationRow.evidence_basis }
    : null;
  const composable = validateDerivedStatements({ measurementRow, interpretation });
  if (!composable.ok) return { refused: failure(composable.code, composable.blockers) };
  const statement = composeDerivedMeasurementEvidenceStatement({ measurementRow, interpretation });

  const coordinates = derivedMeasurementLocatorCoordinates({ sheetKey: measurementRow.worksheet_key, fieldKeys: measurementRow.field_keys });
  const locatorPrint = locatorFingerprint({ organizationId, sourceVersionId, coordinates });
  let locatorRow = await insertLocatorIfAbsent(tx, { organizationId, sourceVersionId, coordinates, fingerprint: locatorPrint });
  if (!locatorRow) {
    locatorRow = await getScopedSourceLocatorByFingerprint({ organizationId, sourceVersionId, locatorFingerprint: locatorPrint }, tx);
    if (!locatorRow) throw new MalformedInsertedRowError("source_locators");
  }
  if (locatorRow.locator_type !== DERIVED_MEASUREMENT_LOCATOR_TYPE) throw new ConcurrentStateChangedError("source_locator");

  const evidencePrint = statementFingerprint({ organizationId, sourceVersionId, statement });
  let evidenceRow = await insertEvidenceIfAbsent(tx, {
    organizationId, sourceId: sourceRow.source_id, sourceVersionId, sourceLocatorId: locatorRow.source_locator_id, statement, fingerprint: evidencePrint, actorUserId,
  });
  const evidenceFresh = Boolean(evidenceRow);
  if (!evidenceRow) {
    evidenceRow = await getScopedEvidenceItemByStatementFingerprint({ organizationId, sourceVersionId, statementFingerprint: evidencePrint }, tx);
    if (!evidenceRow) throw new MalformedInsertedRowError("evidence_items");
  }
  if (evidenceRow.evidence_type !== DERIVED_MEASUREMENT_EVIDENCE_TYPE || evidenceRow.source_locator_id !== locatorRow.source_locator_id) {
    throw new ConcurrentStateChangedError("evidence_item");
  }
  const interpretationId = interpretationRow?.interpretation_id ?? null;
  if (evidenceFresh) {
    const linked = await insertEvidenceLinkIfAbsent(tx, {
      organizationId, sourceVersionId, evidenceItemId: evidenceRow.evidence_item_id, measurementId: measurementRow.source_derived_measurement_id, interpretationId,
    });
    if (!linked) throw new ConcurrentStateChangedError("evidence_derived_measurement");
  }
  const link = await readEvidenceLink(tx, { organizationId, measurementId: measurementRow.source_derived_measurement_id, interpretationId });
  if (!link || link.evidence_item_id !== evidenceRow.evidence_item_id) throw new ConcurrentStateChangedError("evidence_derived_measurement");

  let queueRow;
  if (evidenceFresh) {
    queueRow = await insertEvidenceReviewQueueItemIfAbsent(tx, { organizationId, evidenceItemId: evidenceRow.evidence_item_id, createdByType: "system" });
    if (!queueRow) throw new ConcurrentStateChangedError("review_queue_item");
  } else {
    queueRow = await getScopedEvidenceReviewQueueItemByEvidenceItemId({ organizationId, evidenceItemId: evidenceRow.evidence_item_id }, tx);
    if (!queueRow) throw new ConcurrentStateChangedError("review_queue_item");
  }
  return { evidenceFresh, evidenceRow, locatorRow, queueRow };
}

async function writeAudit(insertAuditEvent, tx, { operation, reasonCode, organizationId, actorUserId, objectId, now }) {
  const audit = await insertAuditEvent({
    operation,
    operation_type: operation,
    actor_user_id: actorUserId,
    actor_type: "human",
    organization_id: organizationId,
    object_type: "evidence_item",
    target_object_type: "evidence_item",
    object_id: objectId,
    reason_code: reasonCode,
    validator_key: DERIVED_MEASUREMENT_VALIDATOR_KEY,
    created_at: now,
  }, tx);
  if (audit?.ok !== true) throw new RequiredMeasurementAuditRejectedError();
}

async function readReportingPeriod(tx, { organizationId, sourceVersionId }) {
  const row = await getScopedSourceVersionEngagementReportingPeriod({ organizationId, sourceVersionId }, tx);
  return projectReportingPeriodState({ engagementId: row?.engagement_id, start: row?.period_start, end: row?.period_end });
}

function measurementRecord(row) {
  return { ...row, created_at: asIso(row.created_at) };
}

const TARGET_COLUMNS = `
  measurement_target_id::text AS measurement_target_id, engagement_id::text AS engagement_id, source_id::text AS source_id,
  worksheet_key, measurement_key, measurement_family, target_unit, target_value::text AS target_value, comparison,
  set_on_measurement_id::text AS set_on_measurement_id, supersedes_target_id::text AS supersedes_target_id, created_at`;

// The current (not superseded) targets of one source on one Project.
async function readCurrentTargets(tx, { organizationId, engagementId, sourceId, lock = false }) {
  const { rows } = await tx.query(
    `SELECT ${TARGET_COLUMNS} FROM kai.measurement_targets t
      WHERE t.organization_id = $1::uuid AND t.engagement_id = $2::uuid AND t.source_id = $3::uuid
        AND NOT EXISTS (SELECT 1 FROM kai.measurement_targets n WHERE n.organization_id = t.organization_id AND n.supersedes_target_id = t.measurement_target_id)
      ORDER BY t.created_at${lock ? " FOR UPDATE" : ""}`,
    [organizationId, engagementId, sourceId],
  );
  return rows.map((row) => ({ ...row, created_at: asIso(row.created_at) }));
}

// A stored numeric(14,2) target ("40.00") and a validated one ("40", "75.50") compared exactly, in hundredths.
function sameTargetValue(stored, validated) {
  const hundredths = (value) => {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value ?? ""));
    return match ? BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0") : null;
  };
  const a = hundredths(stored);
  return a !== null && a === hundredths(validated);
}

function targetFor(targets, row) {
  return targets.find((target) => target.measurement_key === row.measurement_key && (target.worksheet_key ?? null) === (row.worksheet_key ?? null)) ?? null;
}

const CONTRIBUTING_SOURCE_COLUMNS = `
  source_version_id::text AS source_version_id, source_role, profile_canonical_sha256, field_keys, worksheet_key`;

async function insertContributingSourceIfAbsent(tx, { organizationId, measurementId, source }) {
  await tx.query(
    `INSERT INTO kai.source_derived_measurement_sources (
       source_derived_measurement_id, organization_id, source_version_id, source_role, profile_canonical_sha256, field_keys, worksheet_key
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7)
     ON CONFLICT DO NOTHING`,
    [measurementId, organizationId, source.sourceVersionId, source.role, source.profileCanonicalSha256, JSON.stringify(source.fieldKeys), source.worksheetKey ?? null],
  );
}

async function readContributingSources(tx, { organizationId, measurementId }) {
  const { rows } = await tx.query(
    `SELECT ${CONTRIBUTING_SOURCE_COLUMNS}
       FROM kai.source_derived_measurement_sources
      WHERE organization_id = $1::uuid AND source_derived_measurement_id = $2::uuid
      ORDER BY source_role`,
    [organizationId, measurementId],
  );
  return rows;
}

// The contributing sources a cross-source measurement must hold, exactly.
function sameContributingSources(rows, sources) {
  const expected = [...sources].sort((a, b) => (a.role < b.role ? -1 : 1));
  return rows.length === expected.length && rows.every((row, index) => row.source_version_id === expected[index].sourceVersionId
    && row.source_role === expected[index].role
    && row.profile_canonical_sha256 === expected[index].profileCanonicalSha256
    && (row.worksheet_key ?? null) === (expected[index].worksheetKey ?? null)
    && canonicalJson(row.field_keys) === canonicalJson(expected[index].fieldKeys));
}

// Maps a reconciliation worker refusal to the shared blocker shape.
// Both cross-source versions through the shared loader, and the person's
// mapping resolved against both committed profiles and the recorded period.
async function admitCrossSourceVersions(tx, { organizationId, primarySourceVersionId, referenceSourceVersionId, mapping, primaryWorksheetKey = null, referenceWorksheetKey = null }) {
  const primary = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId: primarySourceVersionId, worksheetKey: primaryWorksheetKey, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
  if (!primary.ok) return primary;
  const reference = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId: referenceSourceVersionId, worksheetKey: referenceWorksheetKey, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
  if (!reference.ok) return reference;
  const periodState = await readReportingPeriod(tx, { organizationId, sourceVersionId: primarySourceVersionId });
  if (periodState.status !== "recorded") return { ok: false, failure: refusal("validation_blocker", periodState.status, projectPeriodProblem(periodState), "Resolve this source's Project reporting period before linking sources.") };
  const reportingPeriod = periodState.period;
  const resolved = resolveCrossSourceReachMapping({
    eventsProfile: primary.fileProfileRow.profile, registerProfile: reference.fileProfileRow.profile, mapping, reportingPeriod,
    eventsWorksheetKey: primaryWorksheetKey, registerWorksheetKey: referenceWorksheetKey, sameVersion: primarySourceVersionId === referenceSourceVersionId,
  });
  if (!resolved.ok) return { ok: false, failure: failure(resolved.code, resolved.blockers) };
  return { ok: true, primary, reference, resolved };
}

const WORKER_REFUSALS = Object.freeze({
  cross_source_upload_not_eligible: ["A linked source's upload is no longer a confirmed, passed upload of the profiled file.", "Upload the file again as a new intake version."],
  cross_source_bytes_unavailable: ["KAI could not read a linked source version's verified bytes.", "Try again; if it persists, upload the file again as a new intake version."],
  cross_source_csv_not_readable: ["A source version could not be read as the table KAI profiled.", "Upload the file again as a new intake version."],
  cross_source_checksum_mismatch: ["A linked source version's stored bytes do not match the file KAI profiled.", "Upload the file again as a new intake version."],
  cross_source_duration_precision_unsupported: ["A duration value exceeds the supported numeric precision.", "Correct the source value and upload a new source version."],
});

function withCaught(run, body) {
  return run(body).catch((error) => {
    if (error instanceof RequiredMeasurementAuditRejectedError) return failure("validation_blocker");
    return failure(shapeEvidenceLineageError(error).error.code);
  });
}

/**
 * KAI Measurement MVP repository: source-derived measurements of the exact
 * promoted, current, permitted source version, through the same loader as
 * the P2-01M record count (P2-01 lineage, currentness, effective allowed
 * use, the exact bound profile). Each write is one transaction: the
 * measurement (retained without any human definition), an optional human
 * interpretation, the fields locator, the evidence item under the current
 * interpretation, its link, its review queue item, and one actor-attributed
 * metadata-only audit when anything was written. A replay writes nothing.
 */
export function createPostgresDerivedMeasurementRepository({
  runInTransaction,
  insertAuditEvent = insertRequiredSuccessfulAuditEvent,
  crossSourceReconciliationWorker = null,
} = {}) {
  async function recordMeasurements(tx, { organizationId, sourceVersionId, measurements, sourceRow, profileCanonicalSha256, interpretation, actorUserId, now, contributingSources = null }) {
    const results = [];
    let fresh = 0;
    let auditObjectId = null;
    for (const measurement of measurements) {
      // A calculated method the schema does not admit is never written.
      if (!SCHEMA_ADMITTED_DERIVED_METHODS.has(measurement.calculationMethod)) {
        return { refused: refusal("validation_blocker", "derived_measurement_method_not_recordable", "This calculation cannot be recorded yet.", "Record a supported measurement.") };
      }
      if (!derivedMeasurementArithmeticHolds(measurementAsRow(measurement))) {
        return { refused: refusal("validation_blocker", "derived_measurement_arithmetic_invalid", "The calculated measurement does not keep its own arithmetic.", "Upload the source again as a new intake version.") };
      }
      let measurementRow = await insertMeasurementIfAbsent(tx, { organizationId, sourceVersionId, measurement, profileCanonicalSha256, actorUserId });
      const measurementFresh = Boolean(measurementRow);
      if (!measurementRow) {
        measurementRow = await readMeasurementByKey(tx, { organizationId, sourceVersionId, worksheetKey: measurement.sheetKey, measurementKey: measurement.measurementKey });
        if (!measurementRow) throw new MalformedInsertedRowError("source_derived_measurements");
      }
      if (!sameArithmetic(measurementRow, measurement, profileCanonicalSha256)) throw new ConcurrentStateChangedError("source_derived_measurement");
      // A cross-source measurement records every source version it combines
      // in the same transaction; a replay finds exactly the same sources.
      let sourcesFresh = false;
      if (contributingSources) {
        let sourceRows = await readContributingSources(tx, { organizationId, measurementId: measurementRow.source_derived_measurement_id });
        if (sourceRows.length === 0) {
          for (const source of contributingSources) {
            await insertContributingSourceIfAbsent(tx, { organizationId, measurementId: measurementRow.source_derived_measurement_id, source });
          }
          sourceRows = await readContributingSources(tx, { organizationId, measurementId: measurementRow.source_derived_measurement_id });
          sourcesFresh = true;
        }
        if (!sameContributingSources(sourceRows, contributingSources)) throw new ConcurrentStateChangedError("source_derived_measurement_sources");
        measurementRow = { ...measurementRow, contributing_sources: sourceRows };
      }

      let interpretationRow = await readCurrentInterpretation(tx, { organizationId, measurementId: measurementRow.source_derived_measurement_id });
      let interpretationFresh = false;
      if (interpretation) {
        if (!interpretationRow) {
          interpretationRow = await insertInterpretation(tx, { organizationId, measurementId: measurementRow.source_derived_measurement_id, supersedesId: null, interpretation, actorUserId });
          interpretationFresh = true;
        } else if (!sameInterpretation(interpretationRow, interpretation)) {
          return { refused: refusal("conflict_current_state_changed", "derived_measurement_interpretation_already_recorded", "This measurement already has a different interpretation.", "Clarify the measurement's meaning with its interpretation action instead.") };
        }
      }
      const evidence = await ensureCurrentEvidence(tx, { organizationId, sourceRow, sourceVersionId, measurementRow, interpretationRow, actorUserId });
      if (evidence.refused) return evidence;
      const writes = [measurementFresh, sourcesFresh, interpretationFresh, evidence.evidenceFresh].filter(Boolean).length;
      fresh += writes;
      if (writes > 0 && !auditObjectId) auditObjectId = evidence.evidenceRow.evidence_item_id;
      results.push({
        measurement: measurementRecord(measurementRow),
        interpretation: interpretationRecord(interpretationRow),
        evidenceItem: rowToEvidenceRecord(evidence.evidenceRow),
        sourceLocator: rowToLocatorRecord(evidence.locatorRow),
        reviewQueueItem: rowToReviewQueueRecord(evidence.queueRow),
        replayed: writes === 0,
      });
    }
    if (fresh > 0) {
      await writeAudit(insertAuditEvent, tx, {
        operation: DERIVED_MEASUREMENT_RECORD_OPERATION, reasonCode: "source_derived_measurement_recorded", organizationId, actorUserId, objectId: auditObjectId, now,
      });
    }
    return { results, replayed: fresh === 0 };
  }

  return Object.freeze({
    // Read-only: what can be measured on one version (and worksheet), and
    // every measurement recorded for the version with its current
    // interpretation, current evidence, claim and limitations.
    async readDerivedMeasurementBasis({ organizationId, sourceVersionId, worksheetKey = null }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      return withCaught(run, async (tx) => {
        const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey, operation: DERIVED_MEASUREMENT_READ_OPERATION });
        if (!measurable.ok) return measurable.failure;
        const { sourceVersionRow, sourceRow, fileProfileRow } = measurable;
        const profile = await profileWithCurrentPairedBasis(tx, { organizationId, fileProfileRow, worksheetKey, worker: crossSourceReconciliationWorker });
        const paired = profile?.format === "xlsx" ? derivePersistablePairedOutcomes(profile, worksheetKey) : null;
        const tabular = describeTabularMeasurementOptions(profile, worksheetKey);
        const rows = await listScopedDerivedMeasurementRowsBySourceVersion({ organizationId, sourceVersionId }, tx);
        const claims = rows.length > 0 ? (await tx.query(
          `SELECT claim_id::text AS claim_id, evidence_item_id::text AS evidence_item_id, statement, claim_status, claim_review_status, claim_strength
             FROM kai.claims WHERE organization_id = $1::uuid AND evidence_item_id = ANY($2::uuid[])`,
          [organizationId, rows.map((row) => row.evidence_item_id)],
        )).rows : [];
        const recorded = new Map();
        for (const row of rows) {
          // Labels an earlier profile listed but the current screen withholds
          // are not returned, and neither are statements carrying them.
          const labelsAdmitted = derivedMeasurementLabelsAdmitted(row);
          const shown = labelsAdmitted ? row : { ...row, ...withholdDerivedMeasurementLabels(row) };
          const entry = recorded.get(row.source_derived_measurement_id) ?? {
            source_derived_measurement_id: row.source_derived_measurement_id,
            worksheet_key: row.worksheet_key,
            measurement_family: row.measurement_family,
            calculation_method: row.calculation_method,
            definition: shown.definition,
            field_keys: row.field_keys,
            measured_value: row.measured_value,
            numerator: row.numerator,
            denominator: row.denominator,
            percentage: row.percentage,
            component_counts: shown.component_counts,
            exclusions: row.exclusions,
            contributing_sources: row.contributing_sources ?? [],
            current_interpretation_id: row.current_interpretation_id,
            // An unconfirmed short name suggested from the outcome column's
            // heading, from the exact profile this measurement was calculated
            // from. It is context for the person answering; it is not a meaning.
            source_heading_suggestion: row.measurement_family === DERIVED_MEASUREMENT_FAMILIES.PAIRED_OUTCOME
              && row.measurement_source_version_id === sourceVersionId
              && row.profile_canonical_sha256 === fileProfileRow.profile_canonical_sha256
              ? committedOutcomeHeadingSuggestion(profile, { worksheetKey: row.worksheet_key, outcomeFieldKey: row.definition?.outcome_field_key })
              : null,
            ...(labelsAdmitted ? {} : { category_labels_withheld: true }),
            evidence: [],
          };
          const current = (row.interpretation_id ?? null) === (row.current_interpretation_id ?? null);
          entry.evidence.push({
            evidence_item_id: row.evidence_item_id,
            statement: labelsAdmitted ? row.evidence_statement : null,
            interpretation: row.interpretation_id
              ? { interpretation_id: row.interpretation_id, indicator_label: row.indicator_label, meaning_text: row.meaning_text, score_direction: row.score_direction, evidence_basis: row.evidence_basis }
              : null,
            current,
            claim: (() => {
              const claim = claims.find((candidate) => candidate.evidence_item_id === row.evidence_item_id) ?? null;
              return claim && !labelsAdmitted ? { ...claim, statement: null } : claim;
            })(),
            limitations: derivedMeasurementLimitationCodes({ measurementRow: row, dimensions: null })
              .map((code) => ({ code, description: describeDerivedLimitationCode(code) })),
          });
          recorded.set(row.source_derived_measurement_id, entry);
        }
        const periodContext = await readReportingPeriod(tx, { organizationId, sourceVersionId });
        // The organization's planned targets for these measurements on this Project, compared with each recorded actual.
        const targets = periodContext.engagement_id
          ? await readCurrentTargets(tx, { organizationId, engagementId: periodContext.engagement_id, sourceId: sourceRow.source_id })
          : [];
        for (const entry of recorded.values()) {
          const row = rows.find((candidate) => candidate.source_derived_measurement_id === entry.source_derived_measurement_id);
          const target = row ? targetFor(targets, row) : null;
          entry.target = target ? { measurement_target_id: target.measurement_target_id, target_unit: target.target_unit, target_value: target.target_value, comparison: target.comparison } : null;
          entry.target_comparison = target ? composeMeasurementTargetComparison({ measurementRow: row, target }) : null;
        }
        return success({
          sourceVersion: rowToSourceVersionRecord(sourceVersionRow),
          source: { source_id: sourceRow.source_id, source_code: sourceRow.source_code, reviewed_source_type: sourceRow.reviewed_source_type },
          lineage: {
            organization_id: organizationId,
            source_id: sourceRow.source_id,
            source_version_id: sourceVersionRow.source_version_id,
            file_profile_id: fileProfileRow.file_profile_id,
            profile_canonical_sha256: fileProfileRow.profile_canonical_sha256,
          },
          reporting_period_context: periodContext,
          reporting_period: periodContext.period,
          // Which months the recorded period covers only in part, and the
          // records in them, so a partial-month calculation is checked first.
          period_month_coverage: periodContext.period ? describePeriodMonthCoverage(profile, worksheetKey, periodContext.period) : null,
          paired: paired === null ? null : paired.ok
            ? { available: true, worksheet: paired.worksheet, measurements: paired.measurements.map((item) => (item.available
              ? { available: true, outcome_field_key: item.definition.outcome_field_key, outcome_column: item.definition.outcome_column, numerator: item.numerator, denominator: item.denominator, percentage: item.percentage, component_counts: item.componentCounts,
                source_heading_suggestion: committedOutcomeHeadingSuggestion(profile, { worksheetKey: item.sheetKey, outcomeFieldKey: item.definition.outcome_field_key }) }
              : { available: false, outcome_field_key: item.outcomeFieldKey, blockers: item.blockers })) }
            : { available: false, blockers: paired.blockers, proposed_pairings: paired.proposedPairings || [] },
          tabular: tabular.ok ? tabular : { available: false, blockers: tabular.blockers },
          // A workbook's worksheets, so a linkage can name the register worksheet.
          worksheets: profile?.format === "xlsx" && Array.isArray(profile.sheets)
            ? profile.sheets.map((sheet) => ({ sheet_key: sheet.sheet_key, sheet_name: sheet.safe_sheet_name ?? sheet.sheet_key }))
            : [],
          recorded: [...recorded.values()],
        });
      });
    },

    // Package A: retain every available paired outcome of one worksheet as a
    // proposed numerical result. No meaning or direction is required.
    async recordPairedOutcomeMeasurements({ organizationId, sourceVersionId, worksheetKey = null, pairing = null, actorUserId, now }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      return withCaught(run, async (tx) => {
        const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
        if (!measurable.ok) return measurable.failure;
        const { sourceVersionRow, sourceRow, fileProfileRow } = measurable;
        const profile = await profileWithCurrentPairedBasis(tx, { organizationId, fileProfileRow, worksheetKey, worker: crossSourceReconciliationWorker });
        const derived = derivePersistablePairedOutcomes(profile, worksheetKey, { pairing });
        if (!derived.ok) return failure(derived.code, derived.blockers);
        const available = derived.measurements.filter((item) => item.available);
        if (available.length === 0) {
          return refusal("validation_blocker", "paired_outcome_no_measurement_available", "No outcome field of this worksheet can be measured.", "Select the worksheet whose rows are baseline and follow-up observations.");
        }
        const recorded = await recordMeasurements(tx, {
          organizationId, sourceVersionId, measurements: available, sourceRow, profileCanonicalSha256: fileProfileRow.profile_canonical_sha256, interpretation: null, actorUserId, now,
        });
        if (recorded.refused) return recorded.refused;
        return success({
          sourceVersion: rowToSourceVersionRecord(sourceVersionRow),
          measurements: recorded.results,
          unavailable: derived.measurements.filter((item) => !item.available),
          replayed: recorded.replayed,
        });
      });
    },

    // Package B: one content-aware tabular count or rate under a person's
    // field selection, with an optional interpretation recorded with it.
    async recordTabularMeasurement({ organizationId, sourceVersionId, worksheetKey = null, definition, interpretation = null, actorUserId, now, enqueueExactPeriod = null }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      return withCaught(run, async (tx) => {
        const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
        if (!measurable.ok) return measurable.failure;
        const { sourceVersionRow, sourceRow, fileProfileRow } = measurable;
        // The engagement's period is read only when the definition applies one.
        const needsPeriod = definition.conditions.some((condition) => condition.kind === "period");
        const periodState = needsPeriod ? await readReportingPeriod(tx, { organizationId, sourceVersionId }) : null;
        if (needsPeriod && periodState.status !== "recorded") {
          return refusal("validation_blocker", periodState.status, projectPeriodProblem(periodState), "Resolve this source's KAI Project period, or measure without a period.");
        }
        const reportingPeriod = periodState?.period ?? null;
        const derived = deriveTabularMeasurement(fileProfileRow.profile, worksheetKey, definition, { reportingPeriod });
        // Exact days the profile does not hold: queue the calculation from the
        // verified uploaded file (owner authorization 2026-11-18). No byte is read here.
        if (!derived.ok && derived.needsSourceRecords && enqueueExactPeriod) {
          const resolved = resolveTabularDefinitionForSourceRecords(fileProfileRow.profile, worksheetKey, definition, { reportingPeriod });
          if (!resolved.ok) return failure(resolved.code, resolved.blockers);
          const queued = await enqueueExactPeriod(tx, {
            primaryProfileCanonicalSha256: fileProfileRow.profile_canonical_sha256,
            worksheetKey: resolved.resolved.sheetKey,
            mapping: { definition, period: { period_start: reportingPeriod.start, period_end: reportingPeriod.end } },
          });
          return success({ sourceVersion: rowToSourceVersionRecord(sourceVersionRow), queued: true, ...queued });
        }
        if (!derived.ok) return failure(derived.code, derived.blockers);
        const recorded = await recordMeasurements(tx, {
          organizationId, sourceVersionId, measurements: [derived.measurement], sourceRow, profileCanonicalSha256: fileProfileRow.profile_canonical_sha256, interpretation, actorUserId, now,
        });
        if (recorded.refused) return recorded.refused;
        return success({ sourceVersion: rowToSourceVersionRecord(sourceVersionRow), ...recorded.results[0], replayed: recorded.replayed });
      });
    },

    // Cross-source linked reach: the service events of one promoted CSV
    // version linked to the participant register of another, under a
    // person's confirmed field mapping and the events engagement's recorded
    // period. Both versions pass the same loader as every measurement; the
    // reconciliation worker alone reads their verified bytes and returns
    // counts only. Every resulting measurement records both versions.
    // The HTTP side of a cross-source measurement: both versions pass the
    // shared loader (lineage, currentness, effective allowed use, bound
    // profile) and the mapping resolves against both committed profiles and
    // the recorded period - no byte is read - and then, in the same
    // transaction, `enqueue` records the reconciliation job.
    async requestCrossSourceReachMeasurements({ organizationId, primarySourceVersionId, referenceSourceVersionId, primaryWorksheetKey = null, referenceWorksheetKey = null, mapping, enqueue }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      // One version is linked only as two different worksheets of a workbook (the worker applies the same rule).
      if (primarySourceVersionId === referenceSourceVersionId && (!primaryWorksheetKey || !referenceWorksheetKey || primaryWorksheetKey === referenceWorksheetKey)) {
        return refusal("validation_blocker", "cross_source_same_version", "A linkage links two different source versions, or two different worksheets of one workbook.", "Select the service-event table and the participant register table.", "cross_source_mapping");
      }
      return withCaught(run, async (tx) => {
        const admitted = await admitCrossSourceVersions(tx, { organizationId, primarySourceVersionId, referenceSourceVersionId, mapping, primaryWorksheetKey, referenceWorksheetKey });
        if (!admitted.ok) return admitted.failure;
        const { primary, reference, resolved } = admitted;
        return success(await enqueue(tx, {
          primaryProfileCanonicalSha256: primary.fileProfileRow.profile_canonical_sha256,
          referenceProfileCanonicalSha256: reference.fileProfileRow.profile_canonical_sha256,
          period: resolved.resolved.period,
          primaryWorksheetKey: resolved.resolved.events_worksheet_key ?? null,
          referenceWorksheetKey: resolved.resolved.register_worksheet_key ?? null,
        }));
      });
    },

    // The exact-period worker side: in one transaction, `fence.before`
    // re-asserts the job claim, the shared loader revalidates the version
    // (lineage, currentness, effective allowed use, bound profile), the
    // Project period and profile must be the ones the job was requested
    // under, the worker reads and checks the verified bytes, and the
    // measurement (with the person's interpretation) and `fence.after`
    // commit together or not at all.
    async recordExactPeriodTabularMeasurement({ organizationId, sourceVersionId, worksheetKey = null, definition, period, interpretation = null, actorUserId, now, fence = null }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      if (!crossSourceReconciliationWorker) return failure("validation_blocker");
      return withCaught(run, async (tx) => {
        if (fence) {
          const fenced = await fence.before(tx);
          if (fenced) return fenced;
        }
        const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
        if (!measurable.ok) return measurable.failure;
        const { sourceVersionRow, sourceRow, fileProfileRow } = measurable;
        const periodState = await readReportingPeriod(tx, { organizationId, sourceVersionId });
        const reportingPeriod = periodState.status === "recorded" ? periodState.period : null;
        if (!reportingPeriod || reportingPeriod.start !== period?.period_start || reportingPeriod.end !== period?.period_end
          || (fence && !fence.profilesMatch({ primary: fileProfileRow.profile_canonical_sha256, reference: null, period }))) {
          return refusal("conflict_current_state_changed", "exact_period_source_changed", "The source version or its Project period changed after the calculation was requested.", "Request the measurement again.", "tabular_measurement_definition");
        }
        const validated = validateTabularMeasurementDefinition(definition);
        if (!validated.ok) return failure(validated.code, validated.blockers);
        const resolved = resolveTabularDefinitionForSourceRecords(fileProfileRow.profile, worksheetKey, validated.definition, { reportingPeriod });
        if (!resolved.ok) return failure(resolved.code, resolved.blockers);
        const read = await crossSourceReconciliationWorker.readSourceRecords(tx, {
          organizationId, intakeFileId: fileProfileRow.intake_file_id, checksum: fileProfileRow.checksum,
          worksheetKey: fileProfileRow.profile?.format === "xlsx" ? resolved.resolved.sheetKey : null,
        });
        if (!read.ok) {
          const [message, fix] = WORKER_REFUSALS[read.reason] ?? ["KAI could not read the uploaded file.", "Upload the file again as a new intake version."];
          return refusal("conflict_current_state_changed", read.reason, message, fix, "tabular_measurement_definition");
        }
        const calculated = calculateTabularMeasurementFromRecords({ profile: fileProfileRow.profile, worksheetKey, resolved: resolved.resolved, records: read.records });
        if (!calculated.ok) return failure(calculated.code, calculated.blockers);
        let stated = null;
        if (interpretation) {
          const checked = validateDerivedMeasurementInterpretation(interpretation, { family: calculated.measurement.family });
          if (!checked.ok) return failure(checked.code, checked.blockers);
          stated = checked.interpretation;
        }
        const recorded = await recordMeasurements(tx, {
          organizationId, sourceVersionId, measurements: [calculated.measurement], sourceRow, profileCanonicalSha256: fileProfileRow.profile_canonical_sha256,
          interpretation: stated, actorUserId, now,
        });
        if (recorded.refused) return recorded.refused;
        if (fence) await fence.after(tx, recorded.results.map((entry) => entry.measurement.source_derived_measurement_id));
        return success({ sourceVersion: rowToSourceVersionRecord(sourceVersionRow), ...recorded.results[0], replayed: recorded.replayed });
      });
    },

    // The worker side: in one transaction, `fence.before` re-asserts the job
    // claim and the profiles it was requested against, the shared loader
    // revalidates both versions, the reconciliation worker reads and checks
    // their bytes, and the measurements and `fence.after` (the job's
    // completion) commit together or not at all.
    async recordCrossSourceReachMeasurements({ organizationId, primarySourceVersionId, referenceSourceVersionId, primaryWorksheetKey = null, referenceWorksheetKey = null, mapping, actorUserId, now, fence = null }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      if (!crossSourceReconciliationWorker) return failure("validation_blocker");
      if (primarySourceVersionId === referenceSourceVersionId && (!primaryWorksheetKey || !referenceWorksheetKey || primaryWorksheetKey === referenceWorksheetKey)) {
        return refusal("validation_blocker", "cross_source_same_version", "A linkage links two different source versions, or two different worksheets of one workbook.", "Select the service-event table and the participant register table.", "cross_source_mapping");
      }
      return withCaught(run, async (tx) => {
        if (fence) {
          const fenced = await fence.before(tx);
          if (fenced) return fenced;
        }
        const admitted = await admitCrossSourceVersions(tx, { organizationId, primarySourceVersionId, referenceSourceVersionId, mapping, primaryWorksheetKey, referenceWorksheetKey });
        if (!admitted.ok) return admitted.failure;
        const { primary, reference, resolved } = admitted;
        const eventsSheet = resolved.resolved.events_worksheet_key ?? null;
        const registerSheet = resolved.resolved.register_worksheet_key ?? null;
        if (fence && !fence.profilesMatch({
          primary: primary.fileProfileRow.profile_canonical_sha256, reference: reference.fileProfileRow.profile_canonical_sha256, period: resolved.resolved.period,
        })) {
          return refusal("conflict_current_state_changed", "cross_source_source_changed", "A linked source changed after the reconciliation was requested.", "Request the reconciliation again for the current versions.", "cross_source_mapping");
        }
        const reconciled = await crossSourceReconciliationWorker.reconcile(tx, {
          organizationId,
          events: { intakeFileId: primary.fileProfileRow.intake_file_id, checksum: primary.fileProfileRow.checksum, worksheetKey: eventsSheet },
          register: { intakeFileId: reference.fileProfileRow.intake_file_id, checksum: reference.fileProfileRow.checksum, worksheetKey: registerSheet },
          mapping: crossSourceWorkerMapping(resolved.resolved),
        });
        if (!reconciled.ok) {
          const [message, fix] = WORKER_REFUSALS[reconciled.reason] ?? ["The linked sources could not be reconciled.", "Upload the files again as new intake versions."];
          return refusal("conflict_current_state_changed", reconciled.reason, message, fix, "cross_source_mapping");
        }
        const measurements = deriveCrossSourceReachMeasurements({
          resolved: resolved.resolved,
          eventFieldKeys: resolved.eventFieldKeys,
          reconciliation: reconciled.reconciliation,
          reference: { sourceVersionId: referenceSourceVersionId, profileCanonicalSha256: reference.fileProfileRow.profile_canonical_sha256 },
        });
        const recorded = await recordMeasurements(tx, {
          organizationId,
          sourceVersionId: primarySourceVersionId,
          measurements,
          sourceRow: primary.sourceRow,
          profileCanonicalSha256: primary.fileProfileRow.profile_canonical_sha256,
          interpretation: null,
          actorUserId,
          now,
          contributingSources: [
            { role: "primary", sourceVersionId: primarySourceVersionId, profileCanonicalSha256: primary.fileProfileRow.profile_canonical_sha256, fieldKeys: resolved.eventFieldKeys, worksheetKey: eventsSheet },
            { role: "reference", sourceVersionId: referenceSourceVersionId, profileCanonicalSha256: reference.fileProfileRow.profile_canonical_sha256, fieldKeys: [mapping.register.participant_identifier_field_key], worksheetKey: registerSheet },
          ],
        });
        if (recorded.refused) return recorded.refused;
        if (fence) await fence.after(tx, recorded.results.map((entry) => entry.measurement.source_derived_measurement_id));
        return success({
          sourceVersion: rowToSourceVersionRecord(primary.sourceVersionRow),
          referenceSourceVersion: rowToSourceVersionRecord(reference.sourceVersionRow),
          measurements: recorded.results,
          replayed: recorded.replayed,
        });
      });
    },

    // The organization's planned target for a recorded measurement's metric
    // identity on its Project (source, worksheet, measurement key): appended,
    // superseding the current target of that identity; the same target again
    // writes nothing. The measurement is never changed.
    async recordMeasurementTarget({ organizationId, measurementId, targetInput, actorUserId, now }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      return withCaught(run, async (tx) => {
        const measurementRow = await readMeasurementById(tx, { organizationId, measurementId });
        if (!measurementRow) return failure("not_found");
        const validated = validateMeasurementTargetInput(targetInput, { family: measurementRow.measurement_family });
        if (!validated.ok) return failure(validated.code, validated.blockers);
        const measurable = await loadMeasurableSourceVersion(tx, {
          organizationId, sourceVersionId: measurementRow.source_version_id, worksheetKey: measurementRow.worksheet_key, operation: MEASUREMENT_TARGET_OPERATION,
        });
        if (!measurable.ok) return measurable.failure;
        const { sourceRow, fileProfileRow } = measurable;
        if (fileProfileRow.profile_canonical_sha256 !== measurementRow.profile_canonical_sha256 || !derivedMeasurementArithmeticHolds(measurementRow)) {
          return failure("conflict_current_state_changed");
        }
        const periodContext = await readReportingPeriod(tx, { organizationId, sourceVersionId: measurementRow.source_version_id });
        if (!periodContext.engagement_id) {
          return refusal("validation_blocker", periodContext.status, projectPeriodProblem(periodContext), "Resolve this source's KAI Project before setting a target.", "measurement_target");
        }
        const current = targetFor(await readCurrentTargets(tx, { organizationId, engagementId: periodContext.engagement_id, sourceId: sourceRow.source_id, lock: true }), measurementRow);
        const { target } = validated;
        if (current && sameTargetValue(current.target_value, target.targetValue) && current.comparison === target.comparison) {
          return success({ target: current, comparison: composeMeasurementTargetComparison({ measurementRow, target: current }), replayed: true });
        }
        const { rows } = await tx.query(
          `INSERT INTO kai.measurement_targets (
             organization_id, engagement_id, source_id, worksheet_key, measurement_key, measurement_family, target_unit, target_value,
             comparison, set_on_measurement_id, supersedes_target_id, created_by, created_by_type, created_at
           ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::numeric, $9, $10::uuid, $11::uuid, $12::uuid, 'human', $13::timestamptz)
           RETURNING ${TARGET_COLUMNS}`,
          [organizationId, periodContext.engagement_id, sourceRow.source_id, measurementRow.worksheet_key, measurementRow.measurement_key, measurementRow.measurement_family,
            target.unit, target.targetValue, target.comparison, measurementId, current?.measurement_target_id ?? null, actorUserId, now],
        );
        const recorded = { ...rows[0], created_at: asIso(rows[0].created_at) };
        const audit = await insertAuditEvent({
          operation: MEASUREMENT_TARGET_OPERATION, operation_type: MEASUREMENT_TARGET_OPERATION, actor_user_id: actorUserId, actor_type: "human",
          organization_id: organizationId, object_type: "measurement_target", target_object_type: "measurement_target", object_id: recorded.measurement_target_id,
          reason_code: current ? "measurement_target_superseded" : "measurement_target_recorded", validator_key: DERIVED_MEASUREMENT_VALIDATOR_KEY, created_at: now,
        }, tx);
        if (audit?.ok !== true) throw new RequiredMeasurementAuditRejectedError();
        return success({ target: recorded, comparison: composeMeasurementTargetComparison({ measurementRow, target: recorded }), replayed: false });
      });
    },

    // A person's clarification or correction of what a measurement means: a
    // new interpretation superseding the current one, and the measurement's
    // evidence under it. The measurement row is never changed.
    async recordDerivedMeasurementInterpretation({ organizationId, measurementId, interpretationInput, actorUserId, now }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      return withCaught(run, async (tx) => {
        const measurementRow = await readMeasurementById(tx, { organizationId, measurementId });
        if (!measurementRow) return failure("not_found");
        // Which fields an interpretation takes depends on the measurement.
        const validated = validateDerivedMeasurementInterpretation(interpretationInput, { family: measurementRow.measurement_family });
        if (!validated.ok) return failure(validated.code, validated.blockers);
        const { interpretation } = validated;
        const measurable = await loadMeasurableSourceVersion(tx, {
          organizationId, sourceVersionId: measurementRow.source_version_id, worksheetKey: measurementRow.worksheet_key, operation: DERIVED_MEASUREMENT_INTERPRETATION_OPERATION,
        });
        if (!measurable.ok) return measurable.failure;
        const { sourceVersionRow, sourceRow, fileProfileRow } = measurable;
        if (fileProfileRow.profile_canonical_sha256 !== measurementRow.profile_canonical_sha256 || !derivedMeasurementArithmeticHolds(measurementRow)) {
          return failure("conflict_current_state_changed");
        }
        if (!derivedMeasurementLabelsAdmitted(measurementRow)) {
          return refusal("validation_blocker", "derived_measurement_category_label_withheld",
            "This measurement was recorded from category labels KAI now withholds, so it cannot be stated again.",
            "Record the measurement again from a field whose values KAI lists.", "derived_measurement");
        }
        // A cross-source measurement is interpreted only while its reference
        // version still passes the same loader and is bound to its profile.
        if (measurementRow.measurement_family === DERIVED_MEASUREMENT_FAMILIES.CROSS_SOURCE_REACH) {
          const reference = (await readContributingSources(tx, { organizationId, measurementId })).find((row) => row.source_role === "reference");
          if (!reference) return failure("conflict_current_state_changed");
          const referenceMeasurable = await loadMeasurableSourceVersion(tx, {
            organizationId, sourceVersionId: reference.source_version_id, operation: DERIVED_MEASUREMENT_INTERPRETATION_OPERATION,
          });
          if (!referenceMeasurable.ok) return referenceMeasurable.failure;
          if (referenceMeasurable.sourceVersionRow.is_current !== true
            || referenceMeasurable.fileProfileRow.profile_canonical_sha256 !== reference.profile_canonical_sha256) {
            return failure("conflict_current_state_changed");
          }
        }
        const current = await readCurrentInterpretation(tx, { organizationId, measurementId });
        let interpretationRow = current;
        let interpretationFresh = false;
        if (!sameInterpretation(current, interpretation)) {
          const composable = validateDerivedStatements({
            measurementRow,
            interpretation: { indicator_label: interpretation.indicatorLabel, meaning_text: interpretation.meaningText, score_direction: interpretation.scoreDirection, evidence_basis: interpretation.evidenceBasis },
          });
          if (!composable.ok) return failure(composable.code, composable.blockers);
          interpretationRow = await insertInterpretation(tx, { organizationId, measurementId, supersedesId: current?.interpretation_id ?? null, interpretation, actorUserId });
          interpretationFresh = true;
        }
        const evidence = await ensureCurrentEvidence(tx, {
          organizationId, sourceRow, sourceVersionId: measurementRow.source_version_id, measurementRow, interpretationRow, actorUserId,
        });
        if (evidence.refused) return evidence.refused;
        const writes = [interpretationFresh, evidence.evidenceFresh].filter(Boolean).length;
        if (writes > 0) {
          await writeAudit(insertAuditEvent, tx, {
            operation: DERIVED_MEASUREMENT_INTERPRETATION_OPERATION, reasonCode: "source_derived_measurement_interpreted",
            organizationId, actorUserId, objectId: evidence.evidenceRow.evidence_item_id, now,
          });
        }
        return success({
          sourceVersion: rowToSourceVersionRecord(sourceVersionRow),
          measurement: measurementRecord(measurementRow),
          interpretation: interpretationRecord(interpretationRow),
          supersededInterpretationId: interpretationFresh ? current?.interpretation_id ?? null : null,
          evidenceItem: rowToEvidenceRecord(evidence.evidenceRow),
          sourceLocator: rowToLocatorRecord(evidence.locatorRow),
          reviewQueueItem: rowToReviewQueueRecord(evidence.queueRow),
          replayed: writes === 0,
        });
      });
    },
  });
}

export const __derivedMeasurementRepositoryContract = Object.freeze({
  DERIVED_MEASUREMENT_RECORD_OPERATION,
  DERIVED_MEASUREMENT_INTERPRETATION_OPERATION,
  MEASUREMENT_TARGET_OPERATION,
  families: DERIVED_MEASUREMENT_FAMILIES,
  sameTargetValue,
});
