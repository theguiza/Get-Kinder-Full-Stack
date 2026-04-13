import test from "node:test";
import assert from "node:assert/strict";

import {
  choosePolicyAllocationTarget,
  resolveEffectivePolicyProfile,
} from "../services/donationPolicyService.js";

test("resolveEffectivePolicyProfile makes mission-priority orgs auto-eligible", () => {
  const profile = resolveEffectivePolicyProfile({
    org_status: "approved",
    funding_class: "mission_priority",
    subsidy_eligible: false,
    manual_override_only: false,
  });

  assert.equal(profile.fundingClass, "mission_priority");
  assert.equal(profile.isEligible, true);
});

test("resolveEffectivePolicyProfile excludes commercial and manual-override-only targets", () => {
  const commercial = resolveEffectivePolicyProfile({
    org_status: "approved",
    funding_class: "commercial",
    subsidy_eligible: true,
    manual_override_only: false,
  });
  const manualOnly = resolveEffectivePolicyProfile({
    org_status: "approved",
    funding_class: "mission_priority",
    subsidy_eligible: true,
    manual_override_only: true,
  });

  assert.equal(commercial.isEligible, false);
  assert.equal(manualOnly.isEligible, false);
});

test("choosePolicyAllocationTarget prefers eligible mission-priority events over orgs", () => {
  const target = choosePolicyAllocationTarget({
    eventCandidates: [
      {
        id: "evt-1",
        title: "Soup Kitchen Shift",
        organization_id: 7,
        organization_status: "approved",
        org_funding_class: "mission_priority",
        org_subsidy_eligible: false,
        org_manual_override_only: false,
        org_pool_balance: 4,
        start_at: "2026-04-10T17:00:00.000Z",
      },
    ],
    organizationCandidates: [
      {
        id: 7,
        name: "Food Bank",
        org_status: "approved",
        funding_class: "mission_priority",
        subsidy_eligible: false,
        manual_override_only: false,
        current_balance: 1,
      },
    ],
  });

  assert.equal(target?.targetType, "event");
  assert.equal(target?.eventId, "evt-1");
  assert.equal(target?.policyReasonCode, "policy_event_mission_priority");
});

test("choosePolicyAllocationTarget falls back to eligible mixed orgs when no eligible event exists", () => {
  const target = choosePolicyAllocationTarget({
    eventCandidates: [
      {
        id: "evt-2",
        title: "Commercial Race Support",
        organization_id: 9,
        organization_status: "approved",
        org_funding_class: "commercial",
        org_subsidy_eligible: true,
        org_manual_override_only: false,
        org_pool_balance: 0,
      },
    ],
    organizationCandidates: [
      {
        id: 4,
        name: "Community Pantry",
        org_status: "approved",
        funding_class: "mixed",
        subsidy_eligible: true,
        manual_override_only: false,
        current_balance: 3,
      },
      {
        id: 5,
        name: "Arts Org",
        org_status: "approved",
        funding_class: "mixed",
        subsidy_eligible: false,
        manual_override_only: false,
        current_balance: 0,
      },
    ],
  });

  assert.equal(target?.targetType, "org");
  assert.equal(target?.organizationId, 4);
  assert.equal(target?.policyReasonCode, "policy_org_mixed");
});
