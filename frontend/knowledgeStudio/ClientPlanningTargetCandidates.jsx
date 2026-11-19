import React, { useEffect, useState } from "react";
import { keepMeasurementDraft, measurementDraftKey, readMeasurementDraft } from './measurementDraftStore.js';

import { planningTargetCheckLabel, planningTargetRelationshipLabel, planningTargetRowsText } from "./clientDerivedMeasurementLogic.js";

/** Source-backed plans, independently saved; later decisions never change the source row. */
export default function ClientPlanningTargetCandidates({ planning, organizationId, pending, onSave, onDecision, onPropose }) {
  const draftKey = measurementDraftKey(organizationId, planning?.source?.source_version_id, planning?.worksheet_key, 'planned');
  const [drafts,setDrafts] = useState(() => readMeasurementDraft(draftKey) || {});
  useEffect(() => { setDrafts(readMeasurementDraft(draftKey) || {}); }, [draftKey]);
  useEffect(() => { keepMeasurementDraft(draftKey, Object.keys(drafts).length ? drafts : null); }, [draftKey,drafts]);
  const patch = (key, change) => setDrafts((d) => ({ ...d,[key]:{ ...d[key],...change } }));
  if (!planning) return null;
  if (planning.status === "not_assessable") {
    return <div className="text-muted mb-2" data-client-planning-targets="not_assessable">{planning.message}</div>;
  }
  const worksheet = planning.source?.worksheet_name || planning.worksheet_key;
  if (planning.status !== "candidates") {
    return (
      <div className="mb-2" data-client-planning-targets={planning.status}>
        <div className="fw-semibold">Planned targets</div>
        <div className="text-muted">
          {planning.status === "planning_columns_ambiguous"
            ? `${worksheet} has more than one column that could hold the planned value or the indicator, so KAI does not choose one. Keep one of each and upload the file again as a new intake version.`
            : planning.status === "too_many_rows"
              ? `${worksheet} has more rows than KAI reads as a planning table.`
              : `${worksheet} has planning columns but no planned-target rows.`}
        </div>
      </div>
    );
  }
  return (
    <section className="mb-3" data-client-planning-targets="candidates">
      <div className="fw-semibold">Planned targets in this worksheet</div>
      <div className="text-muted">
        {planning.candidates.length} planned {planning.candidates.length === 1 ? "value" : "values"} stated in {worksheet} ({planningTargetRowsText(planning.candidates)}).
        {" "}These are your organization's plans, not achieved results. Save plans now; confirm comparable actuals later.
      </div>
      <button type="button" className="btn btn-primary my-2" data-client-save-all-planned-targets=""
        disabled={pending || !planning.candidates.some((c) => c.saveable && !c.saved)}
        onClick={() => onSave(planning.candidates.filter((c) => c.saveable && !c.saved).map((c) => c.row_number))}>Save all available plans for reports</button>
      <div className="kai-measurement-outcomes">{planning.candidates.map((candidate) => (
        <article className="kai-measurement-outcome kai-measurement-plan" key={candidate.candidate_key} data-client-planning-target={candidate.candidate_key}>
          <div className="fw-semibold" data-client-planning-target-indicator="">{candidate.indicator || "Indicator withheld"}</div>
          <strong className="kai-measurement-value" data-client-planning-target-value="">
            {candidate.planned_value != null ? `${candidate.planned_value}${candidate.unit_kind === "percent" ? "%" : ""}` : "No readable value"}
          </strong>
          <div>{candidate.unit && candidate.unit_kind !== "percent" ? `Planned ${candidate.unit}` : candidate.unit_kind === "percent" ? "Planned percentage" : "Unit not stated"}{candidate.status_label ? ` · status: ${candidate.status_label}` : ""}</div>
          <div className="text-muted" data-client-planning-target-scope="">
            {candidate.scope ? `${candidate.scope_applies_to_all ? "Applies to" : "Only for"} ${candidate.scope}` : "Scope not stated"}
            {" · "}{candidate.period ? `${candidate.period.start} to ${candidate.period.end}` : "period not stated"}
            {" · Source direction: "}{candidate.comparator ? `result should be ${candidate.comparator === "at_least" ? "at least" : "at most"} this` : "at least / at most not stated"}
          </div>
          <div data-client-planning-target-saved={candidate.saved ? 'saved' : 'unsaved'}>
            {candidate.saved ? 'Plan saved' : 'Plan not saved'} · Relationship: {candidate.saved?.relationship_status || 'unresolved'} · {candidate.saved?.relationship_status === 'confirmed' && !candidate.saved.actual_availability
              ? `Actual confirmed: ${candidate.saved.actual_value}. ${candidate.saved.comparison ? `Direction: ${candidate.saved.comparison.replace('_',' ')}.` : 'Comparison direction unknown; attainment not calculated.'}`
              : candidate.saved?.actual_availability ? 'Actual unavailable: its source is replaced or no longer available for this use. Record a new compatible relationship to compare.' : 'Actual unavailable; no confirmed relationship.'}
            {candidate.comparison_result ? ` Target ${candidate.comparison_result.met ? 'met' : 'not met'}; variance ${candidate.comparison_result.variance}.` : ''}
          </div>
          {!candidate.saved ? <button type="button" className="btn btn-sm btn-primary" data-client-save-planned-target={candidate.row_number}
            disabled={pending || !candidate.saveable} onClick={() => onSave([candidate.row_number])}>Save plan for reports</button>
            : !candidate.saved.claim_id ? <button type="button" className="btn btn-sm btn-outline-primary" disabled={pending}
              data-client-planned-target-propose={candidate.row_number} onClick={() => onPropose(candidate.saved.evidence_item_id)}>Add plan to reports</button>
              : <span data-client-planned-target-report-ready="">Ready for reports</span>}
          <div className="mt-1" data-client-planning-target-related="">
            {candidate.related_measurements.length === 0
              ? <span className="text-muted">Actual unavailable. No recorded result on this Project has a name that matches this indicator.</span>
              : candidate.related_measurements.map((related) => (
                <div key={related.source_derived_measurement_id} data-client-planning-target-related-measurement={related.source_derived_measurement_id}
                  data-client-planning-target-relationship={candidate.saved?.actual_measurement_id === related.source_derived_measurement_id ? candidate.saved.relationship_status : related.relationship.status}>
                  <div>{candidate.saved?.actual_measurement_id === related.source_derived_measurement_id && candidate.saved.relationship_status === 'confirmed' ? 'Confirmed actual: ' : 'Possibly related recorded result: '}<span className="fw-semibold">{related.name}</span>: {related.value_text}</div>
                  <div className="fw-semibold">{candidate.saved?.actual_measurement_id === related.source_derived_measurement_id && ['confirmed','rejected'].includes(candidate.saved.relationship_status) ? `${candidate.saved.relationship_status === 'confirmed' ? 'Confirmed' : 'Rejected'} by your organization.` : planningTargetRelationshipLabel(related.relationship.status)}</div>
                  {related.relationship.checks.some((check) => check.result === "fail") ? (
                    <ul className="mb-1" data-client-planning-target-differences="">
                      {related.relationship.checks.filter((check) => check.result === "fail").map((check) => <li key={check.key}>{check.text}</li>)}
                    </ul>
                  ) : null}
                  {related.relationship.status === 'confirmation_required' && !(candidate.saved?.actual_measurement_id === related.source_derived_measurement_id && ['confirmed','rejected'].includes(candidate.saved.relationship_status)) ? <div className="text-muted">
                    Unresolved: does {candidate.indicator} ({candidate.unit}) mean {related.name}? {related.relationship.checks.find((c) => c.key === 'period')?.text}
                    {' '}Confirm the named date column, metric and population before comparing. {!candidate.saved?.comparison && !candidate.comparator ? 'At least / at most must also be established.' : ''}
                  </div> : null}
                  <details data-client-planning-target-checks=""><summary>{candidate.saved?.actual_measurement_id === related.source_derived_measurement_id ? 'Checks when proposed' : 'All checks'}</summary>
                    <ul className="mb-1">
                      {related.relationship.checks.map((check) => (
                        <li key={check.key} data-client-planning-target-check={check.key} data-client-planning-target-check-result={check.result}>
                          {planningTargetCheckLabel(check.result)}: {check.text}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
          </div>
          {candidate.limitations.length > 0 ? (
            <details data-client-planning-target-questions=""><summary>{candidate.saved?.relationship_status === 'confirmed' ? 'Original source notes' : 'Questions before this can be compared'} ({candidate.limitations.length})</summary>
              <ul className="mb-0">
                {candidate.limitations.map((item) => <li key={item.code} data-client-planning-target-limitation={item.code}>{item.description}</li>)}
              </ul>
            </details>
          ) : null}
          {candidate.saved ? <details data-client-planned-target-decisions=""><summary>Confirm a relationship or comparison direction</summary>
            <div>Only confirm when the actual counts the same metric and population, using the intended date basis. </div>
            {candidate.unit === 'self_reports' ? <div>Does self_reports mean reported_contact? Should referral date or follow-up date define the fiscal year? Choose the intended date column from the possible actuals; KAI does not choose for you.</div> : null}
            <label className="d-block">Actual result
              <select className="form-select" data-client-plan-actual={candidate.row_number} value={drafts[candidate.candidate_key]?.actual ?? candidate.saved.actual_measurement_id ?? ''}
                onChange={(e) => patch(candidate.candidate_key,{ actual:e.target.value,metric:false,population:false,date:false })}>
                <option value="">Actual unavailable / unresolved</option>
                {candidate.related_measurements.filter((r) => r.relationship.status !== 'not_comparable').map((r) => <option key={r.source_derived_measurement_id} value={r.source_derived_measurement_id}>
                  {r.name}: {r.value_text} — {r.relationship.checks.find((c) => c.key === 'period')?.text}
                </option>)}
              </select>
            </label>
            <label className="d-block">Comparison direction
              <select className="form-select" data-client-plan-comparison={candidate.row_number} value={drafts[candidate.candidate_key]?.comparison ?? candidate.saved.comparison ?? ''}
                disabled={Boolean(candidate.comparator)} onChange={(e) => patch(candidate.candidate_key,{ comparison:e.target.value })}>
                <option value="">Unknown — do not calculate attainment</option><option value="at_least">At least</option><option value="at_most">At most</option>
              </select>
            </label>
            {['metric','population','date'].map((key) => <label className="d-block" key={key}>
              <input type="checkbox" data-client-plan-confirm={`${candidate.row_number}:${key}`} checked={drafts[candidate.candidate_key]?.[key] ?? false} onChange={(e) => patch(candidate.candidate_key,{ [key]:e.target.checked })} />
              {' '}{key === 'metric' ? `I confirm the actual measures ${candidate.indicator} in ${candidate.unit}.` : key === 'population' ? `I confirm the same population and programme (${candidate.scope || 'as stated'}).` : 'I confirm which date defines the period for this actual (read the named date column above).'}
            </label>)}
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} data-client-confirm-planned-target={candidate.row_number}
              onClick={() => {
                const d = drafts[candidate.candidate_key] || {};
                const actual = d.actual ?? candidate.saved.actual_measurement_id ?? null;
                onDecision(candidate.saved,{ expected_decision_id:candidate.saved.decision_id,actual_measurement_id:actual || null,
                  relationship_status:actual ? 'confirmed' : 'unresolved',comparison:d.comparison !== undefined ? d.comparison || null : candidate.saved.comparison || null,
                  metric_confirmed:actual ? d.metric === true : false,population_confirmed:actual ? d.population === true : false,date_basis_confirmed:actual ? d.date === true : false });
              }}>Save confirmation</button>
            {(drafts[candidate.candidate_key]?.actual || candidate.saved.actual_measurement_id) ? <button type="button" className="btn btn-sm btn-outline-secondary" disabled={pending}
              onClick={() => onDecision(candidate.saved,{ expected_decision_id:candidate.saved.decision_id,
                actual_measurement_id:drafts[candidate.candidate_key]?.actual || candidate.saved.actual_measurement_id,relationship_status:'rejected',
                comparison:drafts[candidate.candidate_key]?.comparison !== undefined ? drafts[candidate.candidate_key].comparison || null : candidate.saved.comparison || null,metric_confirmed:false,population_confirmed:false,date_basis_confirmed:false })}>Reject this relationship</button> : null}
          </details> : null}
          <details data-client-planning-target-source=""><summary>Source</summary>
            {worksheet}, row {candidate.row_number}; source version {candidate.locator.source_version_id}.
            {candidate.saved?.relationship_status === 'confirmed' ? <div>Actual source version {candidate.saved.actual_source_version_id}, worksheet {candidate.saved.actual_worksheet_key || 'whole source'}; measurement {candidate.saved.actual_measurement_id}.</div> : null}
            {" "}Columns: {Object.entries(planning.columns).map(([role, column]) => `${role.replace(/_/g, " ")} ${column.column}`).join(", ")}.
          </details>
        </article>
      ))}</div>
      <div className="text-muted" data-client-planning-target-persistence={planning.persistence?.reason || ""}>{planning.persistence?.message}</div>
    </section>
  );
}
