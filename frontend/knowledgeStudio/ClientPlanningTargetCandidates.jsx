import React from "react";

import { planningTargetCheckLabel, planningTargetRelationshipLabel, planningTargetRowsText } from "./clientDerivedMeasurementLogic.js";

/**
 * Planned targets a worksheet itself states (read-only candidates from the
 * verified upload): each row's planned value, unit, programme, period and
 * status, where it is in the source, what is not stated, and any recorded
 * result on this Project that may be the same measure with every check KAI
 * can make. A candidate is the organization's plan, never a result, and is
 * never used as a target from here: storing a target together with its
 * worksheet row is not available yet, and the page says so.
 */
export default function ClientPlanningTargetCandidates({ planning }) {
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
        {" "}These are your organization's plans, not results. KAI has not used any of them as a target.
      </div>
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
            {" · "}{candidate.comparator ? `result should be ${candidate.comparator === "at_least" ? "at least" : "at most"} this` : "at least / at most not stated"}
          </div>
          <div className="mt-1" data-client-planning-target-related="">
            {candidate.related_measurements.length === 0
              ? <span className="text-muted">No recorded result on this Project has a name that matches this indicator.</span>
              : candidate.related_measurements.map((related) => (
                <div key={related.source_derived_measurement_id} data-client-planning-target-related-measurement={related.source_derived_measurement_id}
                  data-client-planning-target-relationship={related.relationship.status}>
                  <div>Possibly related recorded result: <span className="fw-semibold">{related.name}</span>: {related.value_text}</div>
                  <div className="fw-semibold">{planningTargetRelationshipLabel(related.relationship.status)}</div>
                  {related.relationship.checks.some((check) => check.result === "fail") ? (
                    <ul className="mb-1" data-client-planning-target-differences="">
                      {related.relationship.checks.filter((check) => check.result === "fail").map((check) => <li key={check.key}>{check.text}</li>)}
                    </ul>
                  ) : null}
                  <details data-client-planning-target-checks=""><summary>All checks</summary>
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
            <details data-client-planning-target-questions=""><summary>Questions before this can be compared ({candidate.limitations.length})</summary>
              <ul className="mb-0">
                {candidate.limitations.map((item) => <li key={item.code} data-client-planning-target-limitation={item.code}>{item.description}</li>)}
              </ul>
            </details>
          ) : null}
          <details data-client-planning-target-source=""><summary>Source</summary>
            {worksheet}, row {candidate.row_number}; source version {candidate.locator.source_version_id}.
            {" "}Columns: {Object.entries(planning.columns).map(([role, column]) => `${role.replace(/_/g, " ")} ${column.column}`).join(", ")}.
          </details>
        </article>
      ))}</div>
      <div className="text-muted" data-client-planning-target-persistence={planning.persistence?.reason || ""}>{planning.persistence?.message}</div>
    </section>
  );
}
