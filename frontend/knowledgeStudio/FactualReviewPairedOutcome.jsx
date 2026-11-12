import React from "react";

import { Disclosure } from "./KnowledgeStudioViews.jsx";
import { pairedOutcomeReviewText } from "./clientMeasuredClaimReviewLogic.js";

/**
 * A paired baseline/follow-up outcome as both factual-review panels show it
 * (the organization administrator's and Get Kinder's): the recorded label or
 * the measurement family, the persisted breakdown, who is excluded and why,
 * the meaning state, the reporting-period state and the method; the internal
 * worksheet and column keys and the claim exactly as recorded on request.
 * Display only: every number is one the server persisted.
 */
export default function FactualReviewPairedOutcome({ review, audience }) {
  const derived = review.derivedMeasurement;
  const text = pairedOutcomeReviewText(derived, { audience });
  return (
    <div className="mt-1" data-factual-review-paired={derived.sourceDerivedMeasurementId}
      data-factual-review-meaning-state={text.meaningRecorded ? "recorded" : "not_recorded"}>
      <div className="fw-semibold" data-factual-review-paired-heading="">{text.heading}</div>
      {text.subheading ? <div className="text-muted">{text.subheading}</div> : null}
      <div data-factual-review-paired-result="">{text.result}</div>
      <div data-factual-review-paired-population="">{text.population}</div>
      <div data-factual-review-meaning="">
        {text.meaning.map((sentence) => <div key={sentence}>{sentence}</div>)}
      </div>
      <div data-factual-review-period="">{text.period}</div>
      <div className="text-muted">{text.method}</div>
      <div className="text-muted">{text.currentness}</div>
      <Disclosure name="paired-source-details" label="Source details" openLabel="Hide source details">
        <div className="text-break text-muted" data-factual-review-source-details="">
          {text.sourceDetails.map((line) => <div key={line}>{line}</div>)}
          {review.claimStatement ? <div>Claim, as recorded: {review.claimStatement}</div> : null}
        </div>
      </Disclosure>
    </div>
  );
}
