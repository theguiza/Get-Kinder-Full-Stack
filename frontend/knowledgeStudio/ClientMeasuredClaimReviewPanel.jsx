import React, { useCallback, useEffect, useRef, useState } from "react";

import { errorText, getJson, postJson } from "../impactEvidenceLibraryLogic.js";
import {
  COVERAGE_DIMENSION_LABELS,
  decisionStateText,
  eligibilityBlockerText,
  measuredClaimReviewFailureMessage,
  measuredClaimReviewPlan,
  measuredClaimReviewRequest,
  measuredClaimReviewStepLabel,
  organizationFactualReviewPath,
  projectOrganizationFactualReview,
  reviewReasonText,
} from "./clientMeasuredClaimReviewLogic.js";

const JUDGMENTS = Object.freeze([
  ["supported", "Confirm: the count is supported", "btn-primary"],
  ["not_supported", "Report a problem: not supported", "btn-outline-danger"],
  ["needs_more_information", "Report a problem: needs more information", "btn-outline-secondary"],
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
 */
export default function ClientMeasuredClaimReviewPanel({ organizationId, claimId, onClose, onRecorded }) {
  const [state, setState] = useState({ status: "loading", review: null, error: "" });
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState(null);
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
        setNotice({ kind: "warning", text: measuredClaimReviewFailureMessage(step, result), recorded });
        break;
      }
      recorded.push(measuredClaimReviewStepLabel(step));
    }
    setPending("");
    setNotice((current) => current || { kind: "success", text: "Your decisions were recorded.", recorded });
    onRecorded?.();
    load();
  };

  return (
    <div className="border rounded p-2 mt-2" data-client-measured-claim-review={claimId}>
      <div className="d-flex justify-content-between align-items-center">
        <div className="fw-semibold">Measurement</div>
        <button type="button" className="btn btn-sm btn-link" onClick={onClose}>Close</button>
      </div>
      {state.status === "loading" ? <div className="text-muted">Loading the review...</div> : null}
      {state.status === "error" ? <div className="alert alert-warning py-2 mb-0">The review could not be loaded. {state.error}</div> : null}
      {review ? (
        <>
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
            </div>
          ) : null}
          <div className="mt-1">
            <span className="fw-semibold">Source:</span> {review.source.sourceCode || "Unnamed source"} ({review.source.isCurrent ? "current version" : "not the current version"})
          </div>
          <div className="mt-1 text-break"><span className="fw-semibold">Claim:</span> {review.claimStatement}</div>
          {review.limitations.length > 0 ? (
            <div className="mt-1">
              <div className="fw-semibold">Limitations</div>
              <ul className="mb-0" data-client-measured-claim-review-limitations="">
                {review.limitations.map((limitation) => <li key={limitation.code}>{limitation.description}</li>)}
              </ul>
            </div>
          ) : null}
          {review.internalEligibility.eligible && !review.evidenceReview.decisionOutcome && !review.claimReview.decisionOutcome ? (
            <div className="mt-1" data-client-measured-claim-no-review-required="">
              No evidence, claim or limitation review is required for internal use: the count comes from the authorized source under your
              organization&apos;s recorded definition, and its limitations are carried into every report.
            </div>
          ) : null}
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
            .map((reason) => <div key={reason} className="mt-1" data-client-measured-claim-review-reason={reason}>{reviewReasonText(reason)}</div>)}
          {JUDGMENTS.map(([judgment, label, style]) => {
            const steps = measuredClaimReviewPlan(review, judgment);
            if (steps.length === 0) return null;
            return (
              <div key={judgment} className="mt-2" data-client-measured-claim-judgment={judgment}>
                <div className="text-muted">Records, under your name:</div>
                <ul className="mb-1">{steps.map((step) => <li key={`${step.kind}:${step.dimensionKey || step.decision}`}>{measuredClaimReviewStepLabel(step)}</li>)}</ul>
                <button type="button" className={`btn btn-sm ${style}`} disabled={Boolean(pending)} onClick={() => record(judgment)}>
                  {pending === judgment ? "Recording..." : label}
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
