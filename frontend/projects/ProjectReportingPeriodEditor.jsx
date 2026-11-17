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
  const path = `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/engagements/${encodeURIComponent(engagementId)}/reporting-period`;
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    setState(null);
    try {
      const result = await getJson(path);
      if (sequence.current !== seq) return false;
      if (result.statusCode === 200 && result.body?.ok) {
        setState(result.body.data);
        setStart(result.body.data.start);
        setEnd(result.body.data.end);
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
  useEffect(() => { setNotice(""); load(); return () => { sequence.current += 1; }; }, [load]);
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
        body: JSON.stringify({ start, end, expected_target_revision: state.target_revision }) });
      const result = { statusCode: response.status, body: await response.json() };
      if (response.ok && result.body?.ok) {
        const reread = await load();
        await context.refresh();
        await onSaved?.();
        setNotice(reread ? "Project reporting period saved and reread." : "The period was saved, but current values could not be reread. Reload current period to verify.");
      } else if (response.status === 409) {
        const reread = await load();
        setNotice(reread ? "The Project target changed while you were editing. Current dates have been reloaded. Check them and retry your correction."
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
          <label>Period start<input aria-label="KAI Project period start" data-project-period-start="" type="date" className="form-control form-control-sm" value={start} onChange={(event) => setStart(event.target.value)} /></label>{" "}
          <label>Period end<input aria-label="KAI Project period end" data-project-period-end="" type="date" className="form-control form-control-sm" value={end} onChange={(event) => setEnd(event.target.value)} /></label>{" "}
          <button type="button" onClick={save} className="btn btn-sm btn-primary" data-project-period-save="" disabled={!valid || !state?.target_revision || pending}>{pending ? "Saving…" : "Save Project period"}</button>
          {!valid && (start || end) ? <div role="alert">Enter both real calendar dates, with the end on or after the start.</div> : null}
        </div>
      ) : <div>Your organization administrator can set or correct both dates in Projects.</div>}
      <button type="button" className="btn btn-sm btn-link" data-project-period-reload="" disabled={pending} onClick={load}>Reload current period</button>
      {notice ? <div role="status" data-project-period-notice="">{notice}</div> : null}
    </div>
  );
}
