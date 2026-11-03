import { createHash } from "node:crypto";
import {
  getScopedEvidenceItemByStatementFingerprint,
  getScopedEvidenceReviewQueueItemByEvidenceItemId,
  getScopedSourceLocatorByFingerprint,
  getScopedSourceVersionEngagementReportingPeriod,
  listScopedDerivedMeasurementRowsBySourceVersion,
} from "../db/kaiIntakeQueries.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
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
  return row?.period_start && row?.period_end ? { start: row.period_start, end: row.period_end, engagementId: row.engagement_id } : null;
}

function measurementRecord(row) {
  return { ...row, created_at: asIso(row.created_at) };
}

const CONTRIBUTING_SOURCE_COLUMNS = `
  source_version_id::text AS source_version_id, source_role, profile_canonical_sha256, field_keys`;

async function insertContributingSourceIfAbsent(tx, { organizationId, measurementId, source }) {
  await tx.query(
    `INSERT INTO kai.source_derived_measurement_sources (
       source_derived_measurement_id, organization_id, source_version_id, source_role, profile_canonical_sha256, field_keys
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb)
     ON CONFLICT DO NOTHING`,
    [measurementId, organizationId, source.sourceVersionId, source.role, source.profileCanonicalSha256, JSON.stringify(source.fieldKeys)],
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
    && canonicalJson(row.field_keys) === canonicalJson(expected[index].fieldKeys));
}

// Maps a reconciliation worker refusal to the shared blocker shape.
// Both cross-source versions through the shared loader, and the person's
// mapping resolved against both committed profiles and the recorded period.
async function admitCrossSourceVersions(tx, { organizationId, primarySourceVersionId, referenceSourceVersionId, mapping }) {
  const primary = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId: primarySourceVersionId, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
  if (!primary.ok) return primary;
  const reference = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId: referenceSourceVersionId, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
  if (!reference.ok) return reference;
  const reportingPeriod = await readReportingPeriod(tx, { organizationId, sourceVersionId: primarySourceVersionId });
  const resolved = resolveCrossSourceReachMapping({
    eventsProfile: primary.fileProfileRow.profile, registerProfile: reference.fileProfileRow.profile, mapping, reportingPeriod,
  });
  if (!resolved.ok) return { ok: false, failure: failure(resolved.code, resolved.blockers) };
  return { ok: true, primary, reference, resolved };
}

const WORKER_REFUSALS = Object.freeze({
  cross_source_upload_not_eligible: ["A linked source's upload is no longer a confirmed, passed upload of the profiled file.", "Upload the file again as a new intake version."],
  cross_source_bytes_unavailable: ["KAI could not read a linked source version's verified bytes.", "Try again; if it persists, upload the file again as a new intake version."],
  cross_source_csv_not_readable: ["A linked source version could not be read as the CSV table KAI profiled.", "Upload the file again as a new intake version."],
  cross_source_checksum_mismatch: ["A linked source version's stored bytes do not match the file KAI profiled.", "Upload the file again as a new intake version."],
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
        const profile = fileProfileRow.profile;
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
            ...(labelsAdmitted ? {} : { category_labels_withheld: true }),
            evidence: [],
          };
          const current = (row.interpretation_id ?? null) === (row.current_interpretation_id ?? null);
          entry.evidence.push({
            evidence_item_id: row.evidence_item_id,
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
          reporting_period: await readReportingPeriod(tx, { organizationId, sourceVersionId }),
          paired: paired === null ? null : paired.ok
            ? { available: true, worksheet: paired.worksheet, measurements: paired.measurements.map((item) => (item.available
              ? { available: true, outcome_field_key: item.definition.outcome_field_key, outcome_column: item.definition.outcome_column, numerator: item.numerator, denominator: item.denominator, percentage: item.percentage, component_counts: item.componentCounts }
              : { available: false, outcome_field_key: item.outcomeFieldKey, blockers: item.blockers })) }
            : { available: false, blockers: paired.blockers },
          tabular: tabular.ok ? tabular : { available: false, blockers: tabular.blockers },
          recorded: [...recorded.values()],
        });
      });
    },

    // Package A: retain every available paired outcome of one worksheet as a
    // proposed numerical result. No meaning or direction is required.
    async recordPairedOutcomeMeasurements({ organizationId, sourceVersionId, worksheetKey = null, actorUserId, now }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      return withCaught(run, async (tx) => {
        const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
        if (!measurable.ok) return measurable.failure;
        const { sourceVersionRow, sourceRow, fileProfileRow } = measurable;
        const derived = derivePersistablePairedOutcomes(fileProfileRow.profile, worksheetKey);
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
    async recordTabularMeasurement({ organizationId, sourceVersionId, worksheetKey = null, definition, interpretation = null, actorUserId, now }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      return withCaught(run, async (tx) => {
        const measurable = await loadMeasurableSourceVersion(tx, { organizationId, sourceVersionId, worksheetKey, operation: DERIVED_MEASUREMENT_RECORD_OPERATION });
        if (!measurable.ok) return measurable.failure;
        const { sourceVersionRow, sourceRow, fileProfileRow } = measurable;
        // The engagement's period is read only when the definition applies one.
        const reportingPeriod = definition.conditions.some((condition) => condition.kind === "period")
          ? await readReportingPeriod(tx, { organizationId, sourceVersionId })
          : null;
        const derived = deriveTabularMeasurement(fileProfileRow.profile, worksheetKey, definition, { reportingPeriod });
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
    async requestCrossSourceReachMeasurements({ organizationId, primarySourceVersionId, referenceSourceVersionId, mapping, enqueue }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      if (primarySourceVersionId === referenceSourceVersionId) {
        return refusal("validation_blocker", "cross_source_same_version", "A cross-source measurement links two different source versions.", "Select the service-event version and the participant register version.", "cross_source_mapping");
      }
      return withCaught(run, async (tx) => {
        const admitted = await admitCrossSourceVersions(tx, { organizationId, primarySourceVersionId, referenceSourceVersionId, mapping });
        if (!admitted.ok) return admitted.failure;
        const { primary, reference, resolved } = admitted;
        return success(await enqueue(tx, {
          primaryProfileCanonicalSha256: primary.fileProfileRow.profile_canonical_sha256,
          referenceProfileCanonicalSha256: reference.fileProfileRow.profile_canonical_sha256,
          period: resolved.resolved.period,
        }));
      });
    },

    // The worker side: in one transaction, `fence.before` re-asserts the job
    // claim and the profiles it was requested against, the shared loader
    // revalidates both versions, the reconciliation worker reads and checks
    // their bytes, and the measurements and `fence.after` (the job's
    // completion) commit together or not at all.
    async recordCrossSourceReachMeasurements({ organizationId, primarySourceVersionId, referenceSourceVersionId, mapping, actorUserId, now, fence = null }) {
      const run = runInTransaction || (await resolveDefaultRunInTransaction());
      if (!crossSourceReconciliationWorker) return failure("validation_blocker");
      if (primarySourceVersionId === referenceSourceVersionId) {
        return refusal("validation_blocker", "cross_source_same_version", "A cross-source measurement links two different source versions.", "Select the service-event version and the participant register version.", "cross_source_mapping");
      }
      return withCaught(run, async (tx) => {
        if (fence) {
          const fenced = await fence.before(tx);
          if (fenced) return fenced;
        }
        const admitted = await admitCrossSourceVersions(tx, { organizationId, primarySourceVersionId, referenceSourceVersionId, mapping });
        if (!admitted.ok) return admitted.failure;
        const { primary, reference, resolved } = admitted;
        if (fence && !fence.profilesMatch({
          primary: primary.fileProfileRow.profile_canonical_sha256, reference: reference.fileProfileRow.profile_canonical_sha256, period: resolved.resolved.period,
        })) {
          return refusal("conflict_current_state_changed", "cross_source_source_changed", "A linked source changed after the reconciliation was requested.", "Request the reconciliation again for the current versions.", "cross_source_mapping");
        }
        const reconciled = await crossSourceReconciliationWorker.reconcile(tx, {
          organizationId,
          events: { intakeFileId: primary.fileProfileRow.intake_file_id, checksum: primary.fileProfileRow.checksum },
          register: { intakeFileId: reference.fileProfileRow.intake_file_id, checksum: reference.fileProfileRow.checksum },
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
            { role: "primary", sourceVersionId: primarySourceVersionId, profileCanonicalSha256: primary.fileProfileRow.profile_canonical_sha256, fieldKeys: resolved.eventFieldKeys },
            { role: "reference", sourceVersionId: referenceSourceVersionId, profileCanonicalSha256: reference.fileProfileRow.profile_canonical_sha256, fieldKeys: [mapping.register.participant_identifier_field_key] },
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
  families: DERIVED_MEASUREMENT_FAMILIES,
});
