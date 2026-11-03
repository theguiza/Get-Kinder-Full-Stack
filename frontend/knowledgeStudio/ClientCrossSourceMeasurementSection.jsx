import React, { useCallback, useEffect, useRef, useState } from "react";

import { errorText, getJson, postJson } from "../impactEvidenceLibraryLogic.js";
import {
  EMPTY_CROSS_SOURCE_FORM,
  crossSourceFormProblem,
  crossSourceMeasurementsPath,
  crossSourceMetricLabel,
  crossSourceReconciliationJobPath,
  crossSourceReconciliationJobsPath,
  crossSourceRequestBody,
  derivedMeasurementBasisPath,
  reconciliationJobSettled,
  reconciliationJobStateText,
} from "./clientDerivedMeasurementLogic.js";

const POLL_INTERVAL_MS = 1000;
const ROLE_LABELS = Object.freeze({ identifier: "identifier", categorical: "category", date: "date" });

function fieldOption(field) {
  const withheld = field.vocabulary_withheld ? ", values withheld" : "";
  return <option key={field.field_key} value={field.field_key}>{`Column ${field.column_position} (${field.field_key}, ${ROLE_LABELS[field.role] || field.role}${withheld})`}</option>;
}

/**
 * Cross-source linked reach from this service-event source version and a
 * participant register version, inside the Count records panel. The person
 * chooses the other current CSV version and confirms what each listed field
 * means; the fields and values are the ones KAI lists for both committed
 * profiles, and the reporting period is the engagement's recorded one. The
 * request is queued: KAI's reconciliation worker reads both files, and this
 * section shows the job until it settles, then hands back to the recorded
 * measurements (meaning, limitations, claim proposal). Nothing here reads a
 * record or calculates a number.
 */
export default function ClientCrossSourceMeasurementSection({ organizationId, sourceVersionId, eventsBasis, linkableVersions, versionsById, onReconciled }) {
  const [form, setForm] = useState(EMPTY_CROSS_SOURCE_FORM);
  const [register, setRegister] = useState({ status: "idle", data: null, error: "" });
  const [job, setJob] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);
  const timerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, []);

  const loadJobs = useCallback(async () => {
    const result = await getJson(crossSourceReconciliationJobsPath(organizationId));
    if (!mountedRef.current) return;
    if (result.statusCode === 200 && result.body?.ok) {
      setJobs(result.body.data.reconciliationJobs.filter((entry) => entry.primary_source_version_id === sourceVersionId));
    }
  }, [organizationId, sourceVersionId]);
  useEffect(() => { loadJobs(); }, [loadJobs]);

  // The register's committed fields, read through the same basis route.
  useEffect(() => {
    if (!form.referenceSourceVersionId) {
      setRegister({ status: "idle", data: null, error: "" });
      return;
    }
    let active = true;
    setRegister({ status: "loading", data: null, error: "" });
    (async () => {
      const result = await getJson(derivedMeasurementBasisPath(organizationId, form.referenceSourceVersionId, null));
      if (!active || !mountedRef.current) return;
      setRegister(result.statusCode === 200 && result.body?.ok
        ? { status: "success", data: result.body.data, error: "" }
        : { status: "error", data: null, error: errorText(result) });
    })();
    return () => { active = false; };
  }, [organizationId, form.referenceSourceVersionId]);

  const poll = useCallback(async (reconciliationJobId) => {
    const result = await getJson(crossSourceReconciliationJobPath(organizationId, reconciliationJobId));
    if (!mountedRef.current) return;
    if (result.statusCode !== 200 || !result.body?.ok) {
      setNotice({ kind: "warning", text: errorText(result) });
      return;
    }
    const read = result.body.data.reconciliationJob;
    setJob({ ...read, measurements: result.body.data.measurements });
    if (reconciliationJobSettled(read)) {
      loadJobs();
      if (read.job_state === "succeeded") onReconciled?.();
      return;
    }
    timerRef.current = setTimeout(() => poll(reconciliationJobId), POLL_INTERVAL_MS);
  }, [organizationId, loadJobs, onReconciled]);

  const eventFields = eventsBasis?.tabular?.available ? eventsBasis.tabular.fields : [];
  const registerFields = register.data?.tabular?.available ? register.data.tabular.fields : [];
  const byRole = (list, role) => list.filter((field) => field.role === role);
  const statusValues = eventFields.find((field) => field.field_key === form.statusFieldKey)?.values || [];
  const groupFields = byRole(eventFields, "categorical").filter((field) => !field.vocabulary_withheld && (field.values || []).length > 0);
  const problem = crossSourceFormProblem(form, { reportingPeriodRecorded: Boolean(eventsBasis?.reporting_period) });

  const setField = (key) => (event) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value, ...(key === "statusFieldKey" ? { completedValueKey: "" } : {}), ...(key === "referenceSourceVersionId" ? { registerParticipantFieldKey: "" } : {}) }));
  };
  const select = (key, options, placeholder) => (
    <select className="form-select form-select-sm" value={form[key]} onChange={setField(key)} data-client-cross-source-field={key}>
      <option value="">{placeholder}</option>
      {options}
    </select>
  );

  const submit = async (event) => {
    event.preventDefault();
    if (problem || pending) return;
    setPending(true);
    setNotice(null);
    clearTimeout(timerRef.current);
    let result;
    try {
      result = await postJson(crossSourceMeasurementsPath(organizationId), crossSourceRequestBody(form, sourceVersionId));
    } finally {
      if (mountedRef.current) setPending(false);
    }
    if (!mountedRef.current) return;
    if (result.statusCode !== 202 || !result.body?.ok) {
      setNotice({ kind: "warning", text: errorText(result) });
      return;
    }
    const queued = result.body.data.reconciliationJob;
    setJob({ ...queued, measurements: [] });
    loadJobs();
    if (reconciliationJobSettled(queued)) {
      poll(queued.reconciliation_job_id);
    } else {
      timerRef.current = setTimeout(() => poll(queued.reconciliation_job_id), POLL_INTERVAL_MS);
    }
  };

  const versionText = (id) => {
    const version = versionsById?.get(id);
    if (!version) return id;
    return `${version.safeFilename || id} (${version.isCurrent ? "current version" : "earlier version, replaced"})`;
  };

  return (
    <div className="border-top pt-2 mt-2" data-client-cross-source={sourceVersionId}>
      <h6 className="mb-1">Link to a participant register</h6>
      <div className="text-muted mb-1">
        Count eligible service encounters and the distinct registered people they reached by linking this service-event source
        version to a participant register. Choose the fields KAI lists; KAI reads both files in its reconciliation worker and keeps
        counts only.
      </div>
      {linkableVersions.length === 0 ? (
        <div className="text-muted" data-client-cross-source-none="">No other current CSV source version can be linked.</div>
      ) : (
        <form onSubmit={submit} data-client-cross-source-form="">
          <label className="d-block">
            Participant register source version
            {select("referenceSourceVersionId", linkableVersions.map((version) => (
              <option key={version.sourceVersionId} value={version.sourceVersionId}>{version.safeFilename || version.sourceVersionId}</option>
            )), "choose a source version")}
          </label>
          <div className="d-flex flex-wrap gap-2">
            <label>Event identifier{select("eventIdentifierFieldKey", byRole(eventFields, "identifier").map(fieldOption), "choose a field")}</label>
            <label>Participant identifier{select("participantIdentifierFieldKey", byRole(eventFields, "identifier").map(fieldOption), "choose a field")}</label>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <label>Status field{select("statusFieldKey", byRole(eventFields, "categorical").map(fieldOption), "choose a field")}</label>
            {form.statusFieldKey ? (
              <label>
                Completed service is
                {select("completedValueKey", statusValues.map((value) => <option key={value.value_key} value={value.value_key}>{`${value.label} (${value.record_count})`}</option>), "choose a value")}
              </label>
            ) : null}
          </div>
          <div className="d-flex flex-wrap gap-2">
            <label>Service date{select("dateFieldKey", byRole(eventFields, "date").map(fieldOption), "choose a field")}</label>
            <label>Programme (optional){select("groupFieldKey", groupFields.map(fieldOption), "no grouping")}</label>
          </div>
          {register.status === "loading" ? <div className="text-muted">Loading the register's fields...</div> : null}
          {register.status === "error" ? <div className="alert alert-warning py-2" data-client-cross-source-register-error="">{register.error}</div> : null}
          {register.status === "success" ? (
            <label className="d-block">
              Register participant identifier
              {select("registerParticipantFieldKey", byRole(registerFields, "identifier").map(fieldOption), "choose a field")}
            </label>
          ) : null}
          <div className="text-muted" data-client-cross-source-period="">
            {eventsBasis?.reporting_period
              ? `Reporting period: ${eventsBasis.reporting_period.start} to ${eventsBasis.reporting_period.end} (the engagement's recorded period, applied by service date).`
              : "This source's engagement has no recorded reporting period yet."}
          </div>
          {problem ? <div data-client-cross-source-problem="">{problem}</div> : null}
          <button type="submit" className="btn btn-sm btn-primary mt-1" disabled={Boolean(problem) || pending} data-client-cross-source-submit="">
            {pending ? "Requesting..." : "Reconcile and record"}
          </button>
        </form>
      )}
      {notice ? <div className={`alert alert-${notice.kind} py-2 mt-1`} data-client-cross-source-notice={notice.kind}>{notice.text}</div> : null}
      {job ? (
        <div className="border rounded p-2 mt-1" data-client-cross-source-job={job.reconciliation_job_id} data-client-cross-source-job-state={job.job_state}>
          <div>{reconciliationJobStateText(job)}</div>
          {job.error_code ? <div className="text-muted" data-client-cross-source-job-error={job.error_code}>Reason: {job.error_code.replace(/_/g, " ")}.</div> : null}
          {(job.measurements || []).map((entry) => (
            <div key={entry.source_derived_measurement_id} data-client-cross-source-result={entry.definition?.metric}>
              {crossSourceMetricLabel(entry.definition)}: {entry.measured_value}
            </div>
          ))}
          {job.measurements?.length ? (
            <div className="text-muted" data-client-cross-source-exclusions="">
              Excluded and counted: {job.measurements[0].component_counts.excess_copy_record_count} duplicate copies,{" "}
              {job.measurements[0].component_counts.completed_outside_period_count} completed outside the period,{" "}
              {job.measurements[0].component_counts.unmatched_event_count} with no register match,{" "}
              {job.measurements[0].component_counts.conflicting_event_identity_count} conflicting event identities.
              Register: {job.measurements[0].component_counts.register_distinct_identifier_count} distinct registered participants.
            </div>
          ) : null}
        </div>
      ) : null}
      {jobs.length > 0 ? (
        <div className="mt-1" data-client-cross-source-history="">
          <div className="fw-semibold">Reconciliations of this source version</div>
          {jobs.map((entry) => (
            <div key={entry.reconciliation_job_id} className="text-muted" data-client-cross-source-history-job={entry.reconciliation_job_id}>
              {entry.job_state.replace(/_/g, " ")}: register {versionText(entry.reference_source_version_id)}
              {entry.error_code ? `, ${entry.error_code.replace(/_/g, " ")}` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
