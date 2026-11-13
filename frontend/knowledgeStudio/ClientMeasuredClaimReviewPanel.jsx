import StorySourceInformation from "../StorySourceInformation.js";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { claimProposalPath, errorText, getJson, postJson } from "../impactEvidenceLibraryLogic.js";
import { claimProposalResultMessage } from "./clientEvidenceWorkflowLogic.js";
import { EMPTY_INTERPRETATION_FORM, derivedMeasurementInterpretationPath, interpretationBody, interpretationFormFrom } from "./clientDerivedMeasurementLogic.js";
import FactualReviewPairedOutcome from "./FactualReviewPairedOutcome.jsx";
import MeaningQuestionsForm from "./MeaningQuestionsForm.jsx";
import {
  COVERAGE_DIMENSION_LABELS,
  calculationMethodText,
  decisionStateText,
  eligibilityBlockerText,
  measuredClaimReviewFailureMessage,
  measuredClaimReviewPlan,
  measuredClaimReviewRequest,
  measuredClaimReviewStepLabel,
  measurementWorksheetText,
  measurementReviewNoun,
  ordinaryRuleConditions,
  pairedOutcomeReviewText,
  organizationFactualReviewPath,
  projectOrganizationFactualReview,
  reviewQueueStateText,
  reviewReasonText,
  reviewRequirementText,
} from "./clientMeasuredClaimReviewLogic.js";

const JUDGMENTS = Object.freeze([
  ["supported", (noun) => `Confirm: the ${noun} is supported`, "btn-primary"],
  ["not_supported", () => "Report a problem: not supported", "btn-outline-danger"],
  ["needs_more_information", () => "Report a problem: needs more information", "btn-outline-secondary"],
]);

/**
 * The organization administrator's factual review of one measured claim
 * (owner authorization 2026-10-24), opened from the claim list only when the
 * server reports reviewMeasuredClaimFactualContent. Shows what is measured,
 * from which source, under which definition, with which limitations; the
 * current decisions and who made them; and the authoritative internal
 * eligibility. Each judgment lists exactly the decisions it will record
 * before the administrator chooses it, then records each through its own
 * existing route (evidence review, internal claim review, internal coverage
 * acceptance), stopping at the first refusal. A judgment the server does not
 * admit is not offered.
 *
 * Owner decision 2026-10-25: an ordinary measurement is usable for internal
 * reports without any of these decisions, so for an eligible claim the panel
 * only shows the measurement and offers a way to report a problem.
 *
 * A paired baseline/follow-up outcome is shown as its persisted breakdown
 * (FactualReviewPairedOutcome), whether or not its meaning is recorded. When
 * the administrator reads it, "Record what this measures" states its meaning
 * through the existing interpretation route, which never changes the
 * numbers: this claim keeps its wording and is no longer current, and a claim
 * can be proposed from the measurement's current evidence (existing route).
 */
export default function ClientMeasuredClaimReviewPanel({ organizationId, claimId, onClose, onRecorded, canProposeClaim = false }) {
  const [state, setState] = useState({ status: "loading", review: null, error: "" });
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState(null);
  const [clarifying, setClarifying] = useState(false);
  const [clarifyForm, setClarifyForm] = useState(EMPTY_INTERPRETATION_FORM);
  const [meaningRecorded, setMeaningRecorded] = useState(null);
  const seqRef = useRef(0);

  const load = useCallback(async () => {
    seqRef.current += 1;
    const seq = seqRef.current;
    const result = await getJson(organizationFactualReviewPath(organizationId, claimId));
    if (seqRef.current !== seq) return;
    setState(result.statusCode === 200 && result.body?.ok
      ? { status: "success", review: projectOrganizationFactualReview(result.body.data), error: "" }
      : { status: "error", review: null, error: errorText(result) });
  }, [organizationId, claimId]);
  useEffect(() => { load(); }, [load]);

  const review = state.review;
  const noun = measurementReviewNoun(review);
  const record = async (judgment) => {
    const steps = measuredClaimReviewPlan(review, judgment);
    if (steps.length === 0) return;
    setPending(judgment);
    setNotice(null);
    const recorded = [];
    for (const step of steps) {
      const request = measuredClaimReviewRequest(organizationId, review, step);
      const result = await postJson(request.path, request.body);
      if ((result.statusCode !== 200 && result.statusCode !== 201) || !result.body?.ok) {
        setNotice({ kind: "warning", text: measuredClaimReviewFailureMessage(step, result, noun), recorded });
        break;
      }
      recorded.push(measuredClaimReviewStepLabel(step, noun));
    }
    setPending("");
    setNotice((current) => current || { kind: "success", text: "Your decisions were recorded.", recorded });
    onRecorded?.();
    load();
  };

  // The organization's statement of what the measurement represents, through
  // the existing interpretation route (the server validates every field).
  const derived = review?.derivedMeasurement || null;
  const mayStateMeaning = Boolean(derived) && review.viewer === "organization_administrator" && derived.isCurrent;
  // A correction starts from the interpretation this evidence is stated under
  // (the measurement's current one; a superseded claim is not served here).
  const recordedForm = interpretationFormFrom(derived?.interpretation);
  const closeMeaning = () => { setClarifying(false); setClarifyForm(recordedForm); };
  const recordMeaning = async (event) => {
    event.preventDefault();
    const body = interpretationBody(clarifyForm, { paired: true });
    if (!body || pending) return;
    setPending("clarify");
    setNotice(null);
    const result = await postJson(derivedMeasurementInterpretationPath(organizationId, derived.sourceDerivedMeasurementId), body);
    setPending("");
    if ((result.statusCode !== 200 && result.statusCode !== 201) || !result.body?.ok) {
      setNotice({ kind: "warning", text: `The meaning was not recorded. ${errorText(result)}` });
      return;
    }
    setClarifying(false);
    setClarifyForm(EMPTY_INTERPRETATION_FORM);
    setMeaningRecorded({ replayed: result.body.data?.replayed === true, evidenceItemId: result.body.data?.evidenceItem?.evidence_item_id || null, proposal: null });
    onRecorded?.();
    load();
  };
  const proposeCurrentClaim = async () => {
    if (pending || !meaningRecorded?.evidenceItemId) return;
    setPending("propose");
    const result = await postJson(claimProposalPath(organizationId, meaningRecorded.evidenceItemId), {});
    setPending("");
    const ok = (result.statusCode === 200 || result.statusCode === 201) && result.body?.ok;
    setMeaningRecorded((current) => ({ ...current, proposal: ok ? { kind: "success", text: claimProposalResultMessage(result.body.data) } : { kind: "warning", text: errorText(result) } }));
    if (ok) onRecorded?.();
  };

  return (
    <div className="border rounded p-2 mt-2" data-client-measured-claim-review={claimId}>
      <div className="d-flex justify-content-between align-items-center">
        <div className="fw-semibold">Measurement</div>
        <button type="button" className="btn btn-sm btn-link" onClick={onClose}>Close</button>
      </div>
      {state.status === "loading" ? <div className="text-muted">Loading the review...</div> : null}
      {meaningRecorded ? (
        <div className="alert alert-success py-2 mt-1 mb-0" data-client-measured-claim-meaning-recorded="">
          <div>
            {meaningRecorded.replayed
              ? "This meaning was already recorded; nothing changed."
              : "Meaning recorded as your organization's statement. The numbers are unchanged. This claim keeps its wording and is no longer current; the measurement's current evidence states the meaning you recorded."}
          </div>
          {!meaningRecorded.replayed && meaningRecorded.evidenceItemId && canProposeClaim && !meaningRecorded.proposal ? (
            <button type="button" className="btn btn-sm btn-outline-primary mt-1" disabled={Boolean(pending)}
              data-client-measured-claim-propose-current={meaningRecorded.evidenceItemId} onClick={proposeCurrentClaim}>
              {pending === "propose" ? "Proposing..." : "Propose a claim from the current evidence"}
            </button>
          ) : null}
          {meaningRecorded.proposal ? <div className="mt-1" data-client-measured-claim-proposal={meaningRecorded.proposal.kind}>{meaningRecorded.proposal.text}</div> : null}
        </div>
      ) : null}
      {state.status === "error" && !meaningRecorded ? <div className="alert alert-warning py-2 mb-0">The review could not be loaded. {state.error}</div> : null}
      {review ? (
        <>
          {derived ? <FactualReviewPairedOutcome review={review} audience="organization" /> : null}
          {mayStateMeaning && !meaningRecorded ? (
            <div className="mt-1" data-client-measured-claim-meaning-action="">
              <button type="button" className="btn btn-sm btn-outline-primary" data-client-measured-claim-clarify={derived.sourceDerivedMeasurementId}
                aria-expanded={clarifying} onClick={() => { setClarifying((value) => !value); setClarifyForm(recordedForm); }}>
                {derived.interpretation ? "Change what this measures" : "Record what this measures"}
              </button>
              {clarifying ? (
                <MeaningQuestionsForm attr="data-client-measured-claim-clarify" form={clarifyForm} setForm={setClarifyForm} initial={recordedForm}
                  paired known={pairedOutcomeReviewText(derived).known} pending={pending === "clarify"} onSubmit={recordMeaning} onCancel={closeMeaning}
                  note={"This claim keeps its wording, but once a meaning or a correction is recorded it is no longer current; a claim can then be proposed "
                    + "from the measurement's current evidence. Earlier review decisions are not copied to that claim."} />
              ) : null}
            </div>
          ) : null}
          {review.measurement ? (
            <div className="mt-1" data-client-measured-claim-review-measurement="">
              <div><span className="fw-semibold">Measured:</span> {review.measurement.measuredValue} {review.measurement.unitLabel}</div>
              <div>One record is: {review.measurement.countedUnit}. {review.measurement.definitionText}</div>
              <div>Counted: {review.measurement.inclusionRule} Not counted: {review.measurement.exclusionRule}</div>
              <div>
                {review.measurement.periodStart
                  ? `Reporting period (as stated in the definition): ${review.measurement.periodStart} to ${review.measurement.periodEnd}.`
                  : "No reporting period was defined."}
              </div>
              <div className="text-muted">
                {review.measurement.totalRecordCount} records in the file; {review.measurement.blankRecordCount} blank excluded;
                {" "}{review.measurement.duplicateRecordCount} exact duplicates included.
              </div>
              {measurementWorksheetText(review.measurement) ? (
                <div data-client-measured-claim-review-worksheet={review.measurement.worksheetKey}>
                  Worksheet counted: {measurementWorksheetText(review.measurement)}. Only this worksheet was counted.
                </div>
              ) : null}
              <div>Counting method: {calculationMethodText(review.measurement.calculationMethod)}.</div>
            </div>
          ) : null}
          <div className="mt-1">
            <span className="fw-semibold">Source:</span> {review.source.sourceCode || "Unnamed source"} ({review.source.isCurrent ? "current version" : "not the current version"})
          </div>
          {!derived ? <div className="mt-1 text-break"><span className="fw-semibold">Claim:</span> {review.claimStatement}</div> : null}
          {review.limitations.length > 0 ? (
            <div className="mt-1">
              <div className="fw-semibold">Limitations</div>
              <ul className="mb-0" data-client-measured-claim-review-limitations="">
                {review.limitations.map((limitation) => <li key={limitation.code}>{limitation.description}</li>)}
              </ul>
            </div>
          ) : null}
          {!review.internalEligibility.eligible ? (
            <div className="mt-1" data-client-measured-claim-review-status={review.reviewRequirement?.responsibleRole ? "get_kinder_review_required" : "outstanding"}>
              <div className="fw-semibold">Review status</div>
              {!review.ordinaryRule.applies ? (
                <>
                  <div>The ordinary internal {derived ? "" : "record-count "}rule does not cover this claim, because of what is recorded for its source:</div>
                  <ul className="mb-0" data-client-measured-claim-ordinary-conditions="">
                    {ordinaryRuleConditions(review).map((condition) => <li key={condition}>{condition}</li>)}
                  </ul>
                </>
              ) : null}
              {reviewRequirementText(review.reviewRequirement) ? (
                <div data-client-measured-claim-review-requirement="">{reviewRequirementText(review.reviewRequirement)}</div>
              ) : null}
              <div className="text-muted">
                Evidence review item: {reviewQueueStateText(review.evidenceReview)}. Claim review item: {reviewQueueStateText(review.claimReview)}.
              </div>
              {review.reviewRequirement?.responsibleRole ? (
                <div className="text-muted" data-client-measured-claim-review-handoff="">
                  While these steps are outstanding the claim is listed in Get Kinder&apos;s Review Queue; no separate request is needed.
                  Your organization cannot approve it here.
                </div>
              ) : null}
            </div>
          ) : null}
          {review.internalEligibility.eligible && !review.evidenceReview.decisionOutcome && !review.claimReview.decisionOutcome ? (
            <div className="mt-1" data-client-measured-claim-no-review-required="">
              {derived
                ? "No evidence, claim or limitation review is required for internal use: the result was calculated from the authorized source, and its limitations are carried into every report."
                : "No evidence, claim or limitation review is required for internal use: the count comes from the authorized source under your organization's recorded definition, and its limitations are carried into every report."}
            </div>
          ) : null}
          <StorySourceInformation />
          <div className="mt-1" data-client-measured-claim-review-decisions="">
            <div>Evidence review: {decisionStateText(review.evidenceReview)}</div>
            <div>Claim review: {decisionStateText(review.claimReview)}</div>
            {review.coverageLimitations.filter((row) => row.assessmentStatus === "unresolved").map((row) => (
              <div key={row.dimensionKey}>
                {COVERAGE_DIMENSION_LABELS[row.dimensionKey] || row.dimensionKey}: {row.internalLimitationAccepted
                  ? "accepted as a limitation for internal use only"
                  : review.internalEligibility.eligible ? "unresolved; carried as a limitation for internal use" : "unresolved"}
              </div>
            ))}
          </div>
          {[...new Set([...review.evidenceReview.getKinderReviewReasons, ...review.evidenceReview.blockedReasons,
            ...review.claimReview.getKinderReviewReasons, ...review.claimReview.blockedReasons])]
            .filter((reason) => reason !== "factual_review_not_supported")
            .map((reason) => <div key={reason} className="mt-1" data-client-measured-claim-review-reason={reason}>{reviewReasonText(reason, { derived: Boolean(derived) })}</div>)}
          {JUDGMENTS.map(([judgment, label, style]) => {
            const steps = measuredClaimReviewPlan(review, judgment);
            if (steps.length === 0) return null;
            return (
              <div key={judgment} className="mt-2" data-client-measured-claim-judgment={judgment}>
                <div className="text-muted">Records, under your name:</div>
                <ul className="mb-1">{steps.map((step) => <li key={`${step.kind}:${step.dimensionKey || step.decision}`}>{measuredClaimReviewStepLabel(step, noun)}</li>)}</ul>
                <button type="button" className={`btn btn-sm ${style}`} disabled={Boolean(pending)} onClick={() => record(judgment)}>
                  {pending === judgment ? "Recording..." : label(noun)}
                </button>
              </div>
            );
          })}
          {notice ? (
            <div className={`alert alert-${notice.kind} py-2 mt-2 mb-0`} data-client-measured-claim-review-notice={notice.kind}>
              {notice.recorded?.length > 0 ? <div>Recorded: {notice.recorded.join("; ")}.</div> : null}
              <div>{notice.text}</div>
            </div>
          ) : null}
          <div className="mt-2" data-client-measured-claim-eligibility={review.internalEligibility.eligible ? "eligible" : "blocked"}>
            {review.internalEligibility.eligible
              ? "Usable in internal reports now. This does not approve it for funders or the public."
              : `Not yet eligible for internal use: ${review.internalEligibility.blockerCodes.map(eligibilityBlockerText).join(" ")}`}
          </div>
        </>
      ) : null}
    </div>
  );
}
