import test from "node:test";
import assert from "node:assert/strict";

import {
  apportionMinutesAcrossAllocations,
  buildFundingAllocationPlan,
  buildFundingAllocationContext,
  isFundingCreditEligible,
} from "../services/fundingAllocationService.js";

test("isFundingCreditEligible blocks unrestricted donations for subsidy-ineligible events", () => {
  const context = buildFundingAllocationContext({
    eventId: "evt-1",
    organizationId: 4,
    creditsToFund: 25,
    policyProfile: { isEligible: false },
  });

  assert.equal(
    isFundingCreditEligible({
      id: 1,
      source_type: "donation",
      scope_type: "unrestricted",
      allocation_status: "available",
      remaining_ic: 40,
    }, context),
    false,
  );
});

test("buildFundingAllocationPlan applies the Stage 4 waterfall order", () => {
  const context = buildFundingAllocationContext({
    eventId: "evt-1",
    organizationId: 4,
    creditsToFund: 60,
    policyProfile: { isEligible: true },
  });

  const plan = buildFundingAllocationPlan([
    {
      id: 10,
      pool_id: 2,
      source_type: "donation",
      scope_type: "unrestricted",
      allocation_status: "available",
      remaining_ic: 50,
      event_id: null,
      organization_id: null,
      donation_id: 99,
    },
    {
      id: 11,
      pool_id: 2,
      source_type: "subscription",
      scope_type: "org",
      allocation_status: "available",
      remaining_ic: 20,
      organization_id: 4,
      donation_id: null,
    },
    {
      id: 12,
      pool_id: 2,
      source_type: "admin_grant",
      scope_type: "org",
      allocation_status: "available",
      remaining_ic: 20,
      organization_id: 4,
      donation_id: null,
    },
    {
      id: 13,
      pool_id: 2,
      source_type: "event_package",
      scope_type: "event",
      allocation_status: "available",
      remaining_ic: 10,
      event_id: "evt-1",
      donation_id: null,
    },
  ], context);

  assert.equal(plan.fundedAmount, 50);
  assert.deepEqual(
    plan.allocations.map((row) => `${row.sourceType}:${row.amountIc}`),
    ["event_package:10", "subscription:20", "admin_grant:20"],
  );
});

test("buildFundingAllocationPlan allows manually targeted donation credits on commercial events", () => {
  const context = buildFundingAllocationContext({
    eventId: "evt-9",
    organizationId: 9,
    creditsToFund: 15,
    policyProfile: { isEligible: false },
  });

  const plan = buildFundingAllocationPlan([
    {
      id: 20,
      pool_id: 3,
      source_type: "donation",
      scope_type: "event",
      allocation_status: "available",
      remaining_ic: 25,
      event_id: "evt-9",
      donation_id: 7,
    },
  ], context);

  assert.equal(plan.fundedAmount, 15);
  assert.equal(plan.allocations[0]?.donationId, 7);
});

test("apportionMinutesAcrossAllocations distributes time proportionally", () => {
  const minutes = apportionMinutesAcrossAllocations(90, [
    { amountIc: 10 },
    { amountIc: 20 },
  ]);

  assert.equal(minutes.reduce((sum, value) => sum + value, 0), 90);
  assert.deepEqual(minutes, [30, 60]);
});
