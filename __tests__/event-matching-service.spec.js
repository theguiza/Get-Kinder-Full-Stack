import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { executeToolCall } from "../Backend/services/kai-tool-executor.js";
import { getMatchedEventsForUser, scoreMatchedEvent, summarizeMatchContext } from "../services/eventMatchingService.js";

function createMatchingHarness({
  userPreferences,
  profileRows = [],
  events = [],
  rsvps = [],
}) {
  const originalQuery = pool.query;
  const queryLog = [];

  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();
    queryLog.push(trimmed);

    if (
      trimmed.includes("SELECT") &&
      trimmed.includes("interest1") &&
      trimmed.includes("home_base_label") &&
      trimmed.includes("FROM userdata")
    ) {
      const [userId] = params;
      if (!userPreferences || String(userPreferences.id) !== String(userId)) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          interest1: userPreferences.interest1 ?? null,
          interest2: userPreferences.interest2 ?? null,
          interest3: userPreferences.interest3 ?? null,
          home_base_label: userPreferences.home_base_label ?? null,
        }],
        rowCount: 1,
      };
    }

    if (
      trimmed.includes("FROM information_schema.columns") &&
      trimmed.includes("table_name = 'event_rsvps'") &&
      trimmed.includes("column_name = 'no_show'")
    ) {
      return { rows: [{ exists: true }], rowCount: 1 };
    }

    if (
      trimmed.includes("FROM wallet_transactions") &&
      trimmed.includes("AS credits") &&
      trimmed.includes("AS debits") &&
      !trimmed.includes("AS donated")
    ) {
      return { rows: [{ credits: 0, debits: 0 }], rowCount: 1 };
    }

    if (
      trimmed.includes("FROM event_rsvps r") &&
      trimmed.includes("JOIN events e ON e.id = r.event_id") &&
      trimmed.includes("r.verification_status")
    ) {
      const [userId] = params;
      const rows = profileRows
        .filter((row) => String(row.attendee_user_id) === String(userId))
        .map((row) => ({
          event_id: row.event_id,
          verification_status: row.verification_status ?? null,
          attended_minutes: row.attended_minutes ?? null,
          verified_at: row.verified_at ?? null,
          rsvp_status: row.rsvp_status ?? null,
          no_show: row.no_show ?? false,
          title: row.title,
          start_at: row.start_at,
          end_at: row.end_at ?? null,
          location_text: row.location_text ?? null,
          org_name: row.org_name ?? null,
          community_tag: row.community_tag ?? null,
          event_status: row.event_status ?? "published",
        }))
        .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
        .slice(0, 50);
      return { rows, rowCount: rows.length };
    }

    if (
      trimmed.includes("FROM events e") &&
      trimmed.includes("LEFT JOIN userdata creator") &&
      trimmed.includes("ORDER BY COALESCE(e.start_at, 'infinity'::timestamptz) ASC")
    ) {
      const limit = Number(params[params.length - 1]) || 0;
      const now = Date.now();
      const rows = events
        .filter((event) => event.status === "published")
        .filter((event) => {
          const endOrStart = event.end_at || event.start_at;
          return new Date(endOrStart).getTime() >= now - 2 * 60 * 60 * 1000;
        })
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
        .slice(0, limit)
        .map((event) => ({
          ...event,
          org_id: null,
          org_rating_value: null,
          org_rating_count: 0,
          rsvp_accepted: rsvps.filter(
            (row) =>
              String(row.event_id) === String(event.id) &&
              (row.status === "accepted" || row.status === "checked_in"),
          ).length,
        }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unhandled matching query: ${trimmed}`);
  };

  return {
    queryLog,
    restore() {
      pool.query = originalQuery;
    },
  };
}

function createEvent(overrides = {}) {
  return {
    id: overrides.id || "evt-default",
    title: overrides.title || "Untitled Event",
    category: overrides.category ?? null,
    description: overrides.description ?? null,
    safety_notes: overrides.safety_notes ?? null,
    start_at: overrides.start_at,
    end_at: overrides.end_at ?? null,
    tz: overrides.tz ?? "America/Vancouver",
    location_text: overrides.location_text ?? null,
    org_name: overrides.org_name ?? null,
    community_tag: overrides.community_tag ?? null,
    cause_tags: overrides.cause_tags ?? [],
    requirements: overrides.requirements ?? null,
    verification_method: overrides.verification_method ?? "host_attest",
    impact_credits_base: overrides.impact_credits_base ?? 25,
    reliability_weight: overrides.reliability_weight ?? 1,
    funding_pool_slug: overrides.funding_pool_slug ?? "general",
    capacity: overrides.capacity ?? null,
    waitlist_enabled: overrides.waitlist_enabled ?? true,
    cover_url: overrides.cover_url ?? null,
    attendance_methods: overrides.attendance_methods ?? ["host_code"],
    status: overrides.status ?? "published",
    creator_user_id: overrides.creator_user_id ?? "host-1",
  };
}

test("KAI matched events ranks grounded matches, excludes current RSVPs, and stays read-only", async () => {
  const now = Date.now();
  const harness = createMatchingHarness({
    userPreferences: {
      id: "user-match-1",
      interest1: "Environment",
      interest2: "Food security",
      interest3: "",
      home_base_label: "Victoria, BC",
    },
    profileRows: [
      {
        attendee_user_id: "user-match-1",
        event_id: "evt-committed",
        verification_status: null,
        rsvp_status: "accepted",
        title: "Already Committed Cleanup",
        start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
        location_text: "Victoria, BC",
        org_name: "Ocean Org",
        community_tag: "Victoria",
        event_status: "published",
      },
      {
        attendee_user_id: "user-match-1",
        event_id: "evt-history-1",
        verification_status: "verified",
        attended_minutes: 120,
        verified_at: new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(),
        rsvp_status: "checked_in",
        title: "Past Victoria Serve",
        start_at: new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now - 14 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        location_text: "Victoria, BC",
        org_name: "Neighbourhood Org",
        community_tag: "Victoria",
        event_status: "published",
      },
    ],
    events: [
      createEvent({
        id: "evt-best",
        title: "Victoria Shoreline Cleanup",
        category: "Environment",
        description: "Help restore the shoreline.",
        start_at: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        location_text: "Victoria, BC",
        org_name: "Ocean Org",
        community_tag: "Victoria",
        cause_tags: ["Environment"],
        capacity: 20,
      }),
      createEvent({
        id: "evt-second",
        title: "Food Packing Night",
        category: "Food Security",
        description: "Pack meals for families.",
        start_at: new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 5 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        location_text: "Victoria, BC",
        org_name: "Food Org",
        community_tag: "Victoria",
        cause_tags: ["Food Security"],
        capacity: 25,
      }),
      createEvent({
        id: "evt-committed",
        title: "Already Committed Cleanup",
        category: "Environment",
        start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
        location_text: "Victoria, BC",
        org_name: "Ocean Org",
        community_tag: "Victoria",
        cause_tags: ["Environment"],
        capacity: 20,
      }),
      createEvent({
        id: "evt-cancelled",
        title: "Cancelled Match",
        category: "Environment",
        start_at: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString(),
        location_text: "Victoria, BC",
        community_tag: "Victoria",
        cause_tags: ["Environment"],
        status: "cancelled",
      }),
    ],
    rsvps: [
      { event_id: "evt-best", attendee_user_id: "other-user", status: "accepted" },
      { event_id: "evt-second", attendee_user_id: "other-user", status: "checked_in" },
    ],
  });

  try {
    const result = await executeToolCall(
      "get_matched_events",
      { days_ahead: 14, limit: 5, min_score: 30 },
      "user-match-1",
    );

    assert.equal(result.status, "success");
    assert.deepEqual(result.events.map((row) => row.id), ["evt-best", "evt-second"]);
    assert.equal(result.events[0].match_score > result.events[1].match_score, true);
    assert.match(result.summary, /Ranked 2 events/i);
    assert.equal(result.intro, result.summary);
    assert.equal(result.personalization.signal_strength, "strong");
    assert.deepEqual(result.personalization.interests, ["environment", "food security"]);
    assert.deepEqual(result.personalization.recent_communities, ["Victoria"]);
    assert.ok(result.events[0].match_reasons.some((reason) => reason.includes("saved interests")));
    assert.ok(result.events[0].match_reasons.some((reason) => reason.includes("home base")));
    assert.ok(result.events[0].match_reasons.some((reason) => reason.includes("Happening soon")));
    assert.ok(result.queryLog === undefined);
    assert.equal(
      harness.queryLog.some((sql) => /^(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)),
      false,
    );
  } finally {
    harness.restore();
  }
});

test("matched event service returns sane empty results when no event clears the threshold", async () => {
  const now = Date.now();
  const harness = createMatchingHarness({
    userPreferences: {
      id: "user-match-2",
      interest1: "Animal welfare",
      interest2: "",
      interest3: "",
      home_base_label: "Victoria, BC",
    },
    profileRows: [],
    events: [
      createEvent({
        id: "evt-low-signal",
        title: "Far Future Opportunity",
        category: "General",
        start_at: new Date(now + 40 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 40 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        location_text: "Nanaimo, BC",
        community_tag: "Nanaimo",
      }),
    ],
  });

  try {
    const result = await getMatchedEventsForUser({
      userId: "user-match-2",
      daysAhead: 60,
      limit: 5,
      minScore: 40,
    });

    assert.equal(result.status, "success");
    assert.equal(result.personalization.signal_strength, "strong");
    assert.deepEqual(result.events, []);
    assert.match(result.summary, /No strong matches found right now/i);
  } finally {
    harness.restore();
  }
});

test("matched event service falls back honestly to broader upcoming opportunities when preference signals are weak", async () => {
  const now = Date.now();
  const harness = createMatchingHarness({
    userPreferences: {
      id: "user-match-weak",
      interest1: "",
      interest2: "",
      interest3: "",
      home_base_label: "",
    },
    profileRows: [],
    events: [
      createEvent({
        id: "evt-general-soon",
        title: "Community Garden Shift",
        category: "Community",
        start_at: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        location_text: "Nanaimo, BC",
        community_tag: "Nanaimo",
        capacity: 12,
      }),
    ],
  });

  try {
    const result = await getMatchedEventsForUser({
      userId: "user-match-weak",
      daysAhead: 14,
      limit: 5,
      minScore: 40,
    });

    assert.equal(result.status, "success");
    assert.equal(result.personalization.signal_strength, "weak");
    assert.equal(result.fallback_mode, "broad_upcoming");
    assert.match(result.summary, /broader upcoming opportunities/i);
    assert.deepEqual(result.events.map((row) => row.id), ["evt-general-soon"]);
    assert.equal(result.events[0].match_reasons.some((reason) => /saved interests|home base|recently/i.test(reason)), false);
  } finally {
    harness.restore();
  }
});

test("matched event service breaks ties deterministically by start time then id", async () => {
  const now = Date.now();
  const harness = createMatchingHarness({
    userPreferences: {
      id: "user-match-3",
      interest1: "Environment",
      interest2: "",
      interest3: "",
      home_base_label: "",
    },
    profileRows: [],
    events: [
      createEvent({
        id: "evt-b",
        title: "Environment Shift B",
        category: "Environment",
        start_at: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        cause_tags: ["Environment"],
      }),
      createEvent({
        id: "evt-a",
        title: "Environment Shift A",
        category: "Environment",
        start_at: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
        cause_tags: ["Environment"],
      }),
    ],
  });

  try {
    const result = await getMatchedEventsForUser({
      userId: "user-match-3",
      daysAhead: 14,
      limit: 5,
      minScore: 0,
    });

    assert.deepEqual(result.events.map((row) => row.id), ["evt-a", "evt-b"]);
    assert.equal(result.events[0].rank, 1);
    assert.equal(result.events[1].rank, 2);
  } finally {
    harness.restore();
  }
});

test("scoreMatchedEvent excludes full no-waitlist events and explains waitlisted matches", () => {
  const now = Date.now();
  const context = {
    interestPhrases: ["environment"],
    interestTokens: ["environment"],
    homeBaseLabel: "Victoria, BC",
    homeBaseTokens: ["victoria", "bc"],
    recentCommunityTokens: ["victoria"],
    committedEventIds: new Set(),
  };

  const blocked = scoreMatchedEvent(
    {
      id: "evt-full",
      title: "Full Event",
      category: "Environment",
      start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
      location_text: "Victoria, BC",
      community_tag: "Victoria",
      cause_tags: ["Environment"],
      capacity: 10,
      waitlist_enabled: false,
      rsvp_counts: { accepted: 10 },
    },
    context,
    now,
  );
  assert.equal(blocked.include, false);
  assert.equal(blocked.exclusion_reason, "event_full");

  const waitlisted = scoreMatchedEvent(
    {
      id: "evt-waitlist",
      title: "Waitlist Event",
      category: "Environment",
      start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
      location_text: "Victoria, BC",
      community_tag: "Victoria",
      cause_tags: ["Environment"],
      capacity: 10,
      waitlist_enabled: true,
      rsvp_counts: { accepted: 10 },
    },
    context,
    now,
  );
  assert.equal(waitlisted.include, true);
  assert.ok(waitlisted.reasons.some((reason) => reason.includes("waitlist")));
});

test("summarizeMatchContext stays compact and bounded", () => {
  const summary = summarizeMatchContext({
    interestPhrases: ["environment", "food security", "youth mentoring", "extra interest"],
    homeBaseLabel: "Victoria, BC",
    recentCommunities: ["Victoria", "Burnaby", "Richmond", "Langford"],
    committedEventIds: new Set(["a", "b", "c"]),
  });

  assert.equal(summary.signal_strength, "strong");
  assert.deepEqual(summary.interests, ["environment", "food security", "youth mentoring"]);
  assert.deepEqual(summary.recent_communities, ["Victoria", "Burnaby", "Richmond"]);
  assert.equal(summary.upcoming_commitment_count, 3);
  assert.ok(JSON.stringify(summary).length < 300);
});
