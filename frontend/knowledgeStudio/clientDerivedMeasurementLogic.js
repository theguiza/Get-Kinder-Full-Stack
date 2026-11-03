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
