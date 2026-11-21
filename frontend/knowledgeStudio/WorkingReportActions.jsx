import React, { useEffect, useRef, useState } from "react";

import {
  assessmentAdaptationPath,
  clientWorkingReportRevisionPath,
  errorText,
  postJson,
} from "../impactEvidenceLibraryLogic.js";
import {
  ADAPTATION_PURPOSE_OPTIONS,
  adaptationFailureMessage,
  newIdempotencyKey,
  revisionFailureMessage,
  withheldAssessmentMessage,
} from "./clientEvidenceWorkflowLogic.js";

/**
 * The organization's working-report actions (owner direction 2026-11-20),
 * shown in the saved-report reader:
 * - ReportLineage: an adapted report's purpose and source assessment, a
 *   revision's version and previous version, each openable, and what of the
 *   assessment was not reused;
 * - UseThisAssessment: "Use this assessment" on a saved Free Impact
 *   Assessment - choose a purpose, the server adapts the persisted assessment
 *   and saves the report under its own identity;
 * - ReviseReport: rewrite the prose of a saved report and save it as a new
 *   version (the server keeps citations, disclosures and notes, and checks
 *   every figure and claim again).
 * Every action is authorized and validated by the server; nothing here
 * approves, releases or sends anything.
 */

export function ReportLineage({ draft, onOpen }) {
  const context = draft.report;
  if (!context) return null;
  const withheld = withheldAssessmentMessage(context);
  if (!context.sourceAssessmentDraftId && !context.revisedByOrganization) return null;
  return (
    <div className="small border rounded p-2 mb-2 bg-light" data-client-report-lineage={context.relationship || ""}
      data-client-report-version={context.version} data-client-report-purpose={context.purpose || ""}>
      {context.sourceAssessmentDraftId ? (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
          <span>Prepared from your saved Free Impact Assessment.</span>
          <button type="button" className="btn btn-link btn-sm p-0 align-baseline" data-client-open-source-assessment={context.sourceAssessmentDraftId}
            onClick={() => onOpen(context.sourceAssessmentDraftId)}>
            Open the assessment
          </button>
          {context.sourceAssessmentUnchanged === false ? (
            <span className="text-warning" data-client-source-assessment-changed="">The saved assessment could not be matched to this report.</span>
          ) : null}
        </div>
      ) : null}
      {context.revisedByOrganization ? (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-1" data-client-report-revision="">
          <span>Version {context.version}, revised by your organization{context.revisedBlockOrdinals.length > 0 ? ` (passage ${context.revisedBlockOrdinals.join(", ")})` : ""}.</span>
          {context.parentDraftId ? (
            <button type="button" className="btn btn-link btn-sm p-0 align-baseline" data-client-open-previous-version={context.parentDraftId}
              onClick={() => onOpen(context.parentDraftId)}>
              Open the previous version
            </button>
          ) : null}
        </div>
      ) : null}
      {withheld ? <div className="text-muted" data-client-report-not-reused="">{withheld}</div> : null}
    </div>
  );
}

export function UseThisAssessment({ organizationId, engagementId, draft, onCreated }) {
  const [purpose, setPurpose] = useState("");
  const [guidance, setGuidance] = useState("");
  const [showGuidance, setShowGuidance] = useState(false);
  const [state, setState] = useState({ status: "idle", message: "" });
  // One key per attempt: kept for a retry after a lost reply (the server
  // replays the saved report), replaced once a report is created.
  const attemptRef = useRef({ signature: "", key: "" });
  const contextRef = useRef(`${organizationId}:${engagementId}:${draft.generatedContentDraftId}`);
  contextRef.current = `${organizationId}:${engagementId}:${draft.generatedContentDraftId}`;
  useEffect(() => {
    setPurpose("");
    setGuidance("");
    setState({ status: "idle", message: "" });
    attemptRef.current = { signature: "", key: "" };
  }, [organizationId, engagementId, draft.generatedContentDraftId]);

  const create = async () => {
    if (!purpose) return;
    const trimmed = guidance.trim();
    const signature = `${purpose}\n${trimmed}`;
    if (attemptRef.current.signature !== signature) attemptRef.current = { signature, key: newIdempotencyKey("use-assessment") };
    const requestContext = contextRef.current;
    setState({ status: "pending", message: "" });
    let result;
    try {
      result = await postJson(assessmentAdaptationPath(organizationId, draft.generatedContentDraftId), {
        engagement_id: engagementId,
        purpose,
        idempotency_key: attemptRef.current.key,
        ...(trimmed ? { guidance: trimmed } : {}),
      });
    } catch {
      if (contextRef.current === requestContext) setState({ status: "error", message: "The report could not be created: the server could not be reached. Try again; a report already saved is not duplicated." });
      return;
    }
    if (contextRef.current !== requestContext) return;
    const created = (result.statusCode === 201 || result.statusCode === 200) && result.body?.ok && result.body.data?.generatedContentDraftId;
    if (!created) {
      setState({ status: "error", message: adaptationFailureMessage(result, `The report could not be created. ${errorText(result)}`) });
      return;
    }
    attemptRef.current = { signature: "", key: "" };
    setState({ status: "idle", message: "" });
    onCreated(result.body.data.generatedContentDraftId);
  };

  return (
    <div className="border rounded p-2 mb-2" data-client-use-assessment={draft.generatedContentDraftId}>
      <h6 className="mb-1">Use this assessment</h6>
      <div className="small text-muted mb-2">
        Create a report from this saved assessment. KAI reuses its findings, interpretation and recommendations with their sources and limitations; you do not need to select the findings again.
      </div>
      <div className="d-grid gap-2 mb-2" role="radiogroup" aria-label="Report purpose" data-client-adaptation-purposes="">
        {ADAPTATION_PURPOSE_OPTIONS.map((option) => (
          <label key={option.purpose} className={`border rounded p-2 small d-flex gap-2 align-items-start ${purpose === option.purpose ? "border-primary" : ""}`}
            data-client-adaptation-purpose={option.purpose}>
            <input type="radio" className="form-check-input mt-1 flex-shrink-0" name={`adaptation-purpose-${draft.generatedContentDraftId}`}
              value={option.purpose} checked={purpose === option.purpose} onChange={() => setPurpose(option.purpose)} />
            <span>
              <span className="fw-semibold d-block">{option.label}</span>
              <span className="text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-link btn-sm p-0 mb-2" aria-expanded={showGuidance} data-client-adaptation-guidance-toggle=""
        onClick={() => setShowGuidance((value) => !value)}>
        {showGuidance ? "Hide guidance" : "Add guidance (optional)"}
      </button>
      {showGuidance ? (
        <textarea className="form-control form-control-sm mb-2" rows={3} maxLength={500} value={guidance} data-client-adaptation-guidance=""
          placeholder="For example: emphasise the follow-up results for the programme committee."
          onChange={(event) => setGuidance(event.target.value)} />
      ) : null}
      <div className="d-grid d-sm-flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" data-client-create-adapted-report="" disabled={!purpose || state.status === "pending"}
          onClick={create}>
          {state.status === "pending" ? "Creating report..." : "Create report"}
        </button>
      </div>
      {state.status === "error" ? <div className="alert alert-warning py-2 small mt-2 mb-0" data-client-adaptation-error="">{state.message}</div> : null}
    </div>
  );
}

export function ReviseReport({ organizationId, engagementId, draft, onSaved, onCancel }) {
  const [texts, setTexts] = useState(() => Object.fromEntries(draft.editableBlocks.map((block) => [block.ordinal, block.prose])));
  const [state, setState] = useState({ status: "idle", message: "" });
  const attemptRef = useRef({ signature: "", key: "" });
  const changed = draft.editableBlocks.filter((block) => (texts[block.ordinal] ?? "").trim() !== block.prose.trim());

  const save = async () => {
    if (changed.length === 0) {
      setState({ status: "error", message: "Nothing was changed, so no new version was saved." });
      return;
    }
    const blocks = changed.map((block) => ({ ordinal: block.ordinal, text: texts[block.ordinal].trim() }));
    const signature = JSON.stringify(blocks);
    if (attemptRef.current.signature !== signature) attemptRef.current = { signature, key: newIdempotencyKey("revise-report") };
    setState({ status: "pending", message: "" });
    let result;
    try {
      result = await postJson(clientWorkingReportRevisionPath(organizationId, engagementId, draft.generatedContentDraftId), {
        idempotency_key: attemptRef.current.key,
        blocks,
      });
    } catch {
      setState({ status: "error", message: "The revision could not be saved: the server could not be reached. Try again; a version already saved is not duplicated." });
      return;
    }
    const saved = (result.statusCode === 201 || result.statusCode === 200) && result.body?.ok && result.body.data?.generatedContentDraftId;
    if (!saved) {
      setState({ status: "error", message: revisionFailureMessage(result, `The revision was not saved. ${errorText(result)}`) });
      return;
    }
    attemptRef.current = { signature: "", key: "" };
    onSaved(result.body.data.generatedContentDraftId);
  };

  return (
    <div className="border rounded p-2 mb-2" data-client-revise-editor={draft.generatedContentDraftId}>
      <h6 className="mb-1">Revise this report</h6>
      <div className="small text-muted mb-2">
        Edit the wording, then save it as a new version. The saved version stays as it is. Figures must keep the words that describe them, and the source references and limitation notes are kept by KAI.
      </div>
      {draft.editableBlocks.map((block) => (
        <div key={block.ordinal} className="mb-2">
          <label className="small fw-semibold d-block mb-1" htmlFor={`revise-${draft.generatedContentDraftId}-${block.ordinal}`}>Passage {block.ordinal}</label>
          <textarea id={`revise-${draft.generatedContentDraftId}-${block.ordinal}`} className="form-control form-control-sm" rows={4} maxLength={3500}
            data-client-revise-block={block.ordinal} value={texts[block.ordinal] ?? ""}
            onChange={(event) => setTexts((current) => ({ ...current, [block.ordinal]: event.target.value }))} />
          {block.protectedText ? (
            <details className="small text-muted mt-1" data-client-revise-protected={block.ordinal}>
              <summary>Kept by KAI with this passage</summary>
              {block.protectedText}
            </details>
          ) : null}
        </div>
      ))}
      <div className="d-grid d-sm-flex gap-2">
        <button type="button" className="btn btn-sm btn-primary" data-client-save-revision="" disabled={state.status === "pending"} onClick={save}>
          {state.status === "pending" ? "Saving..." : `Save as version ${(draft.report?.version || 1) + 1}`}
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary" data-client-cancel-revision="" disabled={state.status === "pending"} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {state.status === "error" ? <div className="alert alert-warning py-2 small mt-2 mb-0" data-client-revision-error="">{state.message}</div> : null}
    </div>
  );
}
