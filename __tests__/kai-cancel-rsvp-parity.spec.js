import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { executeToolCall } from "../Backend/services/kai-tool-executor.js";

function createPoolHarness({
  event,
  rsvps,
  hasUpdatedAt = true,
  hasNotes = true,
}) {
  const state = {
    event: event ? { ...event } : null,
    rsvps: Array.isArray(rsvps) ? rsvps.map((row) => ({ ...row })) : [],
  };
  const queryLog = [];

  const runner = {
    released: false,
    async query(rawSql, params = []) {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
      queryLog.push({ sql, params, runner: "client" });
      const trimmed = sql.trim();

      if (trimmed === "BEGIN" || trimmed === "COMMIT" || trimmed === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }

      if (
        trimmed.includes("SELECT id, creator_user_id, title, start_at, status, capacity, waitlist_enabled") &&
        trimmed.includes("FROM events")
      ) {
        return { rows: state.event ? [{ ...state.event }] : [], rowCount: state.event ? 1 : 0 };
      }

      if (trimmed.startsWith("SELECT id, title, start_at, status FROM events")) {
        return { rows: state.event ? [{ ...state.event }] : [], rowCount: state.event ? 1 : 0 };
      }

      if (
        trimmed.includes("SELECT status") &&
        trimmed.includes("FROM event_rsvps") &&
        trimmed.includes("FOR UPDATE")
      ) {
        const [eventId, userId] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(userId),
        );
        return { rows: match ? [{ status: match.status }] : [], rowCount: match ? 1 : 0 };
      }

      if (
        trimmed.startsWith("INSERT INTO event_rsvps") &&
        trimmed.includes("VALUES ($1, $2, 'declined'")
      ) {
        const eventId = params[0];
        const userId = params[1];
        const reason = params[2] ?? null;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(userId),
        );
        if (!match) {
          state.rsvps.push({
            event_id: eventId,
            attendee_user_id: userId,
            status: "declined",
            check_in_method: null,
            checked_in_at: null,
            notes: reason,
          });
          return { rows: [], rowCount: 1 };
        }
        match.status = "declined";
        match.check_in_method = null;
        match.checked_in_at = null;
        if (trimmed.includes("notes = EXCLUDED.notes")) {
          match.notes = reason;
        }
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.startsWith("UPDATE event_rsvps") && trimmed.includes("status = 'declined'")) {
        const eventId = params[params.length - 2];
        const userId = params[params.length - 1];
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(userId),
        );
        if (!match) return { rows: [], rowCount: 0 };
        match.status = "declined";
        if (trimmed.includes("check_in_method = NULL")) {
          match.check_in_method = null;
        }
        if (trimmed.includes("checked_in_at = NULL")) {
          match.checked_in_at = null;
        }
        if (trimmed.includes("notes = $1")) {
          match.notes = params[0] ?? null;
        }
        return { rows: [], rowCount: 1 };
      }

      if (
        trimmed.includes("SELECT id, capacity, status") &&
        trimmed.includes("FROM events") &&
        trimmed.includes("FOR UPDATE")
      ) {
        return { rows: state.event ? [{ ...state.event }] : [], rowCount: state.event ? 1 : 0 };
      }

      if (
        trimmed.includes("COUNT(*) FILTER (WHERE status IN ('accepted','checked_in'))::int AS accepted_count") &&
        trimmed.includes("COUNT(*) FILTER (WHERE status = 'waitlisted')::int AS waitlisted_count")
      ) {
        const [eventId] = params;
        const acceptedCount = state.rsvps.filter(
          (row) =>
            String(row.event_id) === String(eventId) &&
            (row.status === "accepted" || row.status === "checked_in"),
        ).length;
        const waitlistedCount = state.rsvps.filter(
          (row) => String(row.event_id) === String(eventId) && row.status === "waitlisted",
        ).length;
        return {
          rows: [{ accepted_count: acceptedCount, waitlisted_count: waitlistedCount }],
          rowCount: 1,
        };
      }

      if (trimmed.includes("UPDATE event_rsvps r") && trimmed.includes("SET status = 'pending'")) {
        const [eventId] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && row.status === "waitlisted",
        );
        if (!match) return { rows: [], rowCount: 0 };
        match.status = "pending";
        match.check_in_method = null;
        match.checked_in_at = null;
        return {
          rows: [{ attendee_user_id: String(match.attendee_user_id) }],
          rowCount: 1,
        };
      }

      if (
        trimmed.startsWith("SELECT status, check_in_method, checked_in_at") &&
        trimmed.includes("FROM event_rsvps")
      ) {
        const [eventId, userId] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(userId),
        );
        return {
          rows: match
            ? [{
                status: match.status,
                check_in_method: match.check_in_method ?? null,
                checked_in_at: match.checked_in_at ?? null,
              }]
            : [],
          rowCount: match ? 1 : 0,
        };
      }

      if (
        trimmed.includes("COUNT(*) FILTER (WHERE status IN ('accepted','checked_in')) AS accepted") &&
        trimmed.includes("FROM event_rsvps")
      ) {
        const [eventId] = params;
        const accepted = state.rsvps.filter(
          (row) =>
            String(row.event_id) === String(eventId) &&
            (row.status === "accepted" || row.status === "checked_in"),
        ).length;
        return { rows: [{ accepted }], rowCount: 1 };
      }

      throw new Error(`Unhandled client query: ${trimmed}`);
    },
    release() {
      this.released = true;
    },
  };

  const originalQuery = pool.query;
  const originalConnect = pool.connect;

  pool.connect = async () => runner;
  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    queryLog.push({ sql, params, runner: "pool" });
    const trimmed = sql.trim();

    if (trimmed.includes("FROM userdata") && trimmed.includes("is_suspended")) {
      return { rows: [{ is_suspended: false }], rowCount: 1 };
    }

    if (trimmed.includes("FROM information_schema.columns")) {
      const columnName = String(params?.[1] || "");
      const exists = columnName === "updated_at" ? hasUpdatedAt : columnName === "notes" ? hasNotes : false;
      return { rows: [{ exists }], rowCount: 1 };
    }

    if (trimmed.startsWith("SELECT compute_reliability")) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled pool query: ${trimmed}`);
  };

  return {
    state,
    queryLog,
    restore() {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    },
  };
}

test("KAI cancel_rsvp clears stale check-in metadata on accepted RSVP", async () => {
  const harness = createPoolHarness({
    event: {
      id: "evt-1",
      title: "Beach Cleanup",
      start_at: "2026-04-20T18:00:00.000Z",
      status: "published",
      capacity: 10,
    },
    rsvps: [
      {
        event_id: "evt-1",
        attendee_user_id: "user-1",
        status: "accepted",
        check_in_method: "host_code",
        checked_in_at: "2026-04-20T17:58:00.000Z",
        notes: null,
      },
    ],
  });

  try {
    const result = await executeToolCall("cancel_rsvp", { event_id: "evt-1", reason: "Can no longer attend" }, "user-1");
    assert.equal(result.status, "success");

    const [updated] = harness.state.rsvps;
    assert.equal(updated.status, "declined");
    assert.equal(updated.check_in_method, null);
    assert.equal(updated.checked_in_at, null);
    assert.equal(updated.notes, "Can no longer attend");
  } finally {
    harness.restore();
  }
});

test("KAI cancel_rsvp clears stale check-in metadata on checked-in RSVP", async () => {
  const harness = createPoolHarness({
    event: {
      id: "evt-2",
      title: "Food Bank Shift",
      start_at: "2026-04-22T18:00:00.000Z",
      status: "published",
      capacity: 5,
    },
    rsvps: [
      {
        event_id: "evt-2",
        attendee_user_id: "user-2",
        status: "checked_in",
        check_in_method: "geo",
        checked_in_at: "2026-04-22T18:02:00.000Z",
        notes: null,
      },
    ],
  });

  try {
    const result = await executeToolCall("cancel_rsvp", { event_id: "evt-2" }, "user-2");
    assert.equal(result.status, "success");

    const [updated] = harness.state.rsvps;
    assert.equal(updated.status, "declined");
    assert.equal(updated.check_in_method, null);
    assert.equal(updated.checked_in_at, null);
  } finally {
    harness.restore();
  }
});

test("KAI cancel_rsvp moves waitlisted attendees back into pending approval when a seat is released", async () => {
  const harness = createPoolHarness({
    event: {
      id: "evt-3",
      title: "Park Restoration",
      start_at: "2026-04-25T18:00:00.000Z",
      status: "published",
      capacity: 1,
    },
    rsvps: [
      {
        event_id: "evt-3",
        attendee_user_id: "user-3",
        status: "accepted",
        check_in_method: "host_code",
        checked_in_at: "2026-04-25T17:59:00.000Z",
        notes: null,
      },
      {
        event_id: "evt-3",
        attendee_user_id: "user-4",
        status: "waitlisted",
        check_in_method: "stale",
        checked_in_at: "2026-04-25T10:00:00.000Z",
        notes: null,
      },
    ],
  });

  try {
    const result = await executeToolCall("cancel_rsvp", { event_id: "evt-3" }, "user-3");
    assert.equal(result.status, "success");

    const cancelled = harness.state.rsvps.find((row) => row.attendee_user_id === "user-3");
    const promoted = harness.state.rsvps.find((row) => row.attendee_user_id === "user-4");
    assert.equal(cancelled.status, "declined");
    assert.equal(cancelled.check_in_method, null);
    assert.equal(cancelled.checked_in_at, null);
    assert.equal(promoted.status, "pending");
    assert.equal(promoted.check_in_method, null);
    assert.equal(promoted.checked_in_at, null);
  } finally {
    harness.restore();
  }
});

test("KAI cancel_rsvp rejects cancelled events like the canonical RSVP flow", async () => {
  const harness = createPoolHarness({
    event: {
      id: "evt-4",
      title: "Community Garden",
      start_at: "2026-04-28T18:00:00.000Z",
      status: "cancelled",
      capacity: 3,
    },
    rsvps: [
      {
        event_id: "evt-4",
        attendee_user_id: "user-5",
        status: "accepted",
        check_in_method: "host_code",
        checked_in_at: "2026-04-28T17:59:00.000Z",
        notes: null,
      },
    ],
  });

  try {
    const result = await executeToolCall("cancel_rsvp", { event_id: "evt-4" }, "user-5");
    assert.deepEqual(result, {
      status: "error",
      message: "Event has been cancelled",
    });

    const [unchanged] = harness.state.rsvps;
    assert.equal(unchanged.status, "accepted");
    assert.equal(unchanged.check_in_method, "host_code");
    assert.equal(unchanged.checked_in_at, "2026-04-28T17:59:00.000Z");
  } finally {
    harness.restore();
  }
});
