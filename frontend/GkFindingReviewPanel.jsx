import React, { useCallback, useEffect, useRef, useState } from "react";
import { coverageInternalAcceptancePath, errorText, getJson, postJson } from "./impactEvidenceLibraryLogic.js";
import {
  COVERAGE_DIMENSION_LABELS,
  calculationMethodText,
  decisionStateText,
  eligibilityBlockerText,
  measurementWorksheetText,
  COUNT_ONLY_RULE_TEXT,
  ordinaryRuleConditions,
  organizationFactualReviewPath,
  projectOrganizationFactualReview,
  reviewQueueStateText,
  reviewRequirementText,
} from "./knowledgeStudio/clientMeasuredClaimReviewLogic.js";

const APPROVED_CLAIM_OUTCOMES = new Set(["approved", "approved_with_limitation"]);

/**
 * The measured finding a Get Kinder reviewer is deciding, shown in the
 * Traceability panel above the existing evidence and claim review decision
 * forms ("Review finding" in the Claims list opens it). It reads the
 * finding-review view (GET .../claims/:claimId/organization-factual-review,
 * which admits a GK reviewer who may record this organization's evidence
 * review): what was counted, from which worksheet and source version, under
 * the organization's own definition (which KAI did not verify), the recorded
 * source values that keep it outside the ordinary internal rule, the
 * limitations, the current decisions and review items, and the authoritative
 * internal eligibility. It records nothing itself except an internal
 * acceptance of an unresolved coverage limitation, through the existing
 * coverage route, once the claim review is approved; the server re-checks
 * every request. `reloadKey` changes whenever the parent re-reads the
 * claim's traceability (after any decision), so this view re-reads too.
 */
export default function GkFindingReviewPanel({ organizationId, claimId, reloadKey, canAcceptCoverage, onRecorded }) {
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
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => { setNotice(null); }, [claimId]);

  const acceptLimitation = async (dimensionKey) => {
    setPending(dimensionKey);
    setNotice(null);
    const result = await postJson(coverageInternalAcceptancePath(organizationId, claimId, dimensionKey), {});
    setPending("");
    const recorded = (result.statusCode === 200 || result.statusCode === 201) && result.body?.ok;
    setNotice(recorded
      ? { kind: "success", text: `Accepted for internal use only, as a limitation (not resolved): ${COVERAGE_DIMENSION_LABELS[dimensionKey] || dimensionKey}.` }
      : { kind: "warning", text: errorText(result) });
    if (recorded) onRecorded?.();
    else load();
  };

  const review = state.review;
  const claimApproved = APPROVED_CLAIM_OUTCOMES.has(review?.claimReview.decisionOutcome);
  return (
    <div className="border rounded p-2 mb-3" data-gk-finding-review={claimId}>
      <div className="fw-semibold mb-1">Finding under review</div>
      {state.status === "loading" ? <div className="text-muted small">Loading the finding...</div> : null}
      {state.status === "error" ? <div className="alert alert-warning py-2 small mb-0">The finding could not be loaded. {state.error}</div> : null}
      {review ? (
        <div className="small">
          <div className="text-break" data-gk-finding-claim="">{review.claimStatement}</div>
          {review.measurement ? (
            <div className="mt-1" data-gk-finding-measurement="">
              <div><span className="fw-semibold">Counted:</span> {review.measurement.measuredValue} {review.measurement.unitLabel}</div>
              {measurementWorksheetText(review.measurement) ? (
                <div data-gk-finding-worksheet={review.measurement.worksheetKey}>
                  <span className="fw-semibold">Worksheet counted:</span> {measurementWorksheetText(review.measurement)} (only this worksheet)
                </div>
              ) : null}
              <div><span className="fw-semibold">Method:</span> {calculationMethodText(review.measurement.calculationMethod)}</div>
              <div>
                {review.measurement.totalRecordCount} data records; {review.measurement.blankRecordCount} blank excluded;
                {" "}{review.measurement.duplicateRecordCount} exact duplicates included.
              </div>
              <div data-gk-finding-meaning="">
                <span className="fw-semibold">Meaning, as defined by the organization (not verified by KAI):</span> one record is one
                {" "}{review.measurement.countedUnit}. {review.measurement.definitionText}
              </div>
              <div>Counted: {review.measurement.inclusionRule} Not counted: {review.measurement.exclusionRule}</div>
              <div>
                {review.measurement.periodStart
                  ? `Reporting period, as stated in the definition: ${review.measurement.periodStart} to ${review.measurement.periodEnd}.`
                  : "No reporting period was defined."}
              </div>
            </div>
          ) : null}
          <div className="mt-1">
            <span className="fw-semibold">Source:</span> {review.source.sourceCode || "Unnamed source"} ({review.source.isCurrent ? "current version" : "not the current version"})
          </div>
          {review.limitations.length > 0 ? (
            <div className="mt-1">
              <div className="fw-semibold">Limitations</div>
              <ul className="mb-0" data-gk-finding-limitations="">
                {review.limitations.map((limitation) => <li key={limitation.code}>{limitation.description}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="mt-1" data-gk-finding-ordinary-rule={review.ordinaryRule.applies ? "applies" : "does_not_apply"}>
            <span className="fw-semibold">Ordinary internal rule:</span>{" "}
            {review.ordinaryRule.applies
              ? (review.ordinaryRule.countOnly ? COUNT_ONLY_RULE_TEXT : "applies; no Get Kinder decision is needed for internal use.")
              : "does not apply, because of what is recorded for the source:"}
            {!review.ordinaryRule.applies ? (
              <ul className="mb-0" data-gk-finding-ordinary-conditions="">
                {ordinaryRuleConditions(review).map((condition) => <li key={condition}>{condition}</li>)}
              </ul>
            ) : null}
          </div>
          <div className="mt-1" data-gk-finding-decisions="">
            <div>Evidence review: {decisionStateText(review.evidenceReview)} · item {reviewQueueStateText(review.evidenceReview)}</div>
            <div>Claim review: {decisionStateText(review.claimReview)} · item {reviewQueueStateText(review.claimReview)}</div>
          </div>
          {review.coverageLimitations.filter((row) => row.assessmentStatus === "unresolved").length > 0 ? (
            <div className="mt-1" data-gk-finding-coverage="">
              <div className="fw-semibold">Unresolved coverage</div>
              {review.coverageLimitations.filter((row) => row.assessmentStatus === "unresolved").map((row) => (
                <div key={row.dimensionKey} className="d-flex flex-wrap align-items-center gap-2 mt-1" data-gk-finding-coverage-dimension={row.dimensionKey}>
                  <span>
                    {COVERAGE_DIMENSION_LABELS[row.dimensionKey] || row.dimensionKey}: {row.internalLimitationAccepted
                      ? "accepted as a limitation for internal use only (still unresolved)"
                      : "unresolved"}
                  </span>
                  {canAcceptCoverage && claimApproved && !row.internalLimitationAccepted ? (
                    <button type="button" className="btn btn-sm btn-outline-primary" disabled={Boolean(pending)}
                      data-gk-finding-accept-limitation={row.dimensionKey} onClick={() => acceptLimitation(row.dimensionKey)}>
                      {pending === row.dimensionKey ? "Recording..." : "Accept as internal limitation"}
                    </button>
                  ) : null}
                </div>
              ))}
              {canAcceptCoverage && !claimApproved ? (
                <div className="text-muted">Limitations can be accepted once the claim review is approved.</div>
              ) : null}
            </div>
          ) : null}
          {reviewRequirementText(review.reviewRequirement) ? (
            <div className="mt-1" data-gk-finding-requirement="">{reviewRequirementText(review.reviewRequirement)}</div>
          ) : null}
          {notice ? <div className={`alert alert-${notice.kind} py-2 mt-2 mb-0`} data-gk-finding-notice={notice.kind}>{notice.text}</div> : null}
          <div className="mt-2" data-gk-finding-eligibility={review.internalEligibility.eligible ? "eligible" : "blocked"}>
            {review.internalEligibility.eligible
              ? "Eligible for internal use. This does not approve it for funders or the public."
              : `Not eligible for internal use: ${review.internalEligibility.blockerCodes.map(eligibilityBlockerText).join(" ")}`}
          </div>
          <div className="text-muted mt-1">Record the evidence and claim review decisions below; each is persisted and re-read.</div>
        </div>
      ) : null}
    </div>
  );
}
