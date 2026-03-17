import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { executeToolCall } from "../Backend/services/kai-tool-executor.js";
import { getVolunteerStats } from "../services/profileService.js";
import { getSummary as getRatingsSummary } from "../services/ratingsService.js";
import { getWalletSummary } from "../services/walletService.js";

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function createProfileHarness({
  user,
  walletTransactions = [],
  ratings = [],
  portfolioRows = [],
  hasNoShowColumn = true,
}) {
  const originalQuery = pool.query;

  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();

    if (
      trimmed.includes("SELECT") &&
      trimmed.includes("firstname") &&
      trimmed.includes("FROM userdata")
    ) {
      const [userId] = params;
      if (!user || String(user.id) !== String(userId)) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{
          id: user.id,
          firstname: user.firstname,
          lastname: user.lastname,
          email: user.email,
          home_base_label: user.home_base_label ?? null,
          created_at: user.created_at ?? null,
        }],
        rowCount: 1,
      };
    }

    if (
      trimmed.includes("FROM information_schema.columns") &&
      trimmed.includes("table_name = 'event_rsvps'") &&
      trimmed.includes("column_name = 'no_show'")
    ) {
      return {
        rows: hasNoShowColumn ? [{ exists: true }] : [],
        rowCount: hasNoShowColumn ? 1 : 0,
      };
    }

    if (
      trimmed.includes("FROM wallet_transactions") &&
      trimmed.includes("AS credits") &&
      trimmed.includes("AS debits") &&
      !trimmed.includes("AS donated")
    ) {
      const [userId] = params;
      const rows = walletTransactions.filter((row) => String(row.user_id) === String(userId));
      const credits = rows
        .filter((row) => row.direction === "credit")
        .reduce((sum, row) => sum + toNumber(row.kind_amount), 0);
      const debits = rows
        .filter((row) => row.direction === "debit")
        .reduce((sum, row) => sum + toNumber(row.kind_amount), 0);
      return {
        rows: [{ credits, debits }],
        rowCount: 1,
      };
    }

    if (
      trimmed.includes("FROM wallet_transactions") &&
      trimmed.includes("AS credits") &&
      trimmed.includes("AS debits") &&
      trimmed.includes("AS donated")
    ) {
      const [userId] = params;
      const rows = walletTransactions.filter((row) => String(row.user_id) === String(userId));
      const credits = rows
        .filter((row) => row.direction === "credit")
        .reduce((sum, row) => sum + toNumber(row.kind_amount), 0);
      const debits = rows
        .filter((row) => row.direction === "debit")
        .reduce((sum, row) => sum + toNumber(row.kind_amount), 0);
      const donated = rows
        .filter((row) => row.direction === "debit" && row.reason === "donate")
        .reduce((sum, row) => sum + toNumber(row.kind_amount), 0);
      return {
        rows: [{ credits, debits, donated }],
        rowCount: 1,
      };
    }

    if (
      trimmed.includes("FROM event_rsvps r") &&
      trimmed.includes("JOIN events e ON e.id = r.event_id") &&
      trimmed.includes("r.verification_status")
    ) {
      const [userId] = params;
      const rows = portfolioRows
        .filter((row) => String(row.attendee_user_id) === String(userId))
        .map((row) => ({
          event_id: row.event_id,
          verification_status: row.verification_status ?? null,
          attended_minutes: row.attended_minutes ?? null,
          verified_at: row.verified_at ?? null,
          rsvp_status: row.rsvp_status ?? null,
          no_show: row.no_show ?? null,
          title: row.title,
          start_at: row.start_at,
          end_at: row.end_at,
          location_text: row.location_text ?? null,
          org_name: row.org_name ?? null,
          community_tag: row.community_tag ?? null,
          event_status: row.event_status ?? null,
        }))
        .sort((a, b) => {
          const aTime = a.start_at ? new Date(a.start_at).getTime() : 0;
          const bTime = b.start_at ? new Date(b.start_at).getTime() : 0;
          return bTime - aTime;
        })
        .slice(0, 50);
      return { rows, rowCount: rows.length };
    }

    if (
      trimmed.includes("FROM event_ratings") &&
      trimmed.includes("ratee_user_id = $1") &&
      trimmed.includes("ratee_role = 'volunteer'")
    ) {
      const [userId, limit] = params;
      const rows = ratings
        .filter((row) => String(row.ratee_user_id) === String(userId) && row.ratee_role === "volunteer")
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, Number(limit) || 20);
      const cnt = rows.length;
      const avg = cnt
        ? rows.reduce((sum, row) => sum + toNumber(row.stars), 0) / cnt
        : null;
      return {
        rows: [{ avg, cnt }],
        rowCount: 1,
      };
    }

    throw new Error(`Unhandled profile query: ${trimmed}`);
  };

  return {
    restore() {
      pool.query = originalQuery;
    },
  };
}

test("KAI get_user_profile reflects canonical profile, ratings, and wallet services", async () => {
  const harness = createProfileHarness({
    user: {
      id: "user-profile-1",
      firstname: "Kai",
      lastname: "Volunteer",
      email: "kai@example.com",
      home_base_label: "Victoria, BC",
      created_at: "2024-01-05T12:00:00.000Z",
    },
    walletTransactions: [
      { user_id: "user-profile-1", direction: "credit", kind_amount: 100, reason: "earn_shift" },
      { user_id: "user-profile-1", direction: "debit", kind_amount: 20, reason: "donate" },
      { user_id: "someone-else", direction: "credit", kind_amount: 999, reason: "earn_shift" },
    ],
    ratings: [
      { ratee_user_id: "user-profile-1", ratee_role: "volunteer", stars: 5, created_at: "2025-03-20T12:00:00.000Z" },
      { ratee_user_id: "user-profile-1", ratee_role: "volunteer", stars: 4, created_at: "2025-03-13T12:00:00.000Z" },
      { ratee_user_id: "user-profile-1", ratee_role: "organization", stars: 1, created_at: "2025-03-21T12:00:00.000Z" },
    ],
    portfolioRows: [
      {
        attendee_user_id: "user-profile-1",
        event_id: "evt-past-2",
        verification_status: "verified",
        attended_minutes: 90,
        verified_at: "2025-03-20T12:00:00.000Z",
        rsvp_status: "checked_in",
        no_show: false,
        title: "Community Garden",
        start_at: "2025-03-20T17:00:00.000Z",
        end_at: "2025-03-20T18:30:00.000Z",
        location_text: "Garden",
        org_name: "Green Org",
        community_tag: "Environment",
        event_status: "published",
      },
      {
        attendee_user_id: "user-profile-1",
        event_id: "evt-past-1",
        verification_status: "verified",
        attended_minutes: 120,
        verified_at: "2025-03-13T12:00:00.000Z",
        rsvp_status: "accepted",
        no_show: false,
        title: "Food Bank Shift",
        start_at: "2025-03-13T17:00:00.000Z",
        end_at: "2025-03-13T19:00:00.000Z",
        location_text: "Food Bank",
        org_name: "Food Org",
        community_tag: "Food Security",
        event_status: "published",
      },
      {
        attendee_user_id: "user-profile-1",
        event_id: "evt-upcoming-1",
        verification_status: null,
        attended_minutes: null,
        verified_at: null,
        rsvp_status: "waitlisted",
        no_show: false,
        title: "Future Cleanup",
        start_at: "2099-03-25T17:00:00.000Z",
        end_at: "2099-03-25T19:00:00.000Z",
        location_text: "Beach",
        org_name: "Ocean Org",
        community_tag: "Environment",
        event_status: "published",
      },
    ],
  });

  try {
    const [expectedStats, expectedRatings, expectedWallet, result] = await Promise.all([
      getVolunteerStats("user-profile-1"),
      getRatingsSummary({ userId: "user-profile-1", limit: 20 }),
      getWalletSummary({ userId: "user-profile-1" }),
      executeToolCall("get_user_profile", {}, "user-profile-1"),
    ]);

    assert.equal(result.status, "success");
    assert.equal(result.profile.user_id, "user-profile-1");
    assert.equal(result.profile.firstname, "Kai");
    assert.equal(result.profile.lastname, "Volunteer");
    assert.equal(result.profile.email, "kai@example.com");
    assert.equal(result.profile.home_base_label, "Victoria, BC");
    assert.equal(result.profile.member_since, "2024-01-05T12:00:00.000Z");
    assert.equal(result.profile.ic_balance, expectedWallet.balance);
    assert.deepEqual(result.profile.wallet_summary, expectedWallet);
    assert.equal(result.profile.verified_minutes_total, expectedStats.verified_minutes_total);
    assert.equal(result.profile.verified_hours_total, expectedStats.verified_hours_total);
    assert.equal(result.profile.verified_shifts_total, expectedStats.verified_shifts_total);
    assert.equal(result.profile.streak_weeks, expectedStats.streak_weeks);
    assert.equal(result.profile.reliability_score, expectedStats.reliability_score);
    assert.equal(result.profile.priority_tier, expectedStats.priority_tier);
    assert.deepEqual(result.profile.upcoming_rsvps, expectedStats.upcoming);
    assert.deepEqual(result.profile.recent_history, expectedStats.recent_history);
    assert.deepEqual(result.profile.rating, {
      average: expectedRatings.kindnessRating,
      count: expectedRatings.sampleSize,
      window: expectedRatings.limit,
    });
    assert.ok(!Object.hasOwn(result.profile, "reliability_tier"));
    assert.equal(result.profile.rating.average, 4.5);
    assert.equal(result.profile.rating.count, 2);
  } finally {
    harness.restore();
  }
});

test("KAI get_user_profile returns canonical empty-state metrics", async () => {
  const harness = createProfileHarness({
    user: {
      id: "user-profile-2",
      firstname: "Empty",
      lastname: "State",
      email: "empty@example.com",
      home_base_label: null,
      created_at: "2025-01-01T00:00:00.000Z",
    },
    walletTransactions: [],
    ratings: [],
    portfolioRows: [],
  });

  try {
    const [expectedStats, expectedRatings, expectedWallet, result] = await Promise.all([
      getVolunteerStats("user-profile-2"),
      getRatingsSummary({ userId: "user-profile-2", limit: 20 }),
      getWalletSummary({ userId: "user-profile-2" }),
      executeToolCall("get_user_profile", {}, "user-profile-2"),
    ]);

    assert.equal(result.status, "success");
    assert.deepEqual(result.profile.wallet_summary, expectedWallet);
    assert.equal(result.profile.ic_balance, 0);
    assert.equal(result.profile.verified_minutes_total, expectedStats.verified_minutes_total);
    assert.equal(result.profile.verified_hours_total, expectedStats.verified_hours_total);
    assert.equal(result.profile.verified_shifts_total, expectedStats.verified_shifts_total);
    assert.equal(result.profile.streak_weeks, expectedStats.streak_weeks);
    assert.equal(result.profile.reliability_score, expectedStats.reliability_score);
    assert.equal(result.profile.priority_tier, expectedStats.priority_tier);
    assert.deepEqual(result.profile.upcoming_rsvps, []);
    assert.deepEqual(result.profile.recent_history, []);
    assert.deepEqual(result.profile.rating, {
      average: expectedRatings.kindnessRating,
      count: expectedRatings.sampleSize,
      window: expectedRatings.limit,
    });
    assert.equal(result.profile.rating.average, null);
    assert.equal(result.profile.rating.count, 0);
  } finally {
    harness.restore();
  }
});
