export const ROLE_TIER_RATES = Object.freeze({
  standard: 10,
  skilled: 15,
  specialist: 20,
  leadership: 30,
});

export const ROLE_TIER_LABELS = Object.freeze({
  standard: "Helper",
  skilled: "Skilled",
  specialist: "Specialist",
  leadership: "Lead",
});

const ROLE_TIER_ALIASES = Object.freeze({
  helper: "standard",
  lead: "leadership",
});

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function roundToTenth(value) {
  const num = toFiniteNumber(value);
  return num === null ? null : Math.round(num * 10) / 10;
}

export function normalizeRewardTier(value, fallback = "standard") {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return fallback;
  const normalized = ROLE_TIER_ALIASES[raw] || raw;
  return Object.prototype.hasOwnProperty.call(ROLE_TIER_RATES, normalized) ? normalized : fallback;
}

export function getTierRate(value, fallback = ROLE_TIER_RATES.standard) {
  const tier = normalizeRewardTier(value, null);
  if (tier && Object.prototype.hasOwnProperty.call(ROLE_TIER_RATES, tier)) {
    return ROLE_TIER_RATES[tier];
  }
  const numericFallback = toFiniteNumber(fallback);
  return numericFallback !== null && numericFallback > 0 ? Math.trunc(numericFallback) : ROLE_TIER_RATES.standard;
}

export function deriveRewardTierFromRate(value) {
  const rate = toFiniteNumber(value);
  if (rate === null) return null;
  const match = Object.entries(ROLE_TIER_RATES).find(([, tierRate]) => tierRate === Math.trunc(rate));
  return match?.[0] || null;
}

export function computeRewardDurationMinutes({ attendedMinutes = null, startAt = null, endAt = null } = {}) {
  const explicitMinutes = toFiniteNumber(attendedMinutes);
  if (explicitMinutes !== null && explicitMinutes > 0) {
    return Math.trunc(explicitMinutes);
  }
  if (!startAt || !endAt) return null;
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return diffMinutes > 0 ? diffMinutes : null;
}

export function resolveRewardProfile({ roleTier = null, impactCreditsBase = null } = {}) {
  const normalizedRoleTier = normalizeRewardTier(roleTier, null);
  if (normalizedRoleTier) {
    return {
      reward_model: "tier_hourly",
      reward_tier: normalizedRoleTier,
      reward_tier_label: ROLE_TIER_LABELS[normalizedRoleTier] || "Helper",
      impact_credits_rate: ROLE_TIER_RATES[normalizedRoleTier],
      reward_source: "role_tier",
    };
  }

  const baseRate = toFiniteNumber(impactCreditsBase);
  if (baseRate !== null && baseRate > 0) {
    const normalizedRate = Math.trunc(baseRate);
    const derivedTier = deriveRewardTierFromRate(normalizedRate);
    return {
      reward_model: "tier_hourly",
      reward_tier: derivedTier,
      reward_tier_label: derivedTier ? ROLE_TIER_LABELS[derivedTier] : "Custom",
      impact_credits_rate: normalizedRate,
      reward_source: derivedTier ? "event_tier_rate" : "event_custom_rate",
    };
  }

  return {
    reward_model: "tier_hourly",
    reward_tier: "standard",
    reward_tier_label: ROLE_TIER_LABELS.standard,
    impact_credits_rate: ROLE_TIER_RATES.standard,
    reward_source: "default_standard",
  };
}

export function computeVolunteerReward({
  roleTier = null,
  impactCreditsBase = null,
  attendedMinutes = null,
  startAt = null,
  endAt = null,
} = {}) {
  const profile = resolveRewardProfile({ roleTier, impactCreditsBase });
  const durationMinutes = computeRewardDurationMinutes({ attendedMinutes, startAt, endAt });
  if (!durationMinutes || durationMinutes <= 0) {
    return {
      ...profile,
      duration_minutes: 0,
      duration_hours: 0,
      impact_credits_award: 0,
      impact_credits_estimate: 0,
    };
  }

  const durationHoursRaw = durationMinutes / 60;
  const award = Math.max(1, Math.round(durationHoursRaw * profile.impact_credits_rate));

  return {
    ...profile,
    duration_minutes: durationMinutes,
    duration_hours: roundToTenth(durationHoursRaw) ?? 0,
    impact_credits_award: award,
    impact_credits_estimate: award,
  };
}

export function addRewardPresentation(event = {}) {
  const reward = computeVolunteerReward({
    impactCreditsBase: event?.impact_credits_base,
    startAt: event?.start_at,
    endAt: event?.end_at,
  });

  return {
    ...event,
    reward_model: reward.reward_model,
    reward_tier: reward.reward_tier,
    reward_tier_label: reward.reward_tier_label,
    impact_credits_rate: reward.impact_credits_rate,
    impact_credits_estimate: reward.impact_credits_estimate,
    reward_duration_hours: reward.duration_hours,
  };
}
