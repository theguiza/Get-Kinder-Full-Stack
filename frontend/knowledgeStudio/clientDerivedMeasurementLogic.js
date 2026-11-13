import { BASE_PATH } from "../impactEvidenceLibraryLogic.js";

/**
 * Organization administrator's source-derived measurements (Measurement
 * MVP): paired baseline/follow-up outcomes and content-aware tabular counts
 * and rates. The server owns every number and every rule: the basis read
 * lists what KAI found in the committed profile (proposed outcome results,
 * identifier, category and date fields with their listed values), the writes
 * calculate and record, and an interpretation states what a result means
 * without changing it. Nothing here computes a count or reads a record.
 */
function sourceVersionPath(organizationId, sourceVersionId, leaf, worksheetKey) {
  const path = `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/source-versions/${encodeURIComponent(sourceVersionId)}/${leaf}`;
  return worksheetKey ? `${path}?worksheet_key=${encodeURIComponent(worksheetKey)}` : path;
}

export function derivedMeasurementBasisPath(organizationId, sourceVersionId, worksheetKey = null) {
  return sourceVersionPath(organizationId, sourceVersionId, "derived-measurements", worksheetKey);
}

export function pairedOutcomeMeasurementsPath(organizationId, sourceVersionId, worksheetKey = null) {
  return sourceVersionPath(organizationId, sourceVersionId, "paired-outcome-measurements", worksheetKey);
}

export function tabularMeasurementPath(organizationId, sourceVersionId, worksheetKey = null) {
  return sourceVersionPath(organizationId, sourceVersionId, "tabular-measurements", worksheetKey);
}

export function derivedMeasurementInterpretationPath(organizationId, measurementId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}`
    + `/derived-measurements/${encodeURIComponent(measurementId)}/interpretations`;
}

// Cross-source linked reach: both source versions and the mapping go in the body.
export function crossSourceMeasurementsPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/cross-source-measurements`;
}

export const EMPTY_TABULAR_FORM = Object.freeze({
  operation: "count",
  identifierFieldKey: "",
  categoryFieldKey: "",
  categoryValueKey: "",
  periodFieldKey: "",
  periodScope: "within",
  populationFieldKey: "",
  populationValueKey: "",
});

export const EMPTY_INTERPRETATION_FORM = Object.freeze({
  indicatorLabel: "",
  meaningText: "",
  scoreDirection: "",
  evidenceBasis: "not_established",
});

/** Why the tabular form cannot be sent yet, or null. */
export function tabularFormProblem(form) {
  if (form.categoryFieldKey && !form.categoryValueKey) return "Choose the value the counted records have.";
  if (form.operation === "rate") {
    if (!form.categoryFieldKey) return "A rate needs the value its numerator records have.";
    if (form.populationFieldKey && !form.populationValueKey) return "Choose the value that defines the measured population.";
    if (form.populationFieldKey && form.populationFieldKey === form.categoryFieldKey) return "Choose the population from a different field.";
  }
  return null;
}

/** The tabular definition the route takes, from the form. */
export function tabularDefinitionBody(form) {
  const conditions = [];
  if (form.categoryFieldKey && form.categoryValueKey) conditions.push({ kind: "category", field_key: form.categoryFieldKey, value_key: form.categoryValueKey });
  if (form.operation === "count" && form.periodFieldKey) {
    conditions.push({ kind: "period", field_key: form.periodFieldKey, period_source: "engagement_reporting_period", scope: form.periodScope === "outside" ? "outside" : "within" });
  }
  if (form.operation === "rate") {
    return {
      operation: "rate",
      conditions,
      population: form.populationFieldKey && form.populationValueKey ? [{ kind: "category", field_key: form.populationFieldKey, value_key: form.populationValueKey }] : [],
    };
  }
  return {
    operation: "count",
    unit: form.identifierFieldKey
      ? { kind: "distinct_key", field_key: form.identifierFieldKey, duplicate_policy: "count_each_key_once" }
      : { kind: "records" },
    conditions,
  };
}

const SCORE_DIRECTIONS = Object.freeze(["higher_is_better", "lower_is_better"]);
const EVIDENCE_BASES = Object.freeze(["self_reported", "organization_record"]);

/**
 * The interpretation form, initialized from the current recorded
 * interpretation (either the snake_case record the server returns or the
 * factual-review projection's camelCase one), so a correction starts from
 * what is recorded. Unknown stays unknown: a direction or basis that is not
 * established, missing or unrecognized is left "not established"; nothing is
 * inferred from the label. No interpretation gives the empty form.
 */
export function interpretationFormFrom(interpretation) {
  if (!interpretation || typeof interpretation !== "object") return EMPTY_INTERPRETATION_FORM;
  const pick = (snake, camel) => (typeof interpretation[snake] === "string" ? interpretation[snake]
    : typeof interpretation[camel] === "string" ? interpretation[camel] : "");
  const direction = pick("score_direction", "scoreDirection");
  const basis = pick("evidence_basis", "evidenceBasis");
  return Object.freeze({
    indicatorLabel: pick("indicator_label", "indicatorLabel"),
    meaningText: pick("meaning_text", "meaningText"),
    scoreDirection: SCORE_DIRECTIONS.includes(direction) ? direction : "",
    evidenceBasis: EVIDENCE_BASES.includes(basis) ? basis : "not_established",
  });
}

/** Whether the form would record something other than `initial` (both as the route would receive them). */
export function interpretationFormChanged(form, initial, { paired }) {
  const next = interpretationBody(form, { paired });
  const before = interpretationBody(initial || EMPTY_INTERPRETATION_FORM, { paired });
  if (!next) return false;
  return JSON.stringify(next) !== JSON.stringify(before);
}

/**
 * What KAI already established about a recorded measurement, before a person
 * is asked what it means: for a paired outcome, the column KAI read, the
 * structure it found and the persisted breakdown; otherwise the recorded
 * result. Persisted values only; nothing here states a meaning.
 */
export function recordedMeasurementKnownLines(recorded) {
  if (!recorded) return [];
  if (recorded.measurement_family !== "paired_outcome_change") {
    return [`Recorded result: ${recorded.measured_value}${recorded.percentage ? ` (${recorded.percentage}%)` : ""}. KAI calculated it; what it represents is not something KAI can tell from the file.`];
  }
  const counts = recorded.component_counts || {};
  const column = recorded.definition?.outcome_column;
  const lines = [
    `${column ? `Column ${column}` : "This column"} holds a numeric score recorded for the same participants at baseline and at follow-up. `
      + "KAI found this from the worksheet's layout; the layout does not say what the score means.",
  ];
  if ([counts.comparable_pair_count, counts.increased_count, counts.unchanged_count, counts.decreased_count].every(Number.isInteger)) {
    lines.push(`Among ${counts.comparable_pair_count} participants with comparable baseline and follow-up values, ${counts.increased_count} had a higher follow-up value, `
      + `${counts.unchanged_count} were unchanged and ${counts.decreased_count} had a lower follow-up value.`);
  }
  if (Number.isInteger(counts.excluded_participant_count) && Number.isInteger(counts.participant_count)) {
    lines.push(`${counts.excluded_participant_count} of ${counts.participant_count} participants had no comparable pair and were excluded.`);
  }
  return lines;
}

/** The interpretation body, or null when no label and meaning are given. */
export function interpretationBody(form, { paired }) {
  const label = form.indicatorLabel.trim();
  const meaning = form.meaningText.trim();
  if (!label || !meaning) return null;
  return {
    indicator_label: label,
    meaning_text: meaning,
    ...(paired ? { score_direction: form.scoreDirection || "not_established" } : {}),
    evidence_basis: form.evidenceBasis || "not_established",
  };
}

const FAMILY_LABELS = Object.freeze({
  paired_outcome_change: "Paired baseline/follow-up outcome",
  tabular_count: "Count",
  tabular_rate: "Rate",
  cross_source_reach: "Linked reach (service events and participant register)",
});

export function measurementFamilyLabel(family) {
  return FAMILY_LABELS[family] || "Measurement";
}

/** The current evidence of a recorded measurement: the one stated under its current interpretation. */
export function currentEvidenceOf(recorded) {
  return (recorded?.evidence || []).find((entry) => entry.current === true) || null;
}

// Cross-source linked reach is queued: the POST returns the reconciliation job
// (202), which is read until it settles. The worker, not this page, reads the files.
export function crossSourceReconciliationJobsPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/cross-source-reconciliation-jobs`;
}

export function crossSourceReconciliationJobPath(organizationId, reconciliationJobId) {
  return `${crossSourceReconciliationJobsPath(organizationId)}/${encodeURIComponent(reconciliationJobId)}`;
}

export const EMPTY_CROSS_SOURCE_FORM = Object.freeze({
  referenceSourceVersionId: "",
  eventIdentifierFieldKey: "",
  participantIdentifierFieldKey: "",
  statusFieldKey: "",
  completedValueKey: "",
  dateFieldKey: "",
  groupFieldKey: "",
  registerParticipantFieldKey: "",
  // Optional activity findings: eligible encounters by service month, and
  // the known recorded duration of a column the person confirms holds minutes.
  monthlyActivity: false,
  durationFieldKey: "",
  durationConfirmed: false,
});

/** Why the linkage form cannot be sent yet, or null. */
export function crossSourceFormProblem(form, { reportingPeriodRecorded }) {
  if (!form.referenceSourceVersionId) return "Choose the participant register source version to link.";
  if (!form.eventIdentifierFieldKey) return "Choose the field that identifies each service event.";
  if (!form.participantIdentifierFieldKey) return "Choose the field that identifies the participant of each event.";
  if (form.eventIdentifierFieldKey === form.participantIdentifierFieldKey) return "The event and participant fields must be different fields.";
  if (!form.statusFieldKey || !form.completedValueKey) return "Choose the status field and the value that means a completed service.";
  if (!form.dateFieldKey) return "Choose the service date field.";
  if (!form.registerParticipantFieldKey) return "Choose the register field holding the same participant identifier.";
  if (form.durationFieldKey && !form.durationConfirmed) return "Confirm that the duration column records each service's duration in minutes.";
  if (!reportingPeriodRecorded) return "This source's engagement has no recorded reporting period yet.";
  return null;
}

/** The POST body: both version ids and the person's mapping; nothing else is sent. */
export function crossSourceRequestBody(form, primarySourceVersionId) {
  return {
    primary_source_version_id: primarySourceVersionId,
    reference_source_version_id: form.referenceSourceVersionId,
    mapping: {
      events: {
        event_identifier_field_key: form.eventIdentifierFieldKey,
        participant_identifier_field_key: form.participantIdentifierFieldKey,
        status_field_key: form.statusFieldKey,
        completed_value_key: form.completedValueKey,
        date_field_key: form.dateFieldKey,
        ...(form.groupFieldKey ? { group_field_key: form.groupFieldKey } : {}),
      },
      register: { participant_identifier_field_key: form.registerParticipantFieldKey },
      // A duration mapping also requests the monthly breakdown (the server's rule).
      ...(form.durationFieldKey && form.durationConfirmed
        ? { duration: { field_key: form.durationFieldKey, meaning: "recorded_service_duration", unit: "minutes" } }
        : form.monthlyActivity ? { monthly_activity: true } : {}),
    },
  };
}

const JOB_STATE_TEXT = Object.freeze({
  queued: "Queued: KAI will reconcile the two source versions shortly.",
  in_progress: "Reconciling the two source versions...",
  retry_scheduled: "A temporary problem interrupted the reconciliation; KAI will try again.",
  succeeded: "Reconciled. The measurements below are recorded; their evidence still needs review.",
  failed: "KAI could not reconcile these source versions.",
  exhausted: "KAI could not reach the source files after several attempts. Request it again later.",
});

export function reconciliationJobStateText(job) {
  return JOB_STATE_TEXT[job?.job_state] || "Unknown reconciliation state.";
}

export function reconciliationJobSettled(job) {
  return ["succeeded", "failed", "exhausted"].includes(job?.job_state);
}

const CROSS_SOURCE_METRIC_LABELS = Object.freeze({
  eligible_linked_encounters: "Eligible service encounters (events, not people)",
  distinct_people_served: "Distinct registered people served",
  group_linked_encounters: "Eligible encounters",
  group_distinct_people_served: "Distinct people served",
  people_in_more_than_one_group: "People served in more than one group",
  monthly_eligible_encounters: "Eligible service encounters by month (events, not people)",
  known_recorded_service_minutes: "Known recorded service minutes (subtotal)",
});

export function crossSourceMetricLabel(definition) {
  const label = CROSS_SOURCE_METRIC_LABELS[definition?.metric] || "Linked reach";
  return definition?.group ? `${label} in ${definition.group.value_label}` : label;
}

/** A non-negative decimal string with its whole part grouped by thousands. */
export function groupDigits(value) {
  const [whole, fraction] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/**
 * The headline value of a linked measurement. A duration measurement's
 * measured_value counts the encounters with a recorded duration, so its
 * headline is the minutes subtotal the server recorded, with its unit.
 */
export function crossSourceHeadlineValue(entry) {
  if (entry?.definition?.metric === "known_recorded_service_minutes") {
    const minutes = entry.component_counts?.known_recorded_minutes;
    return minutes === null || minutes === undefined ? "no known minutes" : `${groupDigits(minutes)} minutes`;
  }
  return groupDigits(entry?.measured_value ?? "");
}

/**
 * What a linked reconciliation excluded before its counts, from the server's
 * recorded funnel (owner Package 2): every exclusion step the method applied,
 * including the events whose status is not the person-selected completed
 * value (for example cancelled and no-show events). Blank identifiers and
 * completed events without a valid date are listed only when they excluded
 * something. Display only: every number is one the server recorded.
 */
export function crossSourceExclusionText(entry) {
  const c = entry?.component_counts || {};
  const completedLabel = entry?.definition?.mapping?.events?.completed_value_label;
  const notCompleted = Number.isInteger(c.consistent_event_count) && Number.isInteger(c.completed_event_count)
    ? c.consistent_event_count - c.completed_event_count : null;
  const optional = (count, text) => (Number.isInteger(count) && count > 0 ? [`${count} ${text}`] : []);
  // Copies of a conflicting identity are excluded with it (counted below),
  // not counted once as duplicate copies.
  const countedOnceCopies = c.excess_copy_record_count - ((c.conflicting_record_count ?? 0) - (c.conflicting_event_identity_count ?? 0));
  const parts = [
    `${countedOnceCopies} duplicate copies`,
    ...optional(c.blank_event_identifier_record_count, "without an event identifier"),
    ...(notCompleted === null ? [] : [`${notCompleted} with a status other than ${completedLabel ? `"${completedLabel}"` : "the completed value"}`]),
    ...optional(c.completed_without_date_count, "completed without a valid date"),
    `${c.completed_outside_period_count} completed outside the period`,
    ...optional(c.blank_participant_identifier_event_count, "without a participant identifier"),
    `${c.unmatched_event_count} with no register match`,
    `${c.conflicting_event_identity_count} conflicting event identities${c.conflicting_event_identity_count > 0 && Number.isInteger(c.conflicting_record_count) ? ` (${c.conflicting_record_count} records)` : ""}`,
  ];
  return `Excluded and counted: ${parts.join(", ")}. Register: ${c.register_distinct_identifier_count} distinct registered participants.`;
}

/** "2025-04" -> "Apr 2025", for display only; the recorded month is unchanged. */
export function monthLabel(month) {
  const [year, number] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(number) - 1] || number} ${year}`;
}

/**
 * The activity detail of a linked measurement, from the server's recorded
 * components only: the monthly breakdown with the eligible total, and for a
 * duration measurement the known, missing and invalid counts and whether the
 * minutes are a subtotal. Null for other linked measurements.
 */
export function crossSourceActivityDetail(entry) {
  const counts = entry?.component_counts;
  const metric = entry?.definition?.metric;
  if (!counts || !["monthly_eligible_encounters", "known_recorded_service_minutes"].includes(metric)) return null;
  const detail = {
    metric,
    period: entry.definition.period ? { start: entry.definition.period.period_start, end: entry.definition.period.period_end } : null,
    months: Array.isArray(counts.monthly_activity) ? counts.monthly_activity : [],
    eligible: counts.eligible_encounter_count,
  };
  if (metric !== "known_recorded_service_minutes") return detail;
  const unrecorded = counts.duration_missing_count + counts.duration_invalid_count;
  return {
    ...detail,
    duration: {
      knownMinutes: counts.known_recorded_minutes,
      unit: entry.definition.duration?.unit || "minutes",
      fieldKey: entry.definition.duration?.field_key || null,
      known: counts.duration_known_count,
      missing: counts.duration_missing_count,
      invalid: counts.duration_invalid_count,
      subtotal: unrecorded > 0,
    },
  };
}

/**
 * This version's reconciliations, then those of earlier versions of the same
 * source (replaced): an earlier version's results are historical and are not
 * offered here as current.
 */
export function reconciliationHistory(jobs, sourceVersionId, earlierVersionIds = []) {
  const earlier = new Set(earlierVersionIds);
  return [
    ...jobs.filter((job) => job.primary_source_version_id === sourceVersionId).map((job) => ({ job, historical: false })),
    ...jobs.filter((job) => earlier.has(job.primary_source_version_id)).map((job) => ({ job, historical: true })),
  ];
}

/** Whether every source version a recorded measurement combines is still current. */
export function contributingSourcesCurrent(recorded) {
  const sources = Array.isArray(recorded?.contributing_sources) ? recorded.contributing_sources : [];
  return sources.every((source) => source.is_current === true);
}
