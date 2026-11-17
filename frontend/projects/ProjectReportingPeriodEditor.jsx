import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { BASE_PATH, errorText, getJson } from "../impactEvidenceLibraryLogic.js";
import { isCalendarDate } from "../../shared/kaiProjectReportingPeriod.js";
import ProjectReportingContext from "./ProjectReportingContext.js";

export default function ProjectReportingPeriodEditor({ organizationId, engagementId, canEdit, onSaved }) {
  const context = useContext(ProjectReportingContext);
  const writable = canEdit ?? context.canEdit;
  const [state, setState] = useState(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const draftDirty = useRef(false);
  const draftRevision = useRef(null);
  const [draftChangedElsewhere, setDraftChangedElsewhere] = useState(false);
  const path = `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/engagements/${encodeURIComponent(engagementId)}/reporting-period`;
  const load = useCallback(async ({ preserveDraft = true, rebaseDraft = false } = {}) => {
    const seq = ++sequence.current;
    setState(null);
    try {
      const result = await getJson(path);
      if (sequence.current !== seq) return false;
      if (result.statusCode === 200 && result.body?.ok) {
        setState(result.body.data);
        if (preserveDraft && draftDirty.current) {
          setDraftChangedElsewhere(!rebaseDraft && draftRevision.current !== result.body.data.target_revision);
          if (rebaseDraft) draftRevision.current = result.body.data.target_revision;
        } else {
          setStart(result.body.data.start);
          setEnd(result.body.data.end);
          draftRevision.current = result.body.data.target_revision;
          draftDirty.current = false;
          setDraftChangedElsewhere(false);
        }
        return true;
      }
      setState({ status: "error" });
      setNotice(errorText(result));
    } catch {
      if (sequence.current === seq) {
        setState({ status: "error" });
        setNotice("The Project reporting period could not be loaded. Retry.");
      }
    }
    return false;
  }, [path]);
  useEffect(() => { draftDirty.current = false; setNotice(""); load({ preserveDraft: false }); return () => { sequence.current += 1; }; }, [load]);
  const lastRevision = useRef(context.revision);
  useEffect(() => {
    if (lastRevision.current === context.revision) return;
    lastRevision.current = context.revision;
    load({ preserveDraft: true });
  }, [context.revision, load]);
  const valid = isCalendarDate(start) && isCalendarDate(end) && start <= end;
  const save = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!valid || !state?.target_revision || pending || !writable) return;
    setPending(true);
    setNotice("");
    try {
      const response = await fetch(path, { method: "PATCH", credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ start, end, expected_target_revision: draftRevision.current }) });
      const result = { statusCode: response.status, body: await response.json() };
      if (response.ok && result.body?.ok) {
        const reread = await load({ preserveDraft: false });
        let refreshFailed = false;
        try { await context.refresh(); } catch { refreshFailed = true; }
        try { await onSaved?.(); } catch { refreshFailed = true; }
        setNotice((reread ? "Project reporting period saved and reread." : "The period was saved, but current values could not be reread. Reload current period to verify.")
          + (refreshFailed ? " Some affected views could not refresh. Retry their reads to display the saved period." : ""));
      } else if (response.status === 409) {
        const reread = await load({ preserveDraft: true, rebaseDraft: true });
        setNotice(reread ? "The Project target changed while you were editing. Current dates have been reloaded above; your edited dates are kept. Review them before retrying, or use the current dates."
          : "The Project target changed while you were editing. Current dates could not be loaded. Reload current period before retrying.");
      } else setNotice(errorText(result));
    } catch { setNotice("The reporting period could not be saved or reread. Reload the current values before retrying."); }
    finally { setPending(false); }
  };
  return (
    <div data-project-reporting-period={engagementId} className="small border rounded p-2 my-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === "Enter" && event.target.tagName === "INPUT") { event.preventDefault(); event.stopPropagation(); if (writable) save(event); }
    }}>
      <div className="fw-semibold">KAI Project reporting period</div>
      <div data-project-period-current="">{state?.status === "recorded" ? `${state.start} to ${state.end}`
        : state?.status === "invalid" ? "Incomplete or invalid dates recorded. Correct both dates."
          : state?.status === "error" ? "Current period could not be loaded" : state ? "Not recorded" : "Loading current period…"}</div>
      <div className="text-muted">Used for supported date-filtered field measurements. Count records does not filter rows by these dates.</div>
      {writable ? (
        <div role="group" aria-label="Edit KAI Project reporting period">
          <label>Period start<input aria-label="KAI Project period start" data-project-period-start="" type="date" className="form-control form-control-sm" value={start} disabled={pending} onChange={(event) => { draftDirty.current = true; setStart(event.target.value); }} /></label>{" "}
          <label>Period end<input aria-label="KAI Project period end" data-project-period-end="" type="date" className="form-control form-control-sm" value={end} disabled={pending} onChange={(event) => { draftDirty.current = true; setEnd(event.target.value); }} /></label>{" "}
          <button type="button" onClick={save} className="btn btn-sm btn-primary" data-project-period-save="" disabled={!valid || !state?.target_revision || pending}>{pending ? "Saving…" : "Save Project period"}</button>
          {!valid && (start || end) ? <div role="alert">Enter both real calendar dates, with the end on or after the start.</div> : null}
        </div>
      ) : <div>Your organization administrator can set or correct both dates in Projects.</div>}
      {draftChangedElsewhere ? <div role="status" data-project-period-draft-stale="">The Project target changed elsewhere. Your unsaved dates are kept. Saving checks the version you edited; review the current period above.</div> : null}
      {draftDirty.current && state?.target_revision ? <button type="button" className="btn btn-sm btn-link" data-project-period-use-current="" disabled={pending} onClick={() => {
        setStart(state.start); setEnd(state.end); draftRevision.current = state.target_revision; draftDirty.current = false; setDraftChangedElsewhere(false); setNotice("");
      }}>Use current dates</button> : null}
      <button type="button" className="btn btn-sm btn-link" data-project-period-reload="" disabled={pending} onClick={() => load({ preserveDraft: true })}>Reload current period</button>
      {notice ? <div role="status" data-project-period-notice="">{notice}</div> : null}
    </div>
  );
}
