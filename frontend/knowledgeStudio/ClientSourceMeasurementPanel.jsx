import React, { useCallback, useEffect, useRef, useState } from "react";

import { claimProposalPath, errorText, getJson, postJson } from "../impactEvidenceLibraryLogic.js";
import { claimProposalResultMessage } from "./clientEvidenceWorkflowLogic.js";
import {
  EMPTY_MEASUREMENT_FORM,
  MEASUREMENT_FORM_READINESS_MESSAGES,
  measurementDefinitionBody,
  measurementFailureMessage,
  measurementFormReadiness,
  projectMeasurementBasis,
  sourceRecordCountMeasurementPath,
} from "./clientSourceMeasurementLogic.js";

const FIELDS = Object.freeze([
  ["countedUnit", "What one record represents", "e.g. programme session"],
  ["unitLabel", "Unit label for the count", "e.g. programme sessions"],
  ["definitionText", "Definition", "e.g. Each row of the session log records one delivered programme session."],
  ["inclusionRule", "Which records count", "e.g. Every data row after the header row that has at least one value."],
  ["exclusionRule", "Which records do not count", "e.g. The header row and empty rows."],
]);

/**
 * Record what one source record represents (P2-01M, Plan A Prompt 8), for one
 * current source version, opened from the Data Sources list only when the
 * server reports recordSourceMeasurement. Shows the server's profile counts
 * and counted value, takes the organization's own definition, submits it
 * through the existing measurement route, and then shows what was recorded,
 * its limitations, and the claim step that follows. A recorded definition is
 * immutable: a conflicting one is refused and the recorded one is shown.
 */
export default function ClientSourceMeasurementPanel({ organizationId, sourceVersionId, canProposeClaim, onClose, onRecorded }) {
  const [basis, setBasis] = useState({ status: "loading", data: null, error: "" });
  const [form, setForm] = useState(EMPTY_MEASUREMENT_FORM);
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    seqRef.current += 1;
    const seq = seqRef.current;
    const result = await getJson(sourceRecordCountMeasurementPath(organizationId, sourceVersionId));
    if (seqRef.current !== seq) return;
    const data = result.statusCode === 200 && result.body?.ok ? projectMeasurementBasis(result.body.data) : null;
    setBasis(data ? { status: "success", data, error: "" } : { status: "error", data: null, error: measurementFailureMessage(result) });
  }, [organizationId, sourceVersionId]);
  useEffect(() => { load(); }, [load]);

  const readiness = measurementFormReadiness(form);
  const submit = async () => {
    if (!readiness.ready) return;
    setPending("record");
    setNotice(null);
    const result = await postJson(sourceRecordCountMeasurementPath(organizationId, sourceVersionId), measurementDefinitionBody(form));
    setPending("");
    if ((result.statusCode !== 200 && result.statusCode !== 201) || !result.body?.ok) {
      setNotice({ kind: "warning", text: measurementFailureMessage(result) });
      load();
      return;
    }
    setNotice({ kind: "success", text: result.body.data.replayed ? "This definition was already recorded." : "Definition and measurement recorded." });
    onRecorded?.();
    load();
  };
  const proposeClaim = async (evidenceItemId) => {
    setPending("propose");
    setNotice(null);
    const result = await postJson(claimProposalPath(organizationId, evidenceItemId), {});
    setPending("");
    if ((result.statusCode !== 200 && result.statusCode !== 201) || !result.body?.ok) {
      setNotice({ kind: "warning", text: errorText(result) });
      return;
    }
    setNotice({ kind: "success", text: claimProposalResultMessage(result.body.data) });
    onRecorded?.();
    load();
  };

  const data = basis.data;
  const recorded = data?.recorded;
  return (
    <div className="border rounded p-2 mt-2" data-client-source-measurement={sourceVersionId}>
      <div className="d-flex align-items-center mb-2">
        <h6 className="mb-0">Count the records in this source</h6>
        <button type="button" className="btn btn-sm btn-link ms-auto" onClick={onClose}>Close</button>
      </div>
      {basis.status === "loading" ? <div className="text-muted small">Loading the source's counts...</div> : null}
      {basis.status === "error" ? <div className="alert alert-warning py-2 small" data-client-source-measurement-error="">{basis.error}</div> : null}
      {notice ? <div className={`alert alert-${notice.kind} py-2 small`} data-client-source-measurement-notice={notice.kind}>{notice.text}</div> : null}
      {data && !data.counts.measurable ? (
        <div className="small" data-client-source-measurement-unmeasurable="">
          This source version cannot be counted this way. {data.counts.reasons.join(" ")}
        </div>
      ) : null}
      {data && data.counts.measurable ? (
        <div className="small mb-2" data-client-source-measurement-counts="">
          {data.counts.worksheet ? (
            <div data-client-source-measurement-worksheet={data.counts.worksheet}>
              Excel workbook: the rows of its only worksheet, with its first row as the header row.
            </div>
          ) : null}
          <div>Data records after the header row: <strong>{data.counts.dataRecordCount}</strong></div>
          <div>Blank records (not counted): <strong>{data.counts.blankRecordCount}</strong></div>
          <div>Exact-duplicate records (still counted): <strong>{data.counts.duplicateRecordCount}</strong></div>
          <div className="mt-1" data-client-source-measurement-calculation="">
            Counted records = data records minus blank records = <strong data-client-source-measurement-counted="">{data.counts.countedRecordCount}</strong>.
            Exact duplicates stay included; KAI does not decide whether they are repeats.
          </div>
        </div>
      ) : null}
      {recorded ? (
        <div className="small" data-client-source-measurement-recorded="">
          <div className="fw-semibold">Recorded definition</div>
          <div>One record is one {recorded.definition.countedUnit}: {recorded.definition.definitionText}</div>
          <div>Counts: {recorded.definition.inclusionRule} Excludes: {recorded.definition.exclusionRule}</div>
          <div data-client-source-measurement-period="">
            {recorded.definition.periodStart
              ? `Reporting period ${recorded.definition.periodStart} to ${recorded.definition.periodEnd}, as stated by your organization (not verified against dates in the records).`
              : "No reporting period was defined."}
          </div>
          {recorded.measurement ? (
            <div className="mt-1" data-client-source-measurement-value={recorded.measurement.measuredValue}>
              Measurement: <strong>{recorded.measurement.measuredValue} {recorded.measurement.unitLabel}</strong>.
            </div>
          ) : null}
          {recorded.limitations.length > 0 ? (
            <ul className="mb-1 mt-1" data-client-source-measurement-limitations="">
              {recorded.limitations.map((entry) => <li key={entry.code} data-client-source-measurement-limitation={entry.code}>{entry.description}</li>)}
            </ul>
          ) : null}
          {recorded.claim ? (
            <div className="mt-1" data-client-source-measurement-claim={recorded.claim.claimId}>
              Claim: {recorded.claim.statement} <span className="text-muted">(status: {recorded.claim.claimStatus}; review: {recorded.claim.claimReviewStatus})</span>
              <div className="text-muted">Check current internal-use eligibility under Claims for internal drafts. Review requirements depend on the source and claim.</div>
            </div>
          ) : null}
          {!recorded.claim && recorded.measurement && canProposeClaim ? (
            <button type="button" className="btn btn-sm btn-outline-primary mt-1" disabled={Boolean(pending)}
              data-client-source-measurement-propose-claim={recorded.measurement.evidenceItemId}
              onClick={() => proposeClaim(recorded.measurement.evidenceItemId)}>
              {pending === "propose" ? "Proposing..." : "Propose a claim from this measurement"}
            </button>
          ) : null}
        </div>
      ) : null}
      {data && data.counts.measurable && !recorded && data.isCurrent ? (
        <form className="small" onSubmit={(event) => { event.preventDefault(); submit(); }} data-client-source-measurement-form="">
          <div className="text-muted mb-1">
            Only your organization can say what one record represents. KAI counts the records; it does not infer their meaning.
          </div>
          {FIELDS.map(([key, label, placeholder]) => (
            <label key={key} className="d-block mb-1">
              {label}
              <input className="form-control form-control-sm" value={form[key]} placeholder={placeholder} data-client-source-measurement-field={key}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />
            </label>
          ))}
          <div className="d-flex flex-wrap gap-2">
            <label>
              Reporting period start (optional)
              <input type="date" className="form-control form-control-sm" value={form.periodStart} data-client-source-measurement-field="periodStart"
                onChange={(event) => setForm((current) => ({ ...current, periodStart: event.target.value }))} />
            </label>
            <label>
              Reporting period end
              <input type="date" className="form-control form-control-sm" value={form.periodEnd} data-client-source-measurement-field="periodEnd"
                onChange={(event) => setForm((current) => ({ ...current, periodEnd: event.target.value }))} />
            </label>
          </div>
          {form.periodStart || form.periodEnd ? (
            <label className="form-check mt-1">
              <input type="checkbox" className="form-check-input" checked={form.periodAttested} data-client-source-measurement-field="periodAttested"
                onChange={(event) => setForm((current) => ({ ...current, periodAttested: event.target.checked }))} />
              <span className="form-check-label">
                This period is my organization's statement. I understand KAI records it as attested and does not verify it against
                dates in the records.
              </span>
            </label>
          ) : null}
          {!readiness.ready ? <div className="mt-1" data-client-source-measurement-readiness={readiness.reason}>{MEASUREMENT_FORM_READINESS_MESSAGES[readiness.reason]}</div> : null}
          <button type="submit" className="btn btn-sm btn-primary mt-2" disabled={!readiness.ready || Boolean(pending)} data-client-source-measurement-submit="">
            {pending === "record" ? "Recording..." : "Record definition and count"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
