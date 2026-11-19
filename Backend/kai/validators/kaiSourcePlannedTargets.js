import { screenedSourceLabel } from "../profiling/tabularMeasurementBasis.js";
import { assessPlanningTargetRelationship } from "./kaiPlanningTargetCandidates.js";

export const PLANNED_TARGET_EVIDENCE_TYPE = "source_planned_target";
export const PLANNED_TARGET_LOCATOR_TYPE = "planning_target_row";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SHA = /^[a-f0-9]{64}$/;
export const targetCoordinates = (candidate) => ({ sheet_key: candidate.locator.worksheet_key, row_number: candidate.row_number });
export function saveablePlanningCandidate(candidate) {
  return Boolean(candidate && candidate.indicator && screenedSourceLabel(candidate.indicator) === candidate.indicator
    && (candidate.unit_kind === 'percent' && (candidate.unit == null || candidate.unit === '%')
      || candidate.unit && screenedSourceLabel(candidate.unit) === candidate.unit)
    && candidate.period && /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(candidate.planned_value ?? '') && ['count','percent'].includes(candidate.unit_kind)
    && !candidate.limitations.some((x) => ['duplicate_target_rows','scope_withheld','comparison_not_recognized'].includes(x.code))
    && (candidate.unit_kind === 'percent' ? Number(candidate.planned_value) <= 100 : Number.isInteger(Number(candidate.planned_value))));
}
export function planningCandidateFromRow(p) {
  return { indicator: p.indicator, planned_value: p.planned_value, unit: p.unit, unit_kind: p.unit_kind,
    period: { start: p.period_start, end: p.period_end }, scope: p.scope,
    scope_applies_to_all: /^(all|overall|total|all programs|all programmes|organization|organisation)$/i.test(p.scope || ''),
    comparator: p.source_comparison, limitations: [] };
}
// Confirmation answers are specific attestations by the authorized actor;
// uploaded prose is never interpreted as an answer. Mechanical failures cannot
// be overridden by those answers.
export function validatePlannedTargetDecision(input, { target, actual = null, actualEngagementId = null }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !Object.keys(input).every((k) => ['expected_decision_id','actual_measurement_id','relationship_status','comparison','metric_confirmed','population_confirmed','date_basis_confirmed'].includes(k))
    || !UUID.test(input.expected_decision_id || '')
    || !['unresolved','confirmed','rejected'].includes(input.relationship_status)
    || ![null,'at_least','at_most'].includes(input.comparison)
    || (target.source_comparison && input.comparison !== target.source_comparison)) return { ok: false, reason: 'planned_target_decision_invalid' };
  const flags = ['metric_confirmed','population_confirmed','date_basis_confirmed'];
  if (input.relationship_status === 'unresolved') {
    if (input.actual_measurement_id != null || flags.some((k) => input[k] !== false)) return { ok: false, reason: 'planned_target_unresolved_invalid' };
  } else {
    if (!actual || actual.source_derived_measurement_id !== input.actual_measurement_id) return { ok: false, reason: 'planned_target_actual_missing' };
    if (input.relationship_status === 'confirmed') {
      if (flags.some((k) => input[k] !== true)) return { ok: false, reason: 'planned_target_meaning_unconfirmed' };
      const assessment = assessPlanningTargetRelationship({ candidate: planningCandidateFromRow(target), measurement: actual,
        planningEngagementId: target.engagement_id, measurementEngagementId: actualEngagementId });
      if (assessment.checks.some((c) => c.result === 'fail')) return { ok: false, reason: 'planned_target_actual_incompatible' };
    } else if (flags.some((k) => input[k] !== false)) return { ok: false, reason: 'planned_target_rejection_invalid' };
  }
  return { ok: true };
}
const compact = (value) => String(value).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
export function plannedTargetComparison(row) {
  if (row.relationship_status !== 'confirmed' || !row.comparison || row.actual_value == null || row.actual_is_current === false) return null;
  const cents = (x) => { const [w,f = ''] = String(x).split('.'); return BigInt(w) * 100n + BigInt(f.padEnd(2,'0')); };
  const a = cents(row.actual_value), t = cents(row.planned_value);
  return { actual_value: compact(row.actual_value), planned_value: compact(row.planned_value), comparison: row.comparison,
    met: row.comparison === 'at_least' ? a >= t : a <= t,
    variance: (Number(a - t) / 100).toFixed(2) };
}
export function composePlannedTargetStatement(row) {
  const plan = `Source-stated plan: ${row.indicator}, ${compact(row.planned_value)} ${row.unit}${row.scope ? ` (${row.scope})` : ''}, ${row.period_start} to ${row.period_end}; ${row.worksheet_key} row ${row.row_number}.`;
  const comparison = plannedTargetComparison(row);
  const actual = row.relationship_status === 'confirmed'
    ? ` Confirmed actual: ${compact(row.actual_value)}; source ${row.actual_source_version_id}; measurement ${row.actual_measurement_id}.`
    : ` Actual unavailable; relationship ${row.relationship_status}.`;
  const direction = row.comparison ? ` Direction: ${row.comparison === 'at_least' ? 'at least' : 'at most'}.` : ' Comparison direction unknown.';
  return `${plan}${actual}${direction}${comparison ? ` Target ${comparison.met ? 'met' : 'not met'}; variance ${comparison.variance}.` : ' Attainment not calculated.'} Plan is not an achieved outcome.`;
}

export const PLANNED_TARGET_LIMITATIONS = Object.freeze({
  source_stated_plan_not_achievement:'This is a source-stated planned value, not evidence that the activity or outcome occurred.',
  planned_target_actual_unresolved:'No compatible actual relationship is confirmed; possible metric and date matches are suggestions only.',
  planned_target_direction_unknown:'The comparison direction is unknown, so attainment is not calculated.',
});
export function plannedTargetLimitationCodes(row) {
  return ['source_stated_plan_not_achievement', ...(row.relationship_status === 'confirmed' ? [] : ['planned_target_actual_unresolved']), ...(row.comparison ? [] : ['planned_target_direction_unknown'])];
}
