import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDonorTimelineHeadline,
  resolveDonorAllocationTarget,
  resolveDonorDonationStatus,
} from "../controllers/donorApiController.js";

test("resolveDonorDonationStatus identifies pending review donations", () => {
  const status = resolveDonorDonationStatus({
    receipt_count: 0,
    review_status: "pending_manual_review",
    funding_allocation_status: "held_pending_manual_review",
  });

  assert.equal(status.code, "pending_review");
  assert.equal(status.label, "Pending review");
});

test("resolveDonorDonationStatus distinguishes allocated, underway, and funded donations", () => {
  const allocated = resolveDonorDonationStatus({
    receipt_count: 0,
    review_status: "manually_allocated",
    funding_allocation_status: "available",
  });
  const underway = resolveDonorDonationStatus({
    receipt_count: 1,
    funding_remaining_ic: 30,
  });
  const funded = resolveDonorDonationStatus({
    receipt_count: 1,
    funding_remaining_ic: 0,
  });

  assert.equal(allocated.code, "allocated");
  assert.equal(underway.code, "impact_underway");
  assert.equal(funded.code, "impact_funded");
});

test("resolveDonorAllocationTarget prefers manual targets and falls back to funding scope", () => {
  assert.equal(
    resolveDonorAllocationTarget({
      manual_target_type: "org",
      manual_target_org_name: "OARCA",
    }),
    "OARCA",
  );

  assert.equal(
    resolveDonorAllocationTarget({
      funding_scope_type: "event",
      funding_event_title: "Spring Regatta",
      funding_metadata: { allocation_target_label: "ignored fallback" },
    }),
    "Spring Regatta",
  );

  assert.equal(
    resolveDonorAllocationTarget({
      funding_scope_type: "unrestricted",
    }),
    "unrestricted pool",
  );
});

test("buildDonorTimelineHeadline uses impact and allocation context", () => {
  const fundedHeadline = buildDonorTimelineHeadline(
    { donation_id: 15, event_count: 2, event_title: "Ignored title" },
    { code: "impact_funded" },
    null,
  );
  const allocatedHeadline = buildDonorTimelineHeadline(
    { donation_id: 16 },
    { code: "allocated" },
    "Downtown Food Bank",
  );

  assert.equal(fundedHeadline, "2 volunteer shifts funded");
  assert.equal(allocatedHeadline, "Allocated to Downtown Food Bank");
});
