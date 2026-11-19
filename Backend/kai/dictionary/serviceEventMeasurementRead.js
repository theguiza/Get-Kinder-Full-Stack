import { TABULAR_MEASUREMENT_BASIS_VERSION } from "../profiling/tabularMeasurementBasis.js";
import {
  SERVICE_ROLE_DISCOVERY_VERSION,
  deriveServiceEventMeasurements,
  discoverServiceEventRoles,
  planServiceEventFindings,
  serviceEventMeasurementRecordable,
  serviceFindingName,
  serviceMaterialFieldKeys,
} from "../validators/kaiServiceEventMeasurements.js";
import { projectPeriodProblem } from "../../../shared/kaiProjectReportingPeriod.js";
import { SERVICE_EVENT_METRICS } from "../validators/kaiDerivedMeasurementValidators.js";

/**
 * Single-source service-delivery measurements of one table of an admitted,
 * current source version, inside the caller's transaction (the shared loader
 * has already applied lineage, currentness and the effective allowed use).
 * Column headings are redacted from the committed profile, so the roles are
 * proposed from the verified upload by the parser worker, which returns only
 * the listed heading words and the reconciliation's aggregates. Nothing is
 * written here; the write path calls the same function and records the
 * findings a person chose.
 */

const COMPLETION_LABELS = new Set(["completed", "complete", "attended", "delivered", "served", "done", "fulfilled", "finished", "present"]);

/** The committed basis of the table, when it can be a service-record table (a listed completed value). */
export function serviceEventTableBasis(profile, worksheetKey) {
  if (!profile || profile.status !== "profiled") return null;
  let basis = null;
  let sheetKey = null;
  if (profile.format === "csv") {
    if (worksheetKey !== null) return null;
    basis = profile.tabular_measurement_basis;
  } else if (profile.format === "xlsx" && Array.isArray(profile.sheets)) {
    const sheet = worksheetKey == null && profile.sheets.length === 1 ? profile.sheets[0] : profile.sheets.find((item) => item.sheet_key === worksheetKey);
    basis = sheet?.tabular_measurement_basis ?? null;
    sheetKey = sheet?.sheet_key ?? null;
  }
  if (!basis || basis.basis_version !== TABULAR_MEASUREMENT_BASIS_VERSION || basis.status !== "assessed" || !Array.isArray(basis.fields)) return null;
  const listsCompleted = basis.fields.some((field) => field.roles?.includes("categorical") && !field.categorical?.vocabulary_withheld
    && (field.categorical?.values || []).some((value) => COMPLETION_LABELS.has(String(value.label).toLowerCase())));
  return listsCompleted ? { basis, sheetKey } : null;
}

async function readDictionaryContext(tx, { organizationId, fileProfileRow, profile }) {
  // An XLSX dictionary keys fields without their worksheet, so it cannot
  // describe one worksheet's column; only a CSV dictionary is context here.
  if (profile?.format !== "csv") return [];
  const { rows } = await tx.query(
    `SELECT df.profile_field_key AS field_key, df.entity_level
       FROM kai.data_dictionary_fields df
      WHERE df.organization_id = $1::uuid AND df.file_profile_id = $2::uuid AND df.entity_level <> 'unknown'`,
    [organizationId, fileProfileRow.file_profile_id],
  );
  return rows;
}

function notAssessable(reason, sheetKey) {
  return {
    status: "not_assessable",
    reason,
    worksheet_key: sheetKey,
    message: "KAI could not read this table's records from the verified upload, so its service-delivery measurements are not shown. Other results are unaffected.",
  };
}

const METRIC_TITLES = Object.freeze({
  [SERVICE_EVENT_METRICS.COMPLETED_ENCOUNTERS]: "Completed service encounters",
  [SERVICE_EVENT_METRICS.GROUP_COMPLETED_ENCOUNTERS]: "Completed encounters",
  [SERVICE_EVENT_METRICS.DISTINCT_ENTITIES]: "Distinct households served",
  [SERVICE_EVENT_METRICS.GROUP_DISTINCT_ENTITIES]: "Distinct households served",
  [SERVICE_EVENT_METRICS.MONTHLY]: "Completed encounters by month",
});

/**
 * The service-delivery section of a measurement basis read, or null when the
 * table cannot be a service-record table. `selections` are a person's
 * validated role choices (kept only by their client until a result is saved).
 * `recordedRows` are the version's recorded measurements, to mark findings
 * already saved. Returns {section, measurements} so the write path records
 * exactly the measurements the read showed.
 */
export async function readServiceEventMeasurements(tx, {
  organizationId, fileProfileRow, profile, worksheetKey, periodContext, selections = null, worker = null, recordedRows = [],
}) {
  const table = serviceEventTableBasis(profile, worksheetKey);
  if (!table) return { section: null, measurements: [] };
  const reportingPeriod = periodContext?.status === "recorded" ? periodContext.period : null;
  const dictionaryFields = await readDictionaryContext(tx, { organizationId, fileProfileRow, profile });
  let refused = null;
  let computed = null;
  let read;
  try {
    const input = {
      organizationId, intakeFileId: fileProfileRow.intake_file_id, checksum: fileProfileRow.checksum, worksheetKey: profile.format === "xlsx" ? table.sheetKey : null,
      compute: async ({ headings, physicalRecordCount, reconcile }) => {
        if (physicalRecordCount !== table.basis.record_count) return { changed: true };
        const discovered = discoverServiceEventRoles({ basis: table.basis, headings, dictionaryFields, selections });
        if (!discovered.ok) {
          refused = discovered;
          return {};
        }
        const planned = planServiceEventFindings({
          discovery: discovered.discovery, reportingPeriod, periodProblem: periodContext?.status === "recorded" ? null : projectPeriodProblem(periodContext),
          materialFieldKeys: serviceMaterialFieldKeys(table.basis),
        });
        const reconciliations = Object.fromEntries(Object.entries(planned.plans).map(([mode, plan]) => [mode, reconcile(plan)]));
        computed = { discovery: discovered.discovery, planned, reconciliations };
        return {};
      },
    };
    if (worker?.readServiceEvents) read = await worker.readServiceEvents(tx, input);
    else {
      const { readCurrentServiceEvents } = await import("../parsing/crossSourceReconciliationJobRuntime.js");
      read = await readCurrentServiceEvents(tx, input);
    }
  } catch (error) {
    if (refused) return { refused, section: null, measurements: [] };
    read = { ok: false, reason: error?.code === "cross_source_duration_precision_unsupported" ? error.code : "verified_upload_unavailable" };
  }
  if (refused) return { refused, section: null, measurements: [] };
  if (!read?.ok) return { section: notAssessable(read?.reason || "verified_upload_unavailable", table.sheetKey), measurements: [] };
  if (read.changed || !computed) return { section: notAssessable("service_table_changed", table.sheetKey), measurements: [] };
  const { discovery, planned, reconciliations } = computed;
  if (discovery.status !== "service_events") return { section: null, measurements: [] };
  const derived = deriveServiceEventMeasurements({ planned, reconciliations, sheetKey: table.sheetKey, reportingPeriod });
  const savedByKey = new Map();
  for (const row of recordedRows) {
    if (row.measurement_family !== "service_events" || (row.worksheet_key ?? null) !== (table.sheetKey ?? null)) continue;
    const current = (row.interpretation_id ?? null) === (row.current_interpretation_id ?? null);
    if (!savedByKey.has(row.measurement_key) || current) savedByKey.set(row.measurement_key, row);
  }
  const findings = derived.map(({ finding, measurement }) => {
    const saved = savedByKey.get(measurement.measurementKey) ?? null;
    return {
      key: measurement.measurementKey,
      measurement_key: measurement.measurementKey,
      metric: finding.metric,
      title: METRIC_TITLES[finding.metric],
      name: serviceFindingName(measurement.definition),
      mode: finding.mode,
      required: finding.required,
      group: finding.group,
      finding_basis: finding.finding_basis,
      counted_unit: measurement.definition.counted_unit,
      measured_value: measurement.measuredValue,
      period: measurement.definition.period,
      recordable: serviceEventMeasurementRecordable(measurement),
      saved: saved ? { source_derived_measurement_id: saved.source_derived_measurement_id, evidence_item_id: saved.evidence_item_id } : null,
      ...(finding.metric === SERVICE_EVENT_METRICS.MONTHLY ? { monthly_activity: measurement.componentCounts.monthly_activity ?? [] } : {}),
      ...(finding.group ? { group_encounter_count: measurement.componentCounts.group_encounter_count } : {}),
    };
  });
  // With no usable completed status there is no plan: the roles and the exact requirement are still shown.
  const headline = reconciliations.period ?? reconciliations.all_dates ?? null;
  return {
    section: {
      status: "available",
      discovery_version: SERVICE_ROLE_DISCOVERY_VERSION,
      worksheet_key: table.sheetKey,
      roles: discovery.roles,
      source_value_notes: discovery.source_value_notes,
      selections_applied: selections ?? null,
      period: reportingPeriod,
      period_applied: Boolean(reconciliations.period),
      funnel: headline?.counts ?? null,
      all_dates_funnel: reconciliations.period ? reconciliations.all_dates.counts : null,
      row_exclusion_counts: headline ? Object.fromEntries(Object.entries(headline.row_exclusions).map(([key, value]) => [key, value.count])) : null,
      findings,
      unavailable: planned.unavailable,
      required_measurement_keys: findings.filter((finding) => finding.required).map((finding) => finding.measurement_key).sort(),
    },
    measurements: derived.map((entry) => entry.measurement),
  };
}
