import test from "node:test";
import assert from "node:assert/strict";

import {
  ROLE_TIER_RATES,
  addRewardPresentation,
  computeVolunteerReward,
  deriveRewardTierFromRate,
  normalizeRewardTier,
  resolveRewardProfile,
} from "../services/volunteerRewardService.js";

test("normalizeRewardTier maps legacy aliases", () => {
  assert.equal(normalizeRewardTier("helper"), "standard");
  assert.equal(normalizeRewardTier("lead"), "leadership");
  assert.equal(normalizeRewardTier("skilled"), "skilled");
});

test("computeVolunteerReward uses role tier rates when provided", () => {
  const reward = computeVolunteerReward({
    roleTier: "specialist",
    attendedMinutes: 90,
    impactCreditsBase: 10,
  });

  assert.equal(reward.impact_credits_rate, ROLE_TIER_RATES.specialist);
  assert.equal(reward.reward_tier, "specialist");
  assert.equal(reward.impact_credits_award, 30);
  assert.equal(reward.duration_hours, 1.5);
});

test("computeVolunteerReward falls back to event impact credit rate", () => {
  const reward = computeVolunteerReward({
    impactCreditsBase: 15,
    startAt: "2026-04-07T17:00:00.000Z",
    endAt: "2026-04-07T19:00:00.000Z",
  });

  assert.equal(reward.reward_tier, "skilled");
  assert.equal(reward.impact_credits_rate, 15);
  assert.equal(reward.impact_credits_award, 30);
});

test("resolveRewardProfile preserves custom event rates", () => {
  const profile = resolveRewardProfile({ impactCreditsBase: 25 });

  assert.equal(profile.reward_tier, null);
  assert.equal(profile.reward_tier_label, "Custom");
  assert.equal(profile.impact_credits_rate, 25);
  assert.equal(profile.reward_source, "event_custom_rate");
  assert.equal(deriveRewardTierFromRate(25), null);
});

test("addRewardPresentation decorates events with hourly reward metadata", () => {
  const decorated = addRewardPresentation({
    id: "evt-1",
    impact_credits_base: 20,
    start_at: "2026-04-07T17:00:00.000Z",
    end_at: "2026-04-07T18:30:00.000Z",
  });

  assert.equal(decorated.reward_tier, "specialist");
  assert.equal(decorated.impact_credits_rate, 20);
  assert.equal(decorated.impact_credits_estimate, 30);
  assert.equal(decorated.reward_duration_hours, 1.5);
});
