import React from "react";

import {
  SERVICE_ROLE_ORDER,
  planningTargetCheckLabel,
  serviceFunnelLines,
  serviceRoleLabel,
  serviceRoleStatusLabel,
  serviceScopeText,
} from "./clientDerivedMeasurementLogic.js";

function groupDigits(value) {
  return Number.isSafeInteger(value) ? value.toLocaleString("en-US") : String(value ?? "");
}

function SaveButton({ finding, saved, pending, canProposeClaim, onSave, label }) {
  if (!finding) return null;
  return (
    <button type="button" className="btn btn-sm btn-outline-primary" disabled={pending || saved || !finding.recordable}
      data-client-save-service-finding={finding.measurement_key} aria-label={`${saved ? "Saved" : "Save"} ${label || finding.name}${canProposeClaim ? " for reports" : ""}`}
      onClick={() => onSave([finding.measurement_key])}>
      {saved ? "Saved" : canProposeClaim ? "Save for reports" : "Save result"}
    </button>
  );
}

function RoleChoice({ role, entry, draft, setDraft, pending }) {
  const candidates = entry.candidates || [];
  const fieldKeyName = role === "status" ? "status_field_key" : `${role}_field_key`;
  const selectedField = draft[fieldKeyName] ?? entry.field_key ?? "";
  const nullable = !["status", "service_date"].includes(role);
  const statusValues = role === "status" ? (candidates.find((candidate) => candidate.field_key === (draft.status_field_key ?? entry.field_key))?.values || []) : [];
  const eligibilityValues = role === "eligibility" ? (candidates.find((candidate) => candidate.field_key === (draft.eligibility_field_key ?? entry.field_key))?.values || []) : [];
  const update = (change) => setDraft((current) => ({ ...current, ...change }));
  return (
    <div className="kai-service-role-choice d-flex flex-wrap gap-2" data-client-service-role-choice={role}>
      <label>
        Column
        <select className="form-select form-select-sm" value={selectedField === null ? "none" : selectedField} disabled={pending} data-client-service-role-select={role}
          onChange={(event) => {
            const value = event.target.value;
            const change = { [fieldKeyName]: value };
            if (role === "status") change.completed_value_key = "";
            if (role === "eligibility") change.eligibility_value_key = "";
            update(change);
          }}>
          <option value="">Choose a column</option>
          {nullable ? <option value="none">None of these columns</option> : null}
          {candidates.map((candidate) => <option key={candidate.field_key} value={candidate.field_key}>{`Column ${candidate.column} (${candidate.field_key})`}</option>)}
        </select>
      </label>
      {role === "status" ? (
        <label>
          Completed value
          <select className="form-select form-select-sm" value={draft.completed_value_key ?? entry.completed_value_key ?? ""} disabled={pending} data-client-service-role-select="completed_value"
            onChange={(event) => update({ status_field_key: draft.status_field_key ?? entry.field_key, completed_value_key: event.target.value })}>
            <option value="">Choose the value that means completed</option>
            {statusValues.map((value) => <option key={value.value_key} value={value.value_key}>{value.label}</option>)}
          </select>
        </label>
      ) : null}
      {role === "entity_identifier" ? (
        <label>
          One identifier is one
          <select className="form-select form-select-sm" value={draft.entity_kind ?? entry.entity_kind ?? ""} disabled={pending} data-client-service-role-select="entity_kind"
            onChange={(event) => update({ entity_kind: event.target.value })}>
            <option value="">Not stated</option>
            <option value="household">household</option>
            <option value="person">person</option>
            <option value="family">family</option>
          </select>
        </label>
      ) : null}
      {role === "eligibility" && (draft.eligibility_field_key ?? entry.field_key) && (draft.eligibility_field_key ?? entry.field_key) !== "none" ? (
        <label>
          Records count when the value is
          <select className="form-select form-select-sm" value={draft.eligibility_value_key ?? entry.included_value_key ?? ""} disabled={pending} data-client-service-role-select="eligibility_value"
            onChange={(event) => update({ eligibility_field_key: draft.eligibility_field_key ?? entry.field_key, eligibility_value_key: event.target.value })}>
            <option value="">Choose the value that includes a record</option>
            {eligibilityValues.map((value) => <option key={value.value_key} value={value.value_key}>{value.label}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

/**
 * Service-delivery measurements of one service-record table (single source),
 * shown before every raw count: completed encounters, the programme
 * breakdown, households served, the actual date scope, exclusions and
 * compatible planned targets. The server calculates everything from the
 * verified upload; this component only displays it, keeps a person's unsaved
 * column choices and saves chosen findings by measurement key.
 */
export default function ClientServiceDeliveryMeasurements({
  service, pending, canProposeClaim, isSaved, onSave, roleDraft, setRoleDraft, onApplyRoles, onResetRoles, rolesApplied,
}) {
  if (!service) return null;
  if (service.status !== "available") {
    return (
      <div className="kai-service-delivery mb-3" data-client-service-delivery={service.status}>
        <div className="fw-semibold">Service-delivery measurements</div>
        <div className="text-muted" data-client-service-delivery-unavailable={service.reason}>{service.message}</div>
      </div>
    );
  }
  const findings = service.findings || [];
  const headlineMode = service.period_applied ? "period" : "all_dates";
  const find = (predicate) => findings.find(predicate) ?? null;
  const completed = find((f) => f.metric === "completed_service_encounters" && f.mode === headlineMode);
  const allDates = service.period_applied ? find((f) => f.metric === "completed_service_encounters" && f.mode === "all_dates") : null;
  const programmes = findings.filter((f) => f.metric === "group_completed_service_encounters" && f.group?.role === "programme");
  const activities = findings.filter((f) => f.metric === "group_completed_service_encounters" && f.group?.role === "activity");
  const entities = find((f) => f.metric === "distinct_entities_served");
  const entityProgrammes = findings.filter((f) => f.metric === "group_distinct_entities_served");
  const monthly = find((f) => f.metric === "monthly_completed_service_encounters");
  const requirement = (metric) => (service.unavailable || []).filter((item) => item.metric === metric).map((item) => item.requirement).join(" ");
  const required = findings.filter((f) => f.required);
  const allRequiredSaved = required.length > 0 && required.every((f) => isSaved(f));
  const unsavedRequired = required.filter((f) => !isSaved(f) && f.recordable);
  const encounterColumn = service.roles?.encounter_identifier?.status && ["established", "proposed"].includes(service.roles.encounter_identifier.status) ? service.roles.encounter_identifier.column : null;
  const sourceValue = (f) => f?.finding_basis === "source_values";
  const suggestions = service.target_suggestions || [];
  const compatible = suggestions.filter((s) => s.status === "confirmation_required");
  const notComparable = suggestions.filter((s) => s.status !== "confirmation_required");
  const pairActivities = (programme) => activities.map((activity) => ({ activity, count: (service.funnel?.programme_activity || [])
    .find((pair) => pair.programme_value_key === programme.group.value_key && pair.activity_value_key === activity.group.value_key)?.encounter_count ?? 0 }))
    .filter((entry) => entry.count > 0);
  // The source's own status values other than the completed one (never assumed names).
  const notCompletedLabels = (service.funnel?.status_values || []).filter((value) => value.label !== service.roles?.status?.completed_value_label && value.event_count > 0).map((value) => value.label);
  const savedText = (f) => (isSaved(f) ? <span className="kai-measurement-report-status" data-client-service-finding-state="saved">{canProposeClaim ? "Saved; available for reports" : "Saved"}</span> : null);
  return (
    <section className="kai-service-delivery mb-3" data-client-service-delivery="available" aria-label="Service-delivery measurements">
      <h6 className="mb-1">Service-delivery measurements</h6>
      <div className="text-muted" data-client-service-scope="">{serviceScopeText(service)} One service-record source; no participant register is linked.</div>
      {rolesApplied ? <div className="text-muted" data-client-service-roles-applied="">Calculated with the column choices you made below (not saved until you save a result).</div> : null}
      <div className="kai-measurement-outcomes">
        <article className="kai-measurement-outcome" data-client-service-card="completed">
          <div className="fw-semibold">{completed?.name || "Completed service encounters"}</div>
          {completed ? <>
            <strong className="kai-measurement-value" data-client-service-value="completed">{groupDigits(completed.measured_value)}</strong>
            <div>{sourceValue(completed)
              ? "Source-value finding: the columns it uses are not all established as service-encounter columns."
              : `Each encounter counted once${encounterColumn ? ` (column ${encounterColumn})` : ""}; ${notCompletedLabels.length > 0 ? `${notCompletedLabels.join(", ")}` : "not completed"}, conflicting${service.period_applied ? " and out-of-period" : ""} records excluded.`}</div>
            {allDates ? <div className="text-muted" data-client-service-all-dates="">{groupDigits(allDates.measured_value)} across all dates in the source.</div> : null}
            {requirement("distinct_encounters") ? <div className="text-muted" data-client-service-requirement="distinct_encounters">{requirement("distinct_encounters")}</div> : null}
            {savedText(completed)}
          </> : <div data-client-service-requirement="completed">{requirement("completed_service_encounters") || "Not available from this source."}</div>}
        </article>
        <article className="kai-measurement-outcome" data-client-service-card="programmes">
          <div className="fw-semibold">Completed encounters by programme</div>
          {programmes.length > 0 ? <ul className="kai-service-breakdown" data-client-service-programmes="">
            {programmes.map((programme) => (
              <li key={programme.measurement_key} data-client-service-programme={programme.group.value_label}>
                <span>{programme.group.value_label}</span> <strong>{groupDigits(programme.measured_value)}</strong>
                {pairActivities(programme).length > 0 ? <span className="text-muted"> ({pairActivities(programme).map((entry) => `${entry.activity.group.value_label} ${entry.count}`).join(", ")})</span> : null}
                {sourceValue(programme) ? <span className="text-muted"> source values</span> : null}
              </li>
            ))}
          </ul> : <div data-client-service-requirement="programmes">{requirement("group_completed_service_encounters") || "No programme breakdown is available."}</div>}
          {programmes.length > 0 && service.funnel?.ungrouped_programme_encounter_count ? <div className="text-muted">{service.funnel.ungrouped_programme_encounter_count} completed encounters have no listed programme.</div> : null}
          {programmes.length > 0 && programmes.every((p) => isSaved(p)) ? <span className="kai-measurement-report-status" data-client-service-finding-state="saved">{canProposeClaim ? "Saved; available for reports" : "Saved"}</span> : null}
        </article>
        <article className="kai-measurement-outcome" data-client-service-card="households">
          <div className="fw-semibold">{entities?.name || "Distinct households served"}</div>
          {entities ? <>
            <strong className="kai-measurement-value" data-client-service-value="households">{groupDigits(entities.measured_value)}</strong>
            <div>{sourceValue(entities)
              ? "Distinct identifier values: what one identifier represents is not established."
              : `Each counted once, with at least one counted encounter; ${service.funnel?.multi_programme_entity_count ?? 0} in more than one programme.`}</div>
            {requirement("entity_kind") ? <div className="text-muted" data-client-service-requirement="entity_kind">{requirement("entity_kind")}</div> : null}
            {savedText(entities)}
          </> : <div data-client-service-requirement="households">{requirement("distinct_entities_served") || "Not available from this source."}</div>}
        </article>
      </div>
      {requirement("period_scope") ? <div className="text-muted" data-client-service-requirement="period_scope">{requirement("period_scope")}</div> : null}
      {requirement("eligibility") ? <div className="text-muted" data-client-service-requirement="eligibility">{requirement("eligibility")}</div> : null}
      <button type="button" className="btn btn-sm btn-primary kai-service-save" data-client-save-service-measurements=""
        disabled={pending || allRequiredSaved || unsavedRequired.length === 0}
        onClick={() => onSave(unsavedRequired.map((f) => f.measurement_key))}>
        {allRequiredSaved ? "Service measurements saved" : canProposeClaim ? "Save service measurements for reports" : "Save service measurements"}
      </button>
      {compatible.length > 0 ? (
        <div className="kai-service-targets mt-2" data-client-service-target-suggestions="">
          <div className="fw-semibold">Planned targets these results may answer</div>
          {compatible.map((suggestion) => (
            <div key={suggestion.planned_target_id} className="kai-measurement-plan border rounded p-2 mt-1" data-client-service-target={suggestion.planned_target_id} data-client-service-target-status={suggestion.status}>
              <div>{suggestion.indicator}: plan {suggestion.planned_value} {suggestion.unit}{suggestion.scope ? ` (${suggestion.scope})` : ""}, {suggestion.period.start} to {suggestion.period.end}{suggestion.worksheet_key ? `; ${suggestion.worksheet_key} row ${suggestion.row_number}` : ""}.</div>
              <div>Possible actual: {suggestion.result?.name}: {suggestion.result?.value_text}. May be the same measure; only your organization can confirm what it counts.</div>
              {suggestion.relationship_status === "confirmed" ? <div className="kai-measurement-report-status">Relationship confirmed on the planning worksheet.</div> : null}
              <ul>{suggestion.checks.map((check) => <li key={check.key} data-client-planning-target-check-result={check.result}>{planningTargetCheckLabel(check.result)}: {check.text}</li>)}</ul>
            </div>
          ))}
          <div className="text-muted">Confirm or reject a relationship on the planning worksheet; nothing is accepted here.</div>
        </div>
      ) : null}
      {notComparable.length > 0 ? (
        <details data-client-service-targets-not-comparable=""><summary>Planned targets these results do not answer ({notComparable.length})</summary>
          {notComparable.map((suggestion) => (
            <div key={suggestion.planned_target_id} data-client-service-target={suggestion.planned_target_id} data-client-service-target-status={suggestion.status}>
              {suggestion.indicator} ({suggestion.planned_value} {suggestion.unit}{suggestion.scope ? `, ${suggestion.scope}` : ""}): {suggestion.result ? `not comparable with ${suggestion.result.name}` : "no result in the same programme scope"}.
              <ul>{suggestion.checks.filter((check) => check.result === "fail").map((check) => <li key={check.key} data-client-planning-target-check-result="fail">{check.text}</li>)}</ul>
            </div>
          ))}
        </details>
      ) : null}
      <details data-client-service-exclusions=""><summary>Exclusions, limitations and how it was counted</summary>
        <ul className="mb-1">{serviceFunnelLines(service.funnel, { periodApplied: service.period_applied, encounterColumn }).map((line) => <li key={line}>{line}</li>)}</ul>
        <div className="text-muted">Calculated from the source records themselves (each identifier, status, date and programme on the same record), never from separate column totals. KAI did not check the values against any other source; register membership is not checked from this source alone.</div>
        {(service.source_value_notes || []).map((note) => <div key={note.field_key} className="text-muted" data-client-service-source-note={note.field_key}>{note.text}</div>)}
      </details>
      {(allDates || activities.length > 0 || entityProgrammes.length > 0 || monthly) ? (
        <details data-client-service-more-results=""><summary>More service results (all dates, activities, households by programme, months)</summary>
          <div className="kai-measurement-results">
            {[allDates, ...activities, ...entityProgrammes, monthly].filter(Boolean).map((finding) => (
              <div className="kai-measurement-result" key={finding.measurement_key} data-client-service-finding={finding.measurement_key}>
                <div className="kai-measurement-result-label">{finding.name}{finding.mode === "all_dates" ? " (all dates)" : ""}</div>
                <strong>{finding.metric === "monthly_completed_service_encounters"
                  ? (finding.monthly_activity || []).map((item) => `${item.month}: ${item.encounter_count}`).join(", ")
                  : groupDigits(finding.measured_value)}</strong>
                <SaveButton finding={finding} saved={isSaved(finding)} pending={pending} canProposeClaim={canProposeClaim} onSave={onSave} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <details data-client-service-roles=""><summary>How KAI read the columns</summary>
        {SERVICE_ROLE_ORDER.map((role) => {
          const entry = service.roles?.[role];
          if (!entry) return null;
          return (
            <div key={role} className="kai-service-role mb-2" data-client-service-role={role} data-client-service-role-status={entry.status}>
              <div><strong>{serviceRoleLabel(role)}</strong>: {entry.column ? `column ${entry.column}` : "no column"}{entry.counted_unit ? `, counting ${entry.counted_unit}s` : ""}{entry.entity_kind ? `, one ${entry.entity_kind} per identifier` : ""}{entry.completed_value_label ? `, completed = ${entry.completed_value_label}` : ""} - {serviceRoleStatusLabel(entry.status)}{entry.basis === "person_selected" ? " (your choice)" : ""}</div>
              <div className="text-muted">{(entry.evidence || []).join(" ")}</div>
              <RoleChoice role={role} entry={entry} draft={roleDraft} setDraft={setRoleDraft} pending={pending} />
            </div>
          );
        })}
        <div className="d-flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-outline-primary" disabled={pending || Object.keys(roleDraft || {}).length === 0} data-client-service-apply-roles="" onClick={onApplyRoles}>Recalculate with these columns</button>
          {rolesApplied || Object.keys(roleDraft || {}).length > 0 ? <button type="button" className="btn btn-sm btn-link" disabled={pending} data-client-service-reset-roles="" onClick={onResetRoles}>Use KAI's reading</button> : null}
        </div>
      </details>
    </section>
  );
}
