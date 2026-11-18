import ProjectReportingPeriodEditor from "../projects/ProjectReportingPeriodEditor.jsx";
import { projectPeriodProblem } from "../../shared/kaiProjectReportingPeriod.js";
import ProjectReportingContext from "../projects/ProjectReportingContext.js";
import React, { useCallback, useContext, useEffect, useRef, useState } from "react";

import { claimProposalPath, errorText, getJson, postJson } from "../impactEvidenceLibraryLogic.js";
import { claimProposalResultMessage } from "./clientEvidenceWorkflowLogic.js";
import ClientCrossSourceMeasurementSection, { CrossSourceActivityDetail } from "./ClientCrossSourceMeasurementSection.jsx";
import {
  changeTabularField,
  crossSourceReconciliationJobPath,
  reconciliationJobSettled,
  EMPTY_INTERPRETATION_FORM,
  EMPTY_TABULAR_FORM,
  contributingSourcesCurrent,
  crossSourceHeadlineValue,
  crossSourceMetricLabel,
  currentEvidenceOf,
  derivedMeasurementBasisPath,
  derivedMeasurementInterpretationPath,
  interpretationBody,
  interpretationFormProblem,
  interpretationFormFrom,
  recordedMeasurementKnownLines,
  measurementFamilyLabel,
  sourceHeadingSuggestionOf,
  pairedOutcomeMeasurementsPath,
  tabularDefinitionBody,
  tabularFormProblem,
  tabularMeasurementPath,
  measurementTargetPath,
  measurementTargetUnit,
} from "./clientDerivedMeasurementLogic.js";
import MeaningQuestionsForm from "./MeaningQuestionsForm.jsx";

const TABULAR_UNAVAILABLE_MESSAGES = Object.freeze({
  table_not_established: "The profile does not establish one unambiguous table. Keep one table with a header for every column and upload it again as a new intake version.",
  no_data_records: "This worksheet has no data records to measure.",
  joint_aggregates_exceed_limit: "This table exceeds the field measurement aggregate limit. Use Count records, or upload a smaller table to measure field values.",
  tabular_basis_not_committed: "This source was profiled without field measurement aggregates. Upload it again as a new intake version to measure field values.",
});
const ROLE_LABELS = Object.freeze({ identifier: "identifier", categorical: "category", date: "date" });

function fieldLabel(field) {
  // A field whose values describe a person, a sensitive attribute or free text
  // keeps no labels in the profile, so it can be counted only as a whole.
  const withheld = field.vocabulary_withheld ? ", values withheld" : "";
  const letter = (position) => position > 26 ? `${letter(Math.floor((position - 1) / 26))}${String.fromCharCode(65 + (position - 1) % 26)}` : String.fromCharCode(64 + position);
  const detail = field.role === "identifier" ? `${field.identifier?.distinct_count ?? "unknown"} distinct keys`
    : field.role === "date" ? `${field.date?.earliest_month || "unknown"} to ${field.date?.latest_month || "unknown"}${field.date?.excel_date_cell_count
      ? `, including ${field.date.excel_date_cell_count} Excel date cells${field.date.excel_date_system ? ` (${field.date.excel_date_system === "excel_1904" ? "1904" : "1900"} date system)` : ""}` : ""}`
      : (field.values || []).slice(0, 3).map((value) => value.label).join(", ");
  return `Column ${field.column_position} / ${letter(field.column_position)} (${field.field_key}, ${ROLE_LABELS[field.role] || field.role}${withheld}); ${field.present_count} present, ${field.blank_count} blank${detail ? `; ${detail}` : ""}`;
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
export default function ClientDerivedMeasurementSection({ organizationId, sourceVersionId, worksheetKey, canProposeClaim, onRecorded, linkableVersions = [], versionsById = null, earlierVersionIds = [] }) {
  const { revision } = useContext(ProjectReportingContext);
  const lastRevision = useRef(revision);
  const [basis, setBasis] = useState({ status: "loading", data: null, error: "" });
  const [form, setForm] = useState(EMPTY_TABULAR_FORM);
  const [pairingChoice, setPairingChoice] = useState("");
  const [meaning, setMeaning] = useState(EMPTY_INTERPRETATION_FORM);
  const [clarifying, setClarifying] = useState(null);
  const [clarifyForm, setClarifyForm] = useState(EMPTY_INTERPRETATION_FORM);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState(null);
  // A queued calculation (exact Project-period days from the verified uploaded file), read until it settles.
  const [calculationJob, setCalculationJob] = useState(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setBasis((current) => ({ ...current, status: current.data ? "refreshing" : "loading", error: "" }));
    try {
      const result = await getJson(derivedMeasurementBasisPath(organizationId, sourceVersionId, worksheetKey || null));
      if (seqRef.current !== seq) return false;
      if (result.statusCode === 200 && result.body?.ok) {
        setBasis({ status: "success", data: result.body.data, error: "" });
        return true;
      }
      setBasis((current) => ({ ...current, status: "error", error: errorText(result) }));
    } catch {
      if (seqRef.current === seq) setBasis((current) => ({ ...current, status: "error", error: "The measurement basis could not be loaded. Your selections and meaning draft are kept. Retry the read." }));
    }
    return false;
  }, [organizationId, sourceVersionId, worksheetKey]);
  useEffect(() => {
    setForm(EMPTY_TABULAR_FORM);
    setPairingChoice("");
    setMeaning(EMPTY_INTERPRETATION_FORM);
    setClarifying(null);
    setNotice(null);
    setCalculationJob(null);
    load();
    return () => { seqRef.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!calculationJob || reconciliationJobSettled(calculationJob)) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await getJson(crossSourceReconciliationJobPath(organizationId, calculationJob.reconciliation_job_id));
        if (cancelled) return;
        const job = result.statusCode === 200 ? result.body?.data?.reconciliationJob : null;
        if (!job) {
          setCalculationJob({ ...calculationJob });
          return;
        }
        setCalculationJob(job);
        if (job.job_state === "succeeded") {
          const recorded = result.body.data.measurements?.[0];
          setNotice({ kind: "success", text: `Measurement recorded from the uploaded file: ${recorded?.measured_value ?? ""}${recorded?.percentage ? ` (${recorded.percentage}%)` : ""}.` });
          onRecorded?.();
          load();
        } else if (["failed", "exhausted"].includes(job.job_state)) {
          setNotice({ kind: "warning", text: job.error_code === "tabular_period_field_personal_attribute"
            ? "The selected date field describes a person (for example a date of birth), so KAI does not apply a period's exact days to it. Nothing was recorded; choose the service or activity date field, or no period."
            : `KAI could not calculate this from the uploaded file (${(job.error_code || "unknown reason").replace(/_/g, " ")}). Nothing was recorded; check the source version and its Project period, then try again.` });
        }
      } catch {
        if (!cancelled) setCalculationJob({ ...calculationJob });
      }
    }, 1200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [calculationJob, organizationId, load, onRecorded]);

  useEffect(() => {
    if (lastRevision.current === revision) return;
    lastRevision.current = revision;
    load();
  }, [revision, load]);

  const send = async (kind, path, body, success) => {
    if (pending) return;
    setPending(kind);
    setNotice(null);
    let result;
    try {
      result = await postJson(path, body);
    } catch {
      setNotice({ kind: "warning", text: "KAI could not confirm the write. Your inputs are kept. Refresh measurements to check whether it was recorded before retrying." });
      await load();
      return false;
    } finally {
      setPending("");
    }
    if (result.statusCode === 202 && result.body?.ok && result.body.data?.queued) {
      setCalculationJob(result.body.data.calculationJob);
      setNotice({ kind: "info", text: "Calculating with the Project period's exact dates from the verified uploaded file. The result appears here when it is recorded." });
      return true;
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
  const meaningProblem = interpretationFormProblem(meaning);
  const problem = basis.status !== "success" ? "Load the current measurement basis before recording." : tabularFormProblem(form, data) || meaningProblem;
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

  // The organization's planned target per recorded measurement (a plan, compared with the recorded actual).
  const [targetDrafts, setTargetDrafts] = useState({});
  const setTargetDraft = (recorded, change) => setTargetDrafts((drafts) => ({
    ...drafts,
    [recorded.source_derived_measurement_id]: {
      value: drafts[recorded.source_derived_measurement_id]?.value ?? recorded.target?.target_value?.replace(/\.00$/, "") ?? "",
      comparison: drafts[recorded.source_derived_measurement_id]?.comparison ?? recorded.target?.comparison ?? "at_least",
      ...change,
    },
  }));
  const setTarget = (event, recorded) => {
    event.preventDefault();
    const draft = targetDrafts[recorded.source_derived_measurement_id];
    const value = (draft?.value ?? "").trim();
    if (!value) {
      setNotice({ kind: "warning", text: "Enter the planned target value first." });
      return;
    }
    send("target", measurementTargetPath(organizationId, recorded.source_derived_measurement_id),
      { target_value: value, comparison: draft?.comparison ?? recorded.target?.comparison ?? "at_least" },
      (saved) => `Target recorded. ${saved.comparison?.text ?? ""}`)
      .then((ok) => { if (ok) setTargetDrafts((drafts) => { const next = { ...drafts }; delete next[recorded.source_derived_measurement_id]; return next; }); });
  };

  const setField = (key) => (event) => {
    const value = event.target.value;
    setForm((current) => changeTabularField(current, key, value));
    if (key === "operation") {
      setNotice({ kind: "warning", text: "Calculation changed. Choose its fields and values again and review your retained meaning draft. Count filters and rate populations are not carried over." });
    }
  };
  const select = (key, options, placeholder, extra = {}) => (
    <select className="form-select form-select-sm" value={form[key]} onChange={setField(key)} disabled={Boolean(pending)} data-client-derived-field={key} {...extra}>
      <option value="">{placeholder}</option>
      {options}
    </select>
  );

  return (
    <div className="border-top pt-2 mt-2 small" data-client-derived-measurements={sourceVersionId}>
      <h6 className="mb-1">Measure field values</h6>
      <div className="text-muted mb-1">
        KAI calculates the numbers from this source. You can save calculated results without entering a definition.
        An optional description explains what they mean; it does not change the calculation.
      </div>
      {["loading", "refreshing"].includes(basis.status) ? <div className="text-muted" data-client-derived-loading="">Loading...</div> : null}
      {basis.status === "error" ? <div className="alert alert-warning py-2" data-client-derived-error="">{basis.error} <button type="button" className="btn btn-sm btn-outline-primary" data-client-derived-retry="" onClick={load}>Retry measurement read</button></div> : null}
      {basis.status !== "loading" ? <button type="button" className="btn btn-sm btn-link" data-client-derived-refresh="" disabled={basis.status === "refreshing" || Boolean(pending)} onClick={load}>Refresh measurements</button> : null}
      {notice ? <div className={`alert alert-${notice.kind} py-2`} data-client-derived-notice={notice.kind}>{notice.text}</div> : null}
      {calculationJob ? <div className="text-muted" data-client-derived-calculation-job={calculationJob.job_state}>
        Exact-period calculation: {calculationJob.job_state.replace(/_/g, " ")}.
      </div> : null}

      {data?.paired?.available ? (
        <div className="mb-2" data-client-derived-paired="">
          <div className="fw-semibold">Calculated baseline/follow-up results</div>
          <div className="text-muted">These comparisons use all survey dates. They do not apply the Project reporting period.</div>
          {data.paired.measurements.map((item) => (
            <div key={item.outcome_field_key} data-client-derived-paired-field={item.outcome_field_key}>
              {item.source_heading_suggestion ? <div className="fw-semibold" data-client-derived-preview-heading="">{item.source_heading_suggestion.suggested_label} <span className="fw-normal text-muted">(from the column heading)</span></div> : null}
              {item.available
                ? `Numeric outcome ${item.outcome_field_key} (column ${item.outcome_column}): ${item.numerator} of ${item.denominator} comparable pairs (${item.percentage}%) have a numerically higher follow-up value; whether higher is better is not established.`
                : `${item.outcome_field_key || "A field"}: ${item.blockers?.[0]?.message || "cannot be measured."}`}
              {item.available ? <div className="text-muted">{item.component_counts.unchanged_count} unchanged; {item.component_counts.decreased_count} lower; {item.component_counts.excluded_participant_count} excluded because their observations cannot be compared. No user-entered definition is needed to calculate these numbers.</div> : null}
            </div>
          ))}
          <button type="button" className="btn btn-sm btn-outline-primary mt-1" disabled={basis.status !== "success" || Boolean(pending) || !data.paired.measurements.some((item) => item.available)} data-client-derived-record-paired=""
            onClick={() => send("paired", pairedOutcomeMeasurementsPath(organizationId, sourceVersionId, worksheetKey || null), {},
              (recorded) => `${recorded.measurements.length} proposed results kept as evidence.`)}>
            {pending === "paired" ? "Keeping..." : "Keep these results as evidence"}
          </button>
        </div>
      ) : null}

      {data?.paired && !data.paired.available ? (
        <div data-client-derived-paired-unavailable="">
          {data.paired.proposed_pairings?.length ? "Choose a baseline/follow-up mapping: " : "Paired outcome unavailable: "}
          {data.paired.blockers?.map((blocker) => `${blocker.message} ${blocker.required_fix || ""}`).join(" ")}
          {data.paired.proposed_pairings?.length ? <div>
            <label>Participant and observation fields
              <select className="form-select form-select-sm" data-client-derived-pairing-select="" disabled={Boolean(pending)} value={pairingChoice} onChange={(event) => setPairingChoice(event.target.value)}>
                <option value="">Choose the intended mapping</option>
                {data.paired.proposed_pairings.map((pairing) => <option key={JSON.stringify(pairing)} value={JSON.stringify(pairing)}>
                  Participant {pairing.participant_field_key}; baseline/follow-up stage {pairing.stage_field_key}; instrument version {pairing.instrument_version_field_key || "not used"}
                </option>)}
              </select>
            </label>
            <button type="button" className="btn btn-sm btn-outline-primary" data-client-derived-record-selected-pairing=""
              disabled={Boolean(pending) || basis.status !== "success" || !data.paired.proposed_pairings.some((pairing) => JSON.stringify(pairing) === pairingChoice)}
              onClick={() => send("paired", pairedOutcomeMeasurementsPath(organizationId, sourceVersionId, worksheetKey || null), { pairing: JSON.parse(pairingChoice) },
                (recorded) => `${recorded.measurements.length} selected paired results kept as evidence; numerical change does not establish improvement.`)}>
              Calculate and keep selected pairing
            </button>
          </div> : null}
        </div>
      ) : null}
      {data?.tabular && !data.tabular.available ? (
        <div data-client-derived-tabular-unavailable="">Field measurement unavailable: {data.tabular.blockers?.map((blocker) => `${blocker.message} ${blocker.required_fix || ""}`).join(" ") || TABULAR_UNAVAILABLE_MESSAGES[data.tabular.reason] || "The committed profile has no supported field measurements. Use Count records if available."}</div>
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
          {form.operation === "rate" ? <div className="text-muted" data-client-derived-rate-scope="">
            Rates count records (duplicates included), or each identifier value once: an identifier is in the numerator when at least one of its records has the numerator value (on a record that also has the population value, when one is chosen). With a date field, the Project reporting period limits the measured population to records dated in (or outside) it; records without a date are excluded and stated.
          </div> : null}
          <div className="text-muted" data-client-derived-date-support="">
            Date filters apply the Project period's actual dates to recognized dates: ISO date text, and Excel cells formatted as dates (read with the workbook's own 1900 or 1904 date system). Plain numbers are never read as dates. Files profiled before Excel date cells were recognized need a new intake version.
          </div>
          <label className="d-block">
            {form.operation === "rate" ? "Rate counted in" : "Count each"}
            {select("identifierFieldKey", byRole("identifier").map((field) => <option key={field.field_key} value={field.field_key}>{`${fieldLabel(field)} value once`}</option>), form.operation === "rate" ? "records" : "record")}
          </label>
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
          ) : null}
          <div className="d-flex flex-wrap gap-2">
            <label>
              {form.operation === "rate" ? "Date field limiting the measured population to the reporting period" : "Date field for the reporting period"}
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
          {form.periodFieldKey ? (
            <div data-client-derived-period-context="">
              {!data.reporting_period ? <div className="text-warning" data-client-derived-no-period="">{projectPeriodProblem(data.reporting_period_context)}</div>
                : <div> KAI Project reporting period: {data.reporting_period.start} to {data.reporting_period.end}.</div>}
              {data.period_month_coverage?.partially_covered_months?.length ? <div data-client-derived-partial-months="">
                The period covers {data.period_month_coverage.partially_covered_months.join(" and ")} only in part. KAI applies the actual dates exactly: from its month counts when none of the records a calculation reads fall in {data.period_month_coverage.partially_covered_months.length === 1 ? "that month" : "those months"}, otherwise by recalculating from the verified uploaded file (it takes a moment).
              </div> : null}
              <div>Choose “no period (all dates)” above for a supported calculation without date filtering. Your field selections will remain.</div>
              {data.reporting_period_context?.engagement_id ? <ProjectReportingPeriodEditor organizationId={organizationId}
                engagementId={data.reporting_period_context.engagement_id} onSaved={load} /> : null}
            </div>
          ) : null}
          <div className="d-flex flex-wrap gap-2 mt-1">
            <label>
              Meaning (optional): indicator label
              <input className="form-control form-control-sm" value={meaning.indicatorLabel} disabled={Boolean(pending)} data-client-derived-meaning="indicatorLabel"
                onChange={(event) => setMeaning((current) => ({ ...current, indicatorLabel: event.target.value }))} />
            </label>
            <label>
              What it represents
              <input className="form-control form-control-sm" value={meaning.meaningText} disabled={Boolean(pending)} data-client-derived-meaning="meaningText"
                onChange={(event) => setMeaning((current) => ({ ...current, meaningText: event.target.value }))} />
            </label>
            <label>
              Where the values come from
              <select className="form-select form-select-sm" value={meaning.evidenceBasis} disabled={Boolean(pending)} data-client-derived-meaning="evidenceBasis"
                onChange={(event) => setMeaning((current) => ({ ...current, evidenceBasis: event.target.value }))}>
                <option value="not_established">not stated</option>
                <option value="self_reported">self-reported by the people recorded</option>
                <option value="organization_record">the organization's own records</option>
              </select>
            </label>
          </div>
          {meaningProblem ? <button type="button" className="btn btn-sm btn-link" data-client-derived-clear-meaning="" disabled={Boolean(pending)} onClick={() => setMeaning(EMPTY_INTERPRETATION_FORM)}>Clear optional meaning</button> : null}
          {problem ? <div data-client-derived-problem="">{problem}</div> : null}
          <button type="submit" className="btn btn-sm btn-primary mt-1" disabled={Boolean(problem) || Boolean(pending)} data-client-derived-record-tabular="">
            {pending === "tabular" ? "Calculating..." : "Calculate and record"}
          </button>
        </form>
      ) : null}
      {data?.tabular?.available ? (
        <ClientCrossSourceMeasurementSection organizationId={organizationId} sourceVersionId={sourceVersionId} eventsWorksheetKey={data.tabular.sheetKey || null}
          eventsBasis={data} eventsBasisCurrent={basis.status === "success"}
          onPeriodSaved={load} linkableVersions={linkableVersions} versionsById={versionsById} earlierVersionIds={earlierVersionIds}
          onReconciled={() => { onRecorded?.(); load(); }} />
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
              {measurementFamilyLabel(recorded.measurement_family)}{linked ? ` - ${crossSourceMetricLabel(recorded.definition)}` : ""}: {linked ? crossSourceHeadlineValue(recorded) : recorded.measured_value}{recorded.percentage ? ` (${recorded.percentage}%)` : ""}
            </div>
            {linked ? <CrossSourceActivityDetail entry={recorded} /> : null}
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
            {current?.statement ? <div data-client-derived-evidence-statement="">{current.statement}</div> : null}
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
              aria-expanded={clarifying === recorded.source_derived_measurement_id}
              onClick={() => { setClarifying(clarifying === recorded.source_derived_measurement_id ? null : recorded.source_derived_measurement_id); setClarifyForm(interpretationFormFrom(current?.interpretation)); }}>
              {current?.interpretation ? "Change meaning" : "Clarify meaning"}
            </button>
            {clarifying === recorded.source_derived_measurement_id ? (
              <MeaningQuestionsForm attr="data-client-derived-clarify" form={clarifyForm} setForm={setClarifyForm}
                initial={interpretationFormFrom(current?.interpretation)} paired={paired} known={recordedMeasurementKnownLines(recorded)}
                suggestion={paired ? sourceHeadingSuggestionOf(recorded.source_heading_suggestion) : null}
                pending={pending === "clarify"} onSubmit={(event) => clarify(event, recorded)}
                onCancel={() => { setClarifying(null); setClarifyForm(interpretationFormFrom(current?.interpretation)); }} />
            ) : null}
            {recorded.target_comparison ? <div data-client-derived-target-comparison={recorded.target_comparison.met ? "met" : "not_met"}>{recorded.target_comparison.text}</div> : null}
            <form className="d-flex flex-wrap gap-1 align-items-end mt-1" data-client-derived-target-form={recorded.source_derived_measurement_id}
              onSubmit={(event) => setTarget(event, recorded)}>
              <label>
                Planned target{measurementTargetUnit(recorded.measurement_family) === "percent" ? " (%)" : ""}
                <input className="form-control form-control-sm" inputMode="decimal" disabled={Boolean(pending)} data-client-derived-target-value=""
                  value={targetDrafts[recorded.source_derived_measurement_id]?.value ?? recorded.target?.target_value?.replace(/\.00$/, "") ?? ""}
                  onChange={(event) => setTargetDraft(recorded, { value: event.target.value })} />
              </label>
              <select className="form-select form-select-sm w-auto" disabled={Boolean(pending)} data-client-derived-target-comparison-select=""
                value={targetDrafts[recorded.source_derived_measurement_id]?.comparison ?? recorded.target?.comparison ?? "at_least"}
                onChange={(event) => setTargetDraft(recorded, { comparison: event.target.value })}>
                <option value="at_least">at least</option>
                <option value="at_most">at most</option>
              </select>
              <button type="submit" className="btn btn-sm btn-outline-secondary" disabled={Boolean(pending)} data-client-derived-set-target={recorded.source_derived_measurement_id}>
                {recorded.target ? "Change target" : "Set target"}
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
