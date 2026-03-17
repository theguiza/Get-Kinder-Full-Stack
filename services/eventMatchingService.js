import { fetchEvents } from "./eventsService.js";
import { getVolunteerPreferenceSignals, getVolunteerStats } from "./profileService.js";

const DEFAULT_DAYS_AHEAD = 14;
const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SCORE = 30;
const MAX_EVENT_CANDIDATES = 100;
const MAX_CONTEXT_ITEMS = 3;

function clampNumber(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  const num = Number(value);
  const normalized = Number.isFinite(num) ? num : fallback;
  return Math.min(max, Math.max(min, normalized));
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized.split(" ").filter((token) => token.length > 1);
}

function unique(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function countTokenOverlap(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  const bSet = new Set(b);
  return a.reduce((count, token) => count + (bSet.has(token) ? 1 : 0), 0);
}

function includesNormalized(haystack, needle) {
  return Boolean(haystack && needle) && (haystack.includes(needle) || needle.includes(haystack));
}

function buildMatchContext({ preferences = {}, volunteerStats = {} } = {}) {
  const interestPhrases = unique(
    Array.isArray(preferences?.interests)
      ? preferences.interests.map((value) => normalizeText(value)).filter(Boolean)
      : []
  );
  const interestTokens = unique(interestPhrases.flatMap((value) => tokenize(value)));
  const homeBaseLabel = preferences?.home_base_label ? String(preferences.home_base_label).trim() : null;
  const homeBaseTokens = unique(tokenize(homeBaseLabel));
  const recentCommunities = unique(
    []
      .concat(Array.isArray(volunteerStats?.recent_history) ? volunteerStats.recent_history : [])
      .concat(Array.isArray(volunteerStats?.upcoming) ? volunteerStats.upcoming : [])
      .map((row) => (typeof row?.community_tag === "string" ? row.community_tag.trim() : ""))
      .filter(Boolean)
  );
  const recentCommunityTokens = unique(
    recentCommunities.flatMap((value) => tokenize(value))
  );
  const committedEventIds = new Set(
    (Array.isArray(volunteerStats?.upcoming) ? volunteerStats.upcoming : [])
      .map((row) => row?.event_id)
      .filter(Boolean)
      .map((value) => String(value))
  );

  return {
    interestPhrases,
    interestTokens,
    homeBaseLabel,
    homeBaseTokens,
    recentCommunities,
    recentCommunityTokens,
    committedEventIds,
  };
}

export function summarizeMatchContext(context = {}) {
  const interests = unique(Array.isArray(context.interestPhrases) ? context.interestPhrases : [])
    .slice(0, MAX_CONTEXT_ITEMS);
  const recentCommunities = unique(Array.isArray(context.recentCommunities) ? context.recentCommunities : [])
    .slice(0, MAX_CONTEXT_ITEMS);
  const upcomingCommitmentCount = context?.committedEventIds instanceof Set ? context.committedEventIds.size : 0;

  let signalStrength = "weak";
  if (interests.length > 0 || recentCommunities.length > 0 || context?.homeBaseLabel) {
    signalStrength = "moderate";
  }
  if (interests.length > 0 && (recentCommunities.length > 0 || context?.homeBaseLabel)) {
    signalStrength = "strong";
  }

  return {
    signal_strength: signalStrength,
    interests,
    home_base_label: context?.homeBaseLabel || null,
    recent_communities: recentCommunities,
    upcoming_commitment_count: upcomingCommitmentCount,
  };
}

function sortCandidateRows(rows = []) {
  return rows.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aStart = a.event?.start_at ? new Date(a.event.start_at).getTime() : Number.POSITIVE_INFINITY;
    const bStart = b.event?.start_at ? new Date(b.event.start_at).getTime() : Number.POSITIVE_INFINITY;
    if (aStart !== bStart) return aStart - bStart;
    return String(a.event?.id || "").localeCompare(String(b.event?.id || ""));
  });
}

function buildEventSignals(event) {
  const eventTags = unique(
    [event?.category]
      .concat(Array.isArray(event?.cause_tags) ? event.cause_tags : [])
      .map((value) => normalizeText(value))
      .filter(Boolean)
  );
  const eventTagTokens = unique(eventTags.flatMap((value) => tokenize(value)));
  const eventSearchText = normalizeText(
    [
      event?.title,
      event?.description,
      event?.org_name,
      event?.community_tag,
      event?.location_text,
      event?.category,
      ...(Array.isArray(event?.cause_tags) ? event.cause_tags : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
  const eventLocationTokens = unique(
    tokenize([event?.location_text, event?.community_tag].filter(Boolean).join(" "))
  );
  return {
    eventTags,
    eventTagTokens,
    eventSearchText,
    eventLocationTokens,
  };
}

export function scoreMatchedEvent(event, context, now = Date.now()) {
  const details = [];
  const eventSignals = buildEventSignals(event);
  const endOrStartAt = event?.end_at || event?.start_at;
  const endOrStartMs = endOrStartAt ? new Date(endOrStartAt).getTime() : Number.NaN;
  const startMs = event?.start_at ? new Date(event.start_at).getTime() : Number.NaN;
  const capacity = Number(event?.capacity);
  const acceptedCount = Number(event?.rsvp_counts?.accepted) || 0;
  const hasCapacity = Number.isFinite(capacity) && capacity > 0;
  const isFull = hasCapacity && acceptedCount >= capacity;
  const alreadyCommitted = context.committedEventIds.has(String(event?.id || ""));

  if (alreadyCommitted) {
    return {
      include: false,
      score: 0,
      reasons: [],
      exclusion_reason: "already_rsvped",
    };
  }

  if (Number.isFinite(endOrStartMs) && endOrStartMs < now) {
    return {
      include: false,
      score: 0,
      reasons: [],
      exclusion_reason: "event_no_longer_active",
    };
  }

  if (isFull && event?.waitlist_enabled === false) {
    return {
      include: false,
      score: 0,
      reasons: [],
      exclusion_reason: "event_full",
    };
  }

  let score = 15;

  const matchedInterests = context.interestPhrases.filter((phrase) =>
    includesNormalized(eventSignals.eventSearchText, phrase) ||
    eventSignals.eventTags.some((tag) => includesNormalized(tag, phrase))
  );
  if (matchedInterests.length > 0) {
    score += 30 + Math.min(2, matchedInterests.length - 1) * 5;
    details.push({
      weight: 35,
      text: `Matches your saved interests: ${matchedInterests.slice(0, 2).join(", ")}`,
    });
  } else {
    const tokenOverlap = countTokenOverlap(context.interestTokens, eventSignals.eventTagTokens);
    if (tokenOverlap > 0) {
      score += Math.min(20, tokenOverlap * 10);
      details.push({
        weight: 20,
        text: "Overlaps with your saved interest keywords",
      });
    }
  }

  const locationOverlap = countTokenOverlap(context.homeBaseTokens, eventSignals.eventLocationTokens);
  if (locationOverlap > 0 && context.homeBaseLabel) {
    score += 12;
    details.push({
      weight: 12,
      text: `Near your home base: ${context.homeBaseLabel}`,
    });
  }

  const communityOverlap = countTokenOverlap(context.recentCommunityTokens, eventSignals.eventLocationTokens);
  if (communityOverlap > 0) {
    score += 10;
    details.push({
      weight: 10,
      text: "Similar community to places you've volunteered recently",
    });
  }

  if (Number.isFinite(startMs)) {
    if (startMs <= now) {
      score += 14;
      details.push({ weight: 14, text: "Already underway or starting now" });
    } else {
      const daysUntilStart = (startMs - now) / (24 * 60 * 60 * 1000);
      if (daysUntilStart <= 3) {
        score += 15;
        details.push({ weight: 15, text: "Happening soon" });
      } else if (daysUntilStart <= 14) {
        score += 10;
        details.push({ weight: 10, text: "Coming up in the next two weeks" });
      } else if (daysUntilStart <= 30) {
        score += 5;
        details.push({ weight: 5, text: "Upcoming this month" });
      }
    }
  }

  if (isFull && event?.waitlist_enabled !== false) {
    score -= 8;
    details.push({ weight: 2, text: "Currently full, but waitlist is open" });
  } else {
    score += 8;
    details.push({ weight: 8, text: "Spots available" });
  }

  let reasons = details
    .sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text))
    .slice(0, 3)
    .map((detail) => detail.text);

  const waitlistReason = details.find((detail) => detail.text.includes("waitlist"))?.text || null;
  if (waitlistReason && !reasons.includes(waitlistReason)) {
    reasons = reasons.slice(0, 2).concat(waitlistReason);
  }

  return {
    include: true,
    score,
    reasons,
    exclusion_reason: null,
  };
}

export async function getMatchedEventsForUser({
  userId,
  daysAhead = DEFAULT_DAYS_AHEAD,
  limit = DEFAULT_LIMIT,
  minScore = DEFAULT_MIN_SCORE,
} = {}) {
  if (!userId) {
    return {
      status: "error",
      message: "User is required for this tool.",
    };
  }

  const safeDaysAhead = clampNumber(daysAhead, DEFAULT_DAYS_AHEAD, { min: 1, max: 365 });
  const safeLimit = clampNumber(limit, DEFAULT_LIMIT, { min: 1, max: 20 });
  const safeMinScore = clampNumber(minScore, DEFAULT_MIN_SCORE, { min: 0, max: 100 });

  const [preferences, volunteerStats, feedResult] = await Promise.all([
    getVolunteerPreferenceSignals(userId),
    getVolunteerStats(userId),
    fetchEvents({ view: "upcoming", limit: MAX_EVENT_CANDIDATES }),
  ]);

  const context = buildMatchContext({ preferences, volunteerStats });
  const personalization = summarizeMatchContext(context);
  const now = Date.now();
  const scoredRows = (Array.isArray(feedResult?.events) ? feedResult.events : [])
    .filter((event) => {
      const startMs = event?.start_at ? new Date(event.start_at).getTime() : Number.NaN;
      if (Number.isNaN(startMs)) return false;
      return startMs <= now + safeDaysAhead * 24 * 60 * 60 * 1000;
    })
    .map((event) => {
      const match = scoreMatchedEvent(event, context, now);
      return {
        event,
        score: match.score,
        reasons: match.reasons,
        include: match.include,
        exclusion_reason: match.exclusion_reason,
      };
    });

  let fallbackMode = null;
  let selectedRows = sortCandidateRows(
    scoredRows.filter((row) => row.include && row.score >= safeMinScore)
  );

  if (selectedRows.length === 0 && personalization.signal_strength === "weak") {
    fallbackMode = "broad_upcoming";
    selectedRows = sortCandidateRows(scoredRows.filter((row) => row.include));
  }

  const candidates = selectedRows
    .slice(0, safeLimit)
    .map((row, index) => ({
      rank: index + 1,
      match_score: row.score,
      match_reasons: row.reasons,
      ...row.event,
    }));

  const signalsUsed = [
    "saved interests",
    "home base / community text overlap",
    "recent volunteering community history",
    "upcoming timing",
    "existing RSVP exclusion",
    "capacity and waitlist status",
  ];

  const summary = candidates.length > 0
    ? fallbackMode === "broad_upcoming"
      ? `I do not have strong saved preference signals yet, so these are broader upcoming opportunities ranked by timing, availability, and your current commitments.`
      : `Ranked ${candidates.length} event${candidates.length === 1 ? "" : "s"} using your saved interests, recent volunteering history, location cues, timing, and RSVP status.`
    : personalization.signal_strength === "weak"
      ? "I do not have strong saved preference signals yet, and there are no strong upcoming opportunities in this window. Try widening the date range or adding volunteer interests."
      : "No strong matches found right now. Try widening the date range or updating your volunteer interests.";

  return {
    status: "success",
    summary,
    intro: summary,
    signals_used: signalsUsed,
    personalization,
    fallback_mode: fallbackMode,
    events: candidates,
  };
}
