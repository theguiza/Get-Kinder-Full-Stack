import React, { useState } from "react";

import {
  SENSITIVITY_AI_PROCESSING_FIELD,
  SENSITIVITY_ALLOWED_USE_FIELD,
  SENSITIVITY_ALLOWED_USE_VALUES,
  SENSITIVITY_PRESENCE_FIELDS,
  SENSITIVITY_PRESENCE_VALUES,
  publicUseAllowedEligible,
  restrictedPermissionEligible,
  sensitivityAiProcessingDispositionChosen,
  withSensitivityAllowedUse,
} from "./impactEvidenceLibraryLogic.js";

const SENSITIVITY_FIELD_LABELS = Object.freeze({
  reviewed_personal_data_status: "Personal data",
  reviewed_minor_data_status: "Minor data",
  reviewed_health_housing_justice_immigration_status: "Health / housing / justice / immigration",
  reviewed_indigenous_governance_status: "Indigenous / governance-sensitive",
  reviewed_staff_notes_status: "Staff notes",
  reviewed_story_testimonial_status: "Story / testimonial",
  reviewed_small_cell_risk_status: "Small-cell risk",
  reviewed_financial_records_status: "Financial records",
  reviewed_consent_basis_status: "Consent basis",
});

// The current decision's AI fact, as recorded: a needs_more_information head
// stores none, so it is shown as undecided rather than as a prohibition.
function recordedAiProcessing(decision) {
  if (decision.decision_outcome !== "reviewed") return "not decided (needs more information)";
  return decision[SENSITIVITY_AI_PROCESSING_FIELD] === true ? "permitted" : "not permitted";
}

function ValueRow({ label, value }) {
  return (
    <div className="d-flex justify-content-between gap-3 border-bottom py-2">
      <span className="text-muted small">{label}</span>
      <span className="small text-break text-end">{value ?? "none"}</span>
    </div>
  );
}

/**
 * The one B1A-2 Phase-5 sensitivity & allowed-use review body - what KAI
 * detected, the P1-06 review work, the current decision, and the decision
 * form - shared by the GK Knowledge Studio's Processing card and the client
 * Knowledge Studio's focused review panel. Presentation only: the caller
 * owns every request, the detail state, the form state, and the pending
 * flag, and renders loading, error, and result messages itself. The form
 * appears only while a review queue item exists; starting review work and
 * recording a decision remain separate caller actions.
 */
export default function SensitivityReviewCardBody({
  detail,
  formState,
  onFormStateChange,
  actionPending,
  onStartReviewWork,
  onSubmitDecision,
  startReviewWorkLabel = "Review sensitivity & allowed use",
}) {
  // The exact form state a Submit review click was refused for, made before
  // the AI disposition was chosen: nothing is sent, and the form says why
  // until the form changes (a new choice, or another file's form).
  const [unsubmittedFormState, setUnsubmittedFormState] = useState(null);
  if (!detail) return null;
  const aiDispositionChosen = sensitivityAiProcessingDispositionChosen(formState);
  const submitReviewed = () => {
    if (!aiDispositionChosen) {
      setUnsubmittedFormState(formState);
      return;
    }
    onSubmitDecision("reviewed");
  };
  return (
    <>
      <h6 className="mt-2">What KAI detected</h6>
      <ValueRow label="Sensitivity posture" value={JSON.stringify(detail.sensitivityPosture || {})} />
      <ValueRow label="Allowed-use restrictions" value={JSON.stringify(detail.allowedUseRestrictions || {})} />

      <h6 className="mt-3">Review work</h6>
      {detail.reviewQueueItem ? (
        <ValueRow
          label="Review work status"
          value={`${detail.reviewQueueItem.queue_status || "none"} / ${detail.reviewQueueItem.review_status || "none"}`}
        />
      ) : (
        <>
          <div className="small text-muted mb-2">No sensitivity review work has been started for this source yet.</div>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={onStartReviewWork}
            disabled={actionPending}
          >
            {startReviewWorkLabel}
          </button>
        </>
      )}

      <h6 className="mt-3">Sensitivity &amp; allowed-use decision</h6>
      {detail.currentDecision ? (
        <div data-sensitivity-current-decision>
          <div className="small text-muted">Current recorded decision - in effect until a new review is submitted.</div>
          <ValueRow label="Outcome" value={detail.currentDecision.decision_outcome} />
          <ValueRow label="Ordinary KAI processing (allowed use)" value={detail.currentDecision[SENSITIVITY_ALLOWED_USE_FIELD]} />
          <ValueRow
            label="AI processing (approved LLM provider)"
            value={recordedAiProcessing(detail.currentDecision)}
          />
          {detail.currentDecision[SENSITIVITY_AI_PROCESSING_FIELD] !== true ? (
            <div className="small text-muted mt-1" data-sensitivity-ai-restriction>
              AI drafting and impact evaluation are refused for this file until a new review permits AI processing.
              This restriction alone does not block non-AI processing.
            </div>
          ) : null}
          <ValueRow
            label="Funder/reporting drafts (source-use only, not release approval)"
            value={detail.currentDecision.reviewed_funder_use_allowed ? "allowed" : "not allowed"}
          />
          <ValueRow
            label="Product/service improvement (this org's own data only)"
            value={detail.currentDecision.reviewed_product_learning_allowed ? "allowed" : "not allowed"}
          />
          <ValueRow
            label="Public-use participation (not final release authority)"
            value={detail.currentDecision.reviewed_public_use_allowed ? "allowed" : "not allowed"}
          />
          <div className="small text-muted mt-1">
            Source-use permission does not by itself approve final external release.
          </div>
        </div>
      ) : (
        <div className="small text-muted">No sensitivity &amp; allowed-use decision recorded yet.</div>
      )}

      {detail.reviewQueueItem ? (
        <div className="border rounded p-2 mt-3">
          <div className="small fw-semibold mb-2">
            {detail.currentDecision ? "Record a new review (re-review)" : "Record review"}
          </div>
          {detail.currentDecision ? (
            <div className="small text-muted mb-2" data-sensitivity-new-review>
              Your selections below are a new review. They change nothing until you submit them.
            </div>
          ) : null}
          {SENSITIVITY_PRESENCE_FIELDS.map((field) => (
            <div className="row g-2 align-items-center mb-1" key={field}>
              <div className="col-7 small text-muted">{SENSITIVITY_FIELD_LABELS[field] || field}</div>
              <div className="col-5">
                <select
                  className="form-select form-select-sm"
                  value={formState[field]}
                  onChange={(event) => onFormStateChange((current) => ({ ...current, [field]: event.target.value }))}
                >
                  {SENSITIVITY_PRESENCE_VALUES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
            </div>
          ))}
          <div className="row g-2 align-items-center mb-2 mt-1">
            <div className="col-7 small text-muted">Ordinary KAI processing (allowed use)</div>
            <div className="col-5">
              <select
                className="form-select form-select-sm"
                value={formState[SENSITIVITY_ALLOWED_USE_FIELD]}
                onChange={(event) => onFormStateChange((current) => withSensitivityAllowedUse(current, event.target.value))}
              >
                {SENSITIVITY_ALLOWED_USE_VALUES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>

          <fieldset className="mb-2" data-sensitivity-ai-processing>
            <legend className="small mb-1">
              AI processing: may this file be processed by an approved AI provider for ordinary KAI service delivery
              (internal drafts, impact evaluation)?
            </legend>
            <div className="form-check form-check-inline small">
              <input
                className="form-check-input"
                type="radio"
                name="sensitivity-ai-processing"
                id="sensitivity-ai-processing-permitted"
                value="permitted"
                checked={formState[SENSITIVITY_AI_PROCESSING_FIELD] === true}
                disabled={!restrictedPermissionEligible(formState)}
                onChange={() => onFormStateChange((current) => ({ ...current, [SENSITIVITY_AI_PROCESSING_FIELD]: true }))}
              />
              <label className="form-check-label" htmlFor="sensitivity-ai-processing-permitted">Permitted</label>
            </div>
            <div className="form-check form-check-inline small">
              <input
                className="form-check-input"
                type="radio"
                name="sensitivity-ai-processing"
                id="sensitivity-ai-processing-not-permitted"
                value="not_permitted"
                checked={formState[SENSITIVITY_AI_PROCESSING_FIELD] === false}
                onChange={() => onFormStateChange((current) => ({ ...current, [SENSITIVITY_AI_PROCESSING_FIELD]: false }))}
              />
              <label className="form-check-label" htmlFor="sensitivity-ai-processing-not-permitted">Not permitted</label>
            </div>
            {!restrictedPermissionEligible(formState) ? (
              <div className="small text-muted">AI processing can be permitted only when ordinary KAI processing is set to allowed.</div>
            ) : null}
            {!aiDispositionChosen ? (
              <div className="small text-muted" data-sensitivity-ai-processing-required>
                Not selected. Choose whether AI processing is permitted before submitting this review. If it cannot be decided yet, use Needs more information.
              </div>
            ) : null}
          </fieldset>
          {unsubmittedFormState === formState && !aiDispositionChosen ? (
            <div className="alert alert-warning py-2 small" data-sensitivity-ai-processing-not-submitted>
              Review not submitted: choose whether AI processing is permitted, or use Needs more information. Nothing was sent.
            </div>
          ) : null}
          <div className="form-check small">
            <input
              className="form-check-input"
              type="checkbox"
              id="sensitivity-product-learning-allowed"
              checked={formState.reviewed_product_learning_allowed === true}
              disabled={!restrictedPermissionEligible(formState)}
              onChange={(event) => onFormStateChange((current) => ({ ...current, reviewed_product_learning_allowed: event.target.checked }))}
            />
            <label className="form-check-label" htmlFor="sensitivity-product-learning-allowed">
              Product/service improvement: this organization's own KAI/program improvement only
            </label>
          </div>
          <div className="form-check small">
            <input
              className="form-check-input"
              type="checkbox"
              id="sensitivity-funder-use-allowed"
              checked={formState.reviewed_funder_use_allowed === true}
              disabled={!restrictedPermissionEligible(formState)}
              onChange={(event) => onFormStateChange((current) => ({ ...current, reviewed_funder_use_allowed: event.target.checked }))}
            />
            <label className="form-check-label" htmlFor="sensitivity-funder-use-allowed">
              Funder/reporting drafts: may participate in drafting (not final funder release approval)
            </label>
          </div>
          <div className="form-check small mb-2">
            <input
              className="form-check-input"
              type="checkbox"
              id="sensitivity-public-use-allowed"
              checked={formState.reviewed_public_use_allowed === true}
              disabled={!publicUseAllowedEligible(formState)}
              onChange={(event) => onFormStateChange((current) => ({ ...current, reviewed_public_use_allowed: event.target.checked }))}
            />
            <label className="form-check-label" htmlFor="sensitivity-public-use-allowed">
              Public-use participation: requires allowed use, consent present, and governance status absent (not final release authority)
            </label>
          </div>

          <button
            type="button"
            className="btn btn-sm btn-primary me-2"
            onClick={submitReviewed}
            disabled={actionPending}
          >
            Submit review
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => onSubmitDecision("needs_more_information")}
            disabled={actionPending}
          >
            Needs more information
          </button>
        </div>
      ) : null}
    </>
  );
}
