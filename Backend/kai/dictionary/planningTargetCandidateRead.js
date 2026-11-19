import { readEffectiveAllowedUseProhibitions } from './postgresEffectiveAllowedUseResolver.js';
import { readSavedPlanningTargets } from './plannedTargetRead.js';
import { saveablePlanningCandidate, plannedTargetComparison } from '../validators/kaiSourcePlannedTargets.js';
import { listScopedEngagementDerivedMeasurementRows } from "../db/kaiIntakeQueries.js";
import { derivedContributingSourcesCurrent, derivedMeasurementLabelsAdmitted } from "../validators/kaiDerivedMeasurementValidators.js";
import {
  MAX_PLANNING_TARGET_ROWS,
  PLANNING_TARGET_ASSESSMENT_VERSION,
  PLANNING_TARGET_PERSISTENCE,
  relatedRecordedMeasurements,
} from "../validators/kaiPlanningTargetCandidates.js";

/**
 * Read-only planned-target candidates for one worksheet of an admitted,
 * current source version, inside the caller's measurement-basis transaction
 * (the shared loader has already applied lineage, currentness and the
 * effective allowed use). The committed profile redacts headers, so the
 * planning columns can only be recognized from the verified upload: the
 * parser worker reads that one worksheet and returns screened candidates only.
 * A worksheet that cannot be a planning table (no numeric column, more than
 * MAX_PLANNING_TARGET_ROWS rows, or paired survey outcomes) is never read.
 * Nothing is written; no target, evidence or claim is created.
 */
export function planningTargetWorksheet(profile, worksheetKey, { pairedAvailable = false } = {}) {
  if (profile?.format !== "xlsx" || !Array.isArray(profile.sheets) || pairedAvailable) return null;
  const sheet = worksheetKey == null && profile.sheets.length === 1
    ? profile.sheets[0] : profile.sheets.find((item) => item.sheet_key === worksheetKey);
  const rows = sheet?.record_count_basis?.data_record_count;
  if (!sheet || !Number.isInteger(rows) || rows < 1 || rows > MAX_PLANNING_TARGET_ROWS) return null;
  if (!(sheet.fields || []).some((field) => Number(field?.primitive_type_hints?.number) > 0)) return null;
  return sheet;
}

function notAssessable(reason, worksheetKey) {
  return {
    status: "not_assessable",
    reason,
    assessment_version: PLANNING_TARGET_ASSESSMENT_VERSION,
    worksheet_key: worksheetKey,
    message: "KAI could not read this worksheet's rows from the verified upload, so it cannot show whether the worksheet lists planned targets. Other results are unaffected.",
  };
}

// One row per recorded measurement, under its current interpretation.
function currentMeasurementRows(rows) {
  const byId = new Map();
  for (const row of rows) {
    const current = (row.interpretation_id ?? null) === (row.current_interpretation_id ?? null);
    if (!byId.has(row.source_derived_measurement_id) || current) byId.set(row.source_derived_measurement_id, row);
  }
  return [...byId.values()];
}

// Two batched permission reads cover every primary and linked source on this
// bounded Project result page. A prohibited actual does not hide usable plans.
async function projectMeasurementPermissions(tx, { organizationId, measurements }) {
  const profilesOf = (row) => [row.measurement_intake_sensitivity_profile_id,...(row.contributing_sources || []).map((s) => s.intake_sensitivity_profile_id)];
  const ids=[...new Set(measurements.flatMap(profilesOf).filter(Boolean))];
  const permissions=ids.length ? await readEffectiveAllowedUseProhibitions(tx,{ organizationId,intakeSensitivityProfileIds:ids }) : new Map();
  return new Map(measurements.map((row) => [row.source_derived_measurement_id, profilesOf(row).length > 0 && profilesOf(row).every((id) => permissions.has(id) && permissions.get(id) === null)]));
}

export async function readPlanningTargetCandidates(tx, {
  organizationId, fileProfileRow, profile, worksheetKey, sourceVersionRow, engagementId, pairedAvailable,
  headingLabelOf = () => null, worker = null, listProjectMeasurements = listScopedEngagementDerivedMeasurementRows, readMeasurementPermissions = projectMeasurementPermissions,
}) {
  const sheet = planningTargetWorksheet(profile, worksheetKey, { pairedAvailable });
  if (!sheet) return null;
  let read;
  try {
    const input = { organizationId, intakeFileId: fileProfileRow.intake_file_id, checksum: fileProfileRow.checksum, worksheetKey: sheet.sheet_key };
    if (worker?.readPlanningTargetCandidates) {
      read = await worker.readPlanningTargetCandidates(tx, input);
    } else {
      const { readCurrentPlanningTargetCandidates } = await import("../parsing/crossSourceReconciliationJobRuntime.js");
      read = await readCurrentPlanningTargetCandidates(tx, input);
    }
  } catch {
    read = { ok: false, reason: "verified_workbook_unavailable" };
  }
  if (!read?.ok) return notAssessable(read?.reason || "verified_workbook_unavailable", sheet.sheet_key);
  // The verified rows must be the profiled table this version was promoted from.
  if (read.sheetKey !== sheet.sheet_key || read.dataRecordCount !== sheet.record_count_basis.data_record_count) {
    return notAssessable("planning_worksheet_changed", sheet.sheet_key);
  }
  const { assessment } = read;
  if (assessment.status === "not_planning_targets") return null;
  const source = {
    source_version_id: sourceVersionRow.source_version_id,
    source_id: sourceVersionRow.source_id,
    worksheet_key: sheet.sheet_key,
    worksheet_name: sheet.safe_sheet_name ?? sheet.sheet_key,
    profile_canonical_sha256: fileProfileRow.profile_canonical_sha256,
    source_checksum: fileProfileRow.checksum,
  };
  if (assessment.status !== "candidates") {
    return { ...assessment, source, candidates: [], persistence: PLANNING_TARGET_PERSISTENCE };
  }
  const projectRows=engagementId ? currentMeasurementRows(await listProjectMeasurements({ organizationId,engagementId },tx)) : [];
  const permissions=await readMeasurementPermissions(tx,{ organizationId,measurements:projectRows });
  const measurements = [];
  for (const row of projectRows) {
    // A result recorded from labels the current screen withholds cannot be stated, so it is never proposed.
    if (!derivedMeasurementLabelsAdmitted(row) || permissions.get(row.source_derived_measurement_id) !== true) continue;
    measurements.push({
      ...row,
      engagement_id: engagementId,
      is_current: row.measurement_source_is_current !== false,
      contributing_sources_current: derivedContributingSourcesCurrent(row),
      source_heading_label: await headingLabelOf(row),
    });
  }
  const persisted = (await readSavedPlanningTargets(tx, { organizationId, sourceVersionId: source.source_version_id, worksheetKey: sheet.sheet_key })).map((plan) => {
    if (plan.relationship_status !== 'confirmed' || (plan.actual_is_current && measurements.some((m) => m.source_derived_measurement_id === plan.actual_measurement_id && m.contributing_sources_current))) return plan;
    return {...plan,actual_value:null,statement:null,actual_availability:plan.actual_is_current === false ? 'source_replaced' : 'not_available'};
  });
  return {
    ...assessment,
    source,
    project: { engagement_id: engagementId ?? null, recorded_measurement_count: measurements.length },
    candidates: assessment.candidates.map((candidate) => ({
      ...candidate,
      saveable: saveablePlanningCandidate(candidate),
      saved: persisted.find((p) => p.row_number === candidate.row_number) ?? null,
      comparison_result: plannedTargetComparison(persisted.find((p) => p.row_number === candidate.row_number) ?? {}),
      locator: {
        source_version_id: source.source_version_id,
        worksheet_key: source.worksheet_key,
        worksheet_name: source.worksheet_name,
        row_number: candidate.row_number,
        field_keys: Object.fromEntries(Object.entries(assessment.columns).map(([role, column]) => [role, column.field_key])),
      },
      related_measurements: relatedRecordedMeasurements({ candidate, measurements, planningEngagementId: engagementId ?? null, includeMeasurementId:persisted.find((p) => p.row_number === candidate.row_number)?.actual_measurement_id ?? null }),
    })),
    persistence: PLANNING_TARGET_PERSISTENCE,
  };
}
