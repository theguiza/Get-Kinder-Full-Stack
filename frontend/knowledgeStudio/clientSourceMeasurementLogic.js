import { BASE_PATH, errorText, isRouteUuid } from "../impactEvidenceLibraryLogic.js";

/**
 * Organization administrator's P2-01M record-count measurement (Plan A
 * Prompt 8). The server owns every number and every rule: the basis read
 * returns the profile counts and the counted value, the write validates the
 * definition and derives the measurement, and both re-check lineage,
 * currentness, and the effective allowed use. Nothing here computes a count,
 * proposes a definition, or reads a record.
 */
export function sourceRecordCountMeasurementPath(organizationId, sourceVersionId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/source-versions/${encodeURIComponent(sourceVersionId)}/record-count-measurement`;
}

const isCount = (value) => Number.isInteger(value) && value >= 0;
const isText = (value) => typeof value === "string";

function projectBasisCounts(basis) {
  if (basis?.measurable !== true) {
    return {
      measurable: false,
      reasons: (Array.isArray(basis?.blockers) ? basis.blockers : [])
        .map((blocker) => (isText(blocker?.message) ? blocker.message : null))
        .filter(Boolean),
    };
  }
  const counts = [basis.data_record_count, basis.blank_record_count, basis.duplicate_record_count, basis.counted_record_count];
  if (!counts.every(isCount)) return null;
  return {
    measurable: true,
    dataRecordCount: basis.data_record_count,
    blankRecordCount: basis.blank_record_count,
    duplicateRecordCount: basis.duplicate_record_count,
    countedRecordCount: basis.counted_record_count,
  };
}

function projectRecorded(recorded) {
  if (!recorded) return null;
  const definition = recorded.definition || {};
  const measurement = recorded.measurement || null;
  const claim = recorded.claim || null;
  return {
    definition: {
      countedUnit: definition.counted_unit || "",
      unitLabel: definition.unit_label || "",
      definitionText: definition.definition_text || "",
      inclusionRule: definition.inclusion_rule || "",
      exclusionRule: definition.exclusion_rule || "",
      periodStart: definition.period_start || null,
      periodEnd: definition.period_end || null,
    },
    measurement: measurement && isCount(measurement.measured_value) && isRouteUuid(measurement.evidence_item_id)
      ? { measuredValue: measurement.measured_value, unitLabel: measurement.unit_label || "", evidenceItemId: measurement.evidence_item_id }
      : null,
    claim: claim && isRouteUuid(claim.claim_id)
      ? {
          claimId: claim.claim_id,
          statement: claim.statement || "",
          claimStatus: claim.claim_status || "",
          claimReviewStatus: claim.claim_review_status || "",
        }
      : null,
    limitations: (Array.isArray(recorded.limitations) ? recorded.limitations : [])
      .filter((entry) => isText(entry?.code))
      .map((entry) => ({ code: entry.code, description: isText(entry.description) ? entry.description : entry.code })),
  };
}

export function projectMeasurementBasis(dto) {
  if (!dto || !isRouteUuid(dto.sourceVersion?.source_version_id)) return null;
  const counts = projectBasisCounts(dto.basis);
  if (!counts) return null;
  return {
    sourceVersionId: dto.sourceVersion.source_version_id,
    isCurrent: dto.sourceVersion.is_current === true,
    sourceCode: dto.source?.source_code || "",
    counts,
    recorded: projectRecorded(dto.recorded),
  };
}

export const EMPTY_MEASUREMENT_FORM = Object.freeze({
  countedUnit: "",
  unitLabel: "",
  definitionText: "",
  inclusionRule: "",
  exclusionRule: "",
  periodStart: "",
  periodEnd: "",
  periodAttested: false,
});

/**
 * Whether the form may be submitted: every definition field entered, and a
 * reporting period either left out entirely or given in full and attested as
 * the organization's own statement (KAI does not verify it against record
 * dates). The server still validates every field.
 */
export function measurementFormReadiness(form) {
  const required = [form.countedUnit, form.unitLabel, form.definitionText, form.inclusionRule, form.exclusionRule];
  if (!required.every((value) => isText(value) && value.trim().length > 0)) return { ready: false, reason: "definition_incomplete" };
  const hasStart = isText(form.periodStart) && form.periodStart.length > 0;
  const hasEnd = isText(form.periodEnd) && form.periodEnd.length > 0;
  if (hasStart !== hasEnd) return { ready: false, reason: "period_incomplete" };
  if (hasStart && form.periodAttested !== true) return { ready: false, reason: "period_not_attested" };
  return { ready: true, reason: null };
}

export const MEASUREMENT_FORM_READINESS_MESSAGES = Object.freeze({
  definition_incomplete: "Enter what one record represents, its unit, and the inclusion and exclusion rules.",
  period_incomplete: "Enter both the start and the end of the reporting period, or neither.",
  period_not_attested: "Confirm that the reporting period is your organization's statement.",
});

// The P2-01M definition exactly as the service validates it; the period is
// sent only when one is given.
export function measurementDefinitionBody(form) {
  const body = {
    counted_unit: form.countedUnit.trim(),
    unit_label: form.unitLabel.trim(),
    definition_text: form.definitionText.trim(),
    inclusion_rule: form.inclusionRule.trim(),
    exclusion_rule: form.exclusionRule.trim(),
  };
  if (form.periodStart && form.periodEnd) {
    body.period_start = form.periodStart;
    body.period_end = form.periodEnd;
  }
  return body;
}

/** The server's own reason a measurement request was refused, and what to do. */
export function measurementFailureMessage(result) {
  const blocker = Array.isArray(result?.body?.blockers) ? result.body.blockers[0] : null;
  if (blocker?.blocking_reason === "measurement_definition_already_recorded") {
    return "A different definition is already recorded for this source version, and a recorded definition cannot be changed. "
      + "To count this data under another definition, upload a corrected file as a new version of the source; the definition "
      + "already recorded is shown below.";
  }
  if (isText(blocker?.message)) return isText(blocker.required_fix) ? `${blocker.message} ${blocker.required_fix}` : blocker.message;
  return errorText(result);
}
