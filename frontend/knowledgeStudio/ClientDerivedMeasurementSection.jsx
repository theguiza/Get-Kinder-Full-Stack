import React, { useCallback, useEffect, useRef, useState } from "react";

import { claimProposalPath, errorText, getJson, postJson } from "../impactEvidenceLibraryLogic.js";
import { claimProposalResultMessage } from "./clientEvidenceWorkflowLogic.js";
import ClientCrossSourceMeasurementSection from "./ClientCrossSourceMeasurementSection.jsx";
import {
  EMPTY_INTERPRETATION_FORM,
  EMPTY_TABULAR_FORM,
  contributingSourcesCurrent,
  crossSourceMetricLabel,
  currentEvidenceOf,
  derivedMeasurementBasisPath,
  derivedMeasurementInterpretationPath,
  interpretationBody,
  measurementFamilyLabel,
  pairedOutcomeMeasurementsPath,
  tabularDefinitionBody,
  tabularFormProblem,
  tabularMeasurementPath,
} from "./clientDerivedMeasurementLogic.js";

const ROLE_LABELS = Object.freeze({ identifier: "identifier", categorical: "category", date: "date" });

function fieldLabel(field) {
  // A field whose values describe a person, a sensitive attribute or free text
  // keeps no labels in the profile, so it can be counted only as a whole.
  const withheld = field.vocabulary_withheld ? ", values withheld" : "";
  return `Column ${field.column_position} (${field.field_key}, ${ROLE_LABELS[field.role] || field.role}${withheld})`;
}

/**
 * Source-derived measurements of one current source version (Measurement
 * MVP), inside the record-count panel: the paired outcome results KAI
 * proposes, a count or rate a person defines by choosing the fields and
 * listed values KAI found, and every recorded measurement with its meaning.
 * KAI retains a result without any meaning; "Clarify meaning" records what a
 * result represents as the organization's statement and never changes its
 * numbers. The server calculates and validates everything.
 */
export default function ClientDerivedMeasurementSection({ organizationId, sourceVersionId, worksheetKey, canProposeClaim, onRecorded, linkableVersions = [], versionsById = null }) {
  const [basis, setBasis] = useState({ status: "loading", data: null, error: "" });
  const [form, setForm] = useState(EMPTY_TABULAR_FORM);
  const [meaning, setMeaning] = useState(EMPTY_INTERPRETATION_FORM);
  const [clarifying, setClarifying] = useState(null);
  const [clarifyForm, setClarifyForm] = useState(EMPTY_INTERPRETATION_FORM);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    seqRef.current += 1;
    const seq = seqRef.current;
    const result = await getJson(derivedMeasurementBasisPath(organizationId, sourceVersionId, worksheetKey || null));
    if (seqRef.current !== seq) return;
    setBasis(result.statusCode === 200 && result.body?.ok
      ? { status: "success", data: result.body.data, error: "" }
      : { status: "error", data: null, error: errorText(result) });
  }, [organizationId, sourceVersionId, worksheetKey]);
  useEffect(() => {
    setForm(EMPTY_TABULAR_FORM);
    setMeaning(EMPTY_INTERPRETATION_FORM);
    setClarifying(null);
    setNotice(null);
    load();
  }, [load]);

  const send = async (kind, path, body, success) => {
    if (pending) return;
    setPending(kind);
    setNotice(null);
    let result;
    try {
      result = await postJson(path, body);
    } finally {
      setPending("");
    }
    const ok = (result.statusCode === 200 || result.statusCode === 201) && result.body?.ok;
    setNotice(ok ? { kind: "success", text: result.body.data?.replayed ? "Already recorded; nothing changed." : success(result.body.data) } : { kind: "warning", text: errorText(result) });
    if (ok) {
      onRecorded?.();
      load();
    }
    return ok;
  };

  const data = basis.data;
  const fields = data?.tabular?.available ? data.tabular.fields : [];
  const byRole = (role) => fields.filter((field) => field.role === role);
  const valuesOf = (fieldKey) => fields.find((field) => field.field_key === fieldKey)?.values || [];
  const problem = tabularFormProblem(form);
  const recordTabular = (event) => {
    event.preventDefault();
    if (problem) return;
    const interpretation = interpretationBody(meaning, { paired: false });
    send("tabular", tabularMeasurementPath(organizationId, sourceVersionId, worksheetKey || null),
      { definition: tabularDefinitionBody(form), ...(interpretation ? { interpretation } : {}) },
      (recorded) => `Measurement recorded: ${recorded.measurement.measured_value}${recorded.measurement.percentage ? ` (${recorded.measurement.percentage}%)` : ""}.`)
      .then((ok) => { if (ok) { setForm(EMPTY_TABULAR_FORM); setMeaning(EMPTY_INTERPRETATION_FORM); } });
  };
  const clarify = (event, recorded) => {
    event.preventDefault();
    const body = interpretationBody(clarifyForm, { paired: recorded.measurement_family === "paired_outcome_change" });
    if (!body) return;
    send("clarify", derivedMeasurementInterpretationPath(organizationId, recorded.source_derived_measurement_id), body,
      () => "Meaning recorded. The numbers are unchanged; propose a claim from the measurement's current evidence.")
      .then((ok) => { if (ok) { setClarifying(null); setClarifyForm(EMPTY_INTERPRETATION_FORM); } });
  };

  const setField = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const select = (key, options, placeholder, extra = {}) => (
    <select className="form-select form-select-sm" value={form[key]} onChange={setField(key)} data-client-derived-field={key} {...extra}>
      <option value="">{placeholder}</option>
      {options}
    </select>
  );

  return (
    <div className="border-top pt-2 mt-2 small" data-client-derived-measurements={sourceVersionId}>
      <h6 className="mb-1">Measure field values</h6>
      <div className="text-muted mb-1">
        KAI calculates these from the values its profile kept for this source version. A result is kept without any meaning; what it
        represents is your organization's statement, and stating it never changes the numbers.
      </div>
      {basis.status === "loading" ? <div className="text-muted" data-client-derived-loading="">Loading...</div> : null}
      {basis.status === "error" ? <div className="alert alert-warning py-2" data-client-derived-error="">{basis.error}</div> : null}
      {notice ? <div className={`alert alert-${notice.kind} py-2`} data-client-derived-notice={notice.kind}>{notice.text}</div> : null}

      {data?.paired?.available ? (
        <div className="mb-2" data-client-derived-paired="">
          <div className="fw-semibold">Proposed baseline/follow-up results</div>
          {data.paired.measurements.map((item) => (
            <div key={item.outcome_field_key} data-client-derived-paired-field={item.outcome_field_key}>
              {item.available
                ? `Numeric outcome ${item.outcome_field_key} (column ${item.outcome_column}): ${item.numerator} of ${item.denominator} comparable pairs (${item.percentage}%) have a numerically higher follow-up value; whether higher is better is not established.`
                : `${item.outcome_field_key || "A field"}: ${item.blockers?.[0]?.message || "cannot be measured."}`}
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-outline-primary mt-1" disabled={Boolean(pending)} data-client-derived-record-paired=""
            onClick={() => send("paired", pairedOutcomeMeasurementsPath(organizationId, sourceVersionId, worksheetKey || null), {},
              (recorded) => `${recorded.measurements.length} proposed results kept as evidence.`)}>
            {pending === "paired" ? "Keeping..." : "Keep these results as evidence"}
          </button>
        </div>
      ) : null}

      {data?.tabular?.available ? (
        <form className="mb-2" onSubmit={recordTabular} data-client-derived-tabular-form="">
          <div className="fw-semibold">Define a count or rate</div>
          <div className="text-muted">
            {data.tabular.record_count} records. Exact-duplicate rows: {data.tabular.exact_duplicates.member_record_count} in{" "}
            {data.tabular.exact_duplicates.group_count} repeated groups ({data.tabular.exact_duplicates.excess_copy_count} excess copies).
          </div>
          <label className="d-block">
            Calculation
            {select("operation", [<option key="rate" value="rate">Rate (numerator of a measured population)</option>], "Count", { value: form.operation === "rate" ? "rate" : "" })}
          </label>
          {form.operation !== "rate" ? (
            <label className="d-block">
              Count each
              {select("identifierFieldKey", byRole("identifier").map((field) => <option key={field.field_key} value={field.field_key}>{`${fieldLabel(field)} value once`}</option>), "record")}
            </label>
          ) : null}
          <div className="d-flex flex-wrap gap-2">
            <label>
              {form.operation === "rate" ? "Numerator: records where" : "Only records where"}
              {select("categoryFieldKey", byRole("categorical").map((field) => <option key={field.field_key} value={field.field_key}>{fieldLabel(field)}</option>), "any field")}
            </label>
            {form.categoryFieldKey ? (
              <label>
                is
                {select("categoryValueKey", valuesOf(form.categoryFieldKey).map((value) => <option key={value.value_key} value={value.value_key}>{`${value.label} (${value.record_count})`}</option>), "choose a value")}
              </label>
            ) : null}
          </div>
          {form.operation === "rate" ? (
            <div className="d-flex flex-wrap gap-2">
              <label>
                Measured population: records where
                {select("populationFieldKey", byRole("categorical").map((field) => <option key={field.field_key} value={field.field_key}>{fieldLabel(field)}</option>), "all records")}
              </label>
              {form.populationFieldKey ? (
                <label>
                  is
                  {select("populationValueKey", valuesOf(form.populationFieldKey).map((value) => <option key={value.value_key} value={value.value_key}>{`${value.label} (${value.record_count})`}</option>), "choose a value")}
                </label>
              ) : null}
            </div>
          ) : (
            <div className="d-flex flex-wrap gap-2">
              <label>
                Date field for the reporting period
                {select("periodFieldKey", byRole("date").map((field) => <option key={field.field_key} value={field.field_key}>{fieldLabel(field)}</option>), "no period (all dates)")}
              </label>
              {form.periodFieldKey ? (
                <label>
                  Records dated
                  <select className="form-select form-select-sm" value={form.periodScope} onChange={setField("periodScope")} data-client-derived-field="periodScope">
                    <option value="within">within the engagement reporting period</option>
                    <option value="outside">outside the engagement reporting period</option>
                  </select>
                </label>
              ) : null}
            </div>
          )}
          {form.periodFieldKey && !data.reporting_period ? (
            <div className="text-warning" data-client-derived-no-period="">This source's engagement has no recorded reporting period yet.</div>
          ) : null}
          {form.periodFieldKey && data.reporting_period ? (
            <div className="text-muted">Engagement reporting period: {data.reporting_period.start} to {data.reporting_period.end}.</div>
          ) : null}
          <div className="d-flex flex-wrap gap-2 mt-1">
            <label>
              Meaning (optional): indicator label
              <input className="form-control form-control-sm" value={meaning.indicatorLabel} data-client-derived-meaning="indicatorLabel"
                onChange={(event) => setMeaning((current) => ({ ...current, indicatorLabel: event.target.value }))} />
            </label>
            <label>
              What it represents
              <input className="form-control form-control-sm" value={meaning.meaningText} data-client-derived-meaning="meaningText"
                onChange={(event) => setMeaning((current) => ({ ...current, meaningText: event.target.value }))} />
            </label>
            <label>
              Where the values come from
              <select className="form-select form-select-sm" value={meaning.evidenceBasis} data-client-derived-meaning="evidenceBasis"
                onChange={(event) => setMeaning((current) => ({ ...current, evidenceBasis: event.target.value }))}>
                <option value="not_established">not stated</option>
                <option value="self_reported">self-reported by the people recorded</option>
                <option value="organization_record">the organization's own records</option>
              </select>
            </label>
          </div>
          {problem ? <div data-client-derived-problem="">{problem}</div> : null}
          <button type="submit" className="btn btn-sm btn-primary mt-1" disabled={Boolean(problem) || Boolean(pending)} data-client-derived-record-tabular="">
            {pending === "tabular" ? "Calculating..." : "Calculate and record"}
          </button>
        </form>
      ) : null}
      {data?.tabular?.available && !data.tabular.sheetKey ? (
        <ClientCrossSourceMeasurementSection organizationId={organizationId} sourceVersionId={sourceVersionId} eventsBasis={data}
          linkableVersions={linkableVersions} versionsById={versionsById}
          onReconciled={() => { onRecorded?.(); load(); }} />
      ) : null}
      {data?.tabular && !data.tabular.available ? (
        <div className="text-muted mb-2" data-client-derived-tabular-unavailable="">
          {data.tabular.blockers?.[0]?.message || "KAI kept no field values it can measure for this source version. Upload it again as a new intake version to measure field values."}
        </div>
      ) : null}

      {(data?.recorded || []).filter((recorded) => (recorded.worksheet_key || "") === (worksheetKey || data?.tabular?.sheetKey || "")).map((recorded) => {
        const current = currentEvidenceOf(recorded);
        const paired = recorded.measurement_family === "paired_outcome_change";
        const linked = recorded.measurement_family === "cross_source_reach";
        const stillCurrent = contributingSourcesCurrent(recorded);
        return (
          <div key={recorded.source_derived_measurement_id} className="border rounded p-2 mb-1" data-client-derived-recorded={recorded.source_derived_measurement_id}
            data-client-derived-current={stillCurrent ? "current" : "not_current"}>
            <div className="fw-semibold">
              {measurementFamilyLabel(recorded.measurement_family)}{linked ? ` - ${crossSourceMetricLabel(recorded.definition)}` : ""}: {recorded.measured_value}{recorded.percentage ? ` (${recorded.percentage}%)` : ""}
            </div>
            {linked ? (
              <ul className="mb-1" data-client-derived-contributing-sources="">
                {recorded.contributing_sources.map((source) => (
                  <li key={source.source_version_id} data-client-derived-contributing-source={source.source_role} data-client-derived-contributing-current={source.is_current ? "current" : "not_current"}>
                    {source.source_role === "primary" ? "Service events" : "Participant register"}: {versionsById?.get(source.source_version_id)?.safeFilename || "source version"} {source.source_version_id}
                    {source.is_current ? "" : " (replaced by a newer version)"}
                  </li>
                ))}
              </ul>
            ) : null}
            {!stillCurrent ? (
              <div className="text-danger" data-client-derived-not-current="">
                No longer current: a source version it was calculated from has been replaced. It cannot support a claim or a new report; reconcile the current versions instead.
              </div>
            ) : null}
            {recorded.category_labels_withheld ? (
              <div className="text-warning" data-client-derived-labels-withheld="">Recorded from category values KAI now withholds; it cannot be stated or used.</div>
            ) : null}
            {current?.interpretation
              ? <div data-client-derived-meaning-state="stated">Meaning stated by your organization: {current.interpretation.indicator_label}. {current.interpretation.meaning_text}</div>
              : <div data-client-derived-meaning-state="proposed">Meaning proposed, not stated by your organization.</div>}
            {current ? (
              <ul className="mb-1">
                {current.limitations.map((entry) => <li key={entry.code} data-client-derived-limitation={entry.code}>{entry.description}</li>)}
              </ul>
            ) : null}
            {current?.claim ? (
              <div data-client-derived-claim={current.claim.claim_id}>Claim: {current.claim.statement}</div>
            ) : null}
            {current && !current.claim && canProposeClaim ? (
              <button type="button" className="btn btn-sm btn-outline-primary me-1" disabled={Boolean(pending)} data-client-derived-propose-claim={current.evidence_item_id}
                onClick={() => send("propose", claimProposalPath(organizationId, current.evidence_item_id), {}, (proposed) => claimProposalResultMessage(proposed))}>
                Propose a claim
              </button>
            ) : null}
            <button type="button" className="btn btn-sm btn-link" data-client-derived-clarify={recorded.source_derived_measurement_id}
              onClick={() => { setClarifying(clarifying === recorded.source_derived_measurement_id ? null : recorded.source_derived_measurement_id); setClarifyForm(EMPTY_INTERPRETATION_FORM); }}>
              Clarify meaning
            </button>
            {clarifying === recorded.source_derived_measurement_id ? (
              <form onSubmit={(event) => clarify(event, recorded)} data-client-derived-clarify-form="">
                <label className="d-block">
                  Indicator label
                  <input className="form-control form-control-sm" value={clarifyForm.indicatorLabel} data-client-derived-clarify-field="indicatorLabel"
                    onChange={(event) => setClarifyForm((value) => ({ ...value, indicatorLabel: event.target.value }))} />
                </label>
                <label className="d-block">
                  What it represents
                  <input className="form-control form-control-sm" value={clarifyForm.meaningText} data-client-derived-clarify-field="meaningText"
                    onChange={(event) => setClarifyForm((value) => ({ ...value, meaningText: event.target.value }))} />
                </label>
                {paired ? (
                  <label className="d-block">
                    Is a higher score better?
                    <select className="form-select form-select-sm" value={clarifyForm.scoreDirection} data-client-derived-clarify-field="scoreDirection"
                      onChange={(event) => setClarifyForm((value) => ({ ...value, scoreDirection: event.target.value }))}>
                      <option value="">not established</option>
                      <option value="higher_is_better">higher is better</option>
                      <option value="lower_is_better">lower is better</option>
                    </select>
                  </label>
                ) : null}
                <label className="d-block">
                  Where the values come from
                  <select className="form-select form-select-sm" value={clarifyForm.evidenceBasis} data-client-derived-clarify-field="evidenceBasis"
                    onChange={(event) => setClarifyForm((value) => ({ ...value, evidenceBasis: event.target.value }))}>
                    <option value="not_established">not stated</option>
                    <option value="self_reported">self-reported by the people recorded</option>
                    <option value="organization_record">the organization's own records</option>
                  </select>
                </label>
                <button type="submit" className="btn btn-sm btn-primary mt-1" disabled={Boolean(pending) || !interpretationBody(clarifyForm, { paired })} data-client-derived-clarify-submit="">
                  {pending === "clarify" ? "Recording..." : "Record meaning"}
                </button>
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
