import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { applyEventRsvpAction } from "../services/eventRsvpService.js";

function createRsvpServiceHarness({
  event,
  rsvps = [],
  hasNotes = true,
}) {
  const state = {
    event: event ? { ...event } : null,
    rsvps: Array.isArray(rsvps) ? rsvps.map((row) => ({ ...row })) : [],
  };

  const runner = {
    released: false,
    async query(rawSql, params = []) {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
      const trimmed = sql.trim();

      if (trimmed === "BEGIN" || trimmed === "COMMIT" || trimmed === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }

      if (
        trimmed.startsWith("SELECT id, creator_user_id, title, start_at, status, capacity, waitlist_enabled") &&
        trimmed.includes("FROM events")
      ) {
        return { rows: state.event ? [{ ...state.event }] : [], rowCount: state.event ? 1 : 0 };
      }

      if (
        trimmed.includes("SELECT status") &&
        trimmed.includes("FROM event_rsvps") &&
        trimmed.includes("FOR UPDATE")
      ) {
        const [eventId, attendeeId] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(attendeeId),
        );
        return { rows: match ? [{ status: match.status }] : [], rowCount: match ? 1 : 0 };
      }

      if (trimmed.startsWith("INSERT INTO event_rsvps") && trimmed.includes("notes")) {
        const [eventId, attendeeId, reason] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(attendeeId),
        );
        if (match) {
          match.status = "declined";
          match.notes = reason;
          match.check_in_method = null;
          match.checked_in_at = null;
        } else {
          state.rsvps.push({
            event_id: eventId,
            attendee_user_id: attendeeId,
            status: "declined",
            notes: reason,
            check_in_method: null,
            checked_in_at: null,
          });
        }
        return { rows: [], rowCount: 1 };
      }

      if (
        trimmed.startsWith("SELECT status, check_in_method, checked_in_at") &&
        trimmed.includes("FROM event_rsvps")
      ) {
        const [eventId, attendeeId] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(attendeeId),
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
    const trimmed = sql.trim();

    if (trimmed.includes("FROM information_schema.columns")) {
      const columnName = String(params?.[1] || "");
      return { rows: [{ exists: columnName === "notes" ? hasNotes : false }], rowCount: 1 };
    }

    if (trimmed.startsWith("SELECT to_regclass")) {
      return { rows: [{ table_name: null }], rowCount: 1 };
    }

    throw new Error(`Unhandled pool query: ${trimmed}`);
  };

  return {
    state,
    restore() {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    },
  };
}

test("shared RSVP service blocks host-scope attendees", async () => {
  const harness = createRsvpServiceHarness({
    event: {
      id: "evt-service-1",
      creator_user_id: "host-1",
      title: "Beach Cleanup",
      start_at: "2026-05-10T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
    },
  });

  try {
    const result = await applyEventRsvpAction({
      eventId: "evt-service-1",
      attendeeId: "host-1",
      action: "accept",
      hostUserIds: ["host-1", "host-2"],
    });
    assert.deepEqual(result, {
      ok: false,
      statusCode: 400,
      error: "Hosts do not need to RSVP",
    });
  } finally {
    harness.restore();
  }
});

test("shared RSVP service preserves canonical decline behavior when no RSVP exists", async () => {
  const harness = createRsvpServiceHarness({
    event: {
      id: "evt-service-2",
      creator_user_id: "host-9",
      title: "Food Drive",
      start_at: "2026-05-11T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
    },
  });

  try {
    const result = await applyEventRsvpAction({
      eventId: "evt-service-2",
      attendeeId: "user-2",
      action: "decline",
      hostUserIds: [],
      requireExistingForDecline: false,
      reason: "Cannot make it",
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.status, "declined");

    const [rsvp] = harness.state.rsvps;
    assert.equal(rsvp.status, "declined");
    assert.equal(rsvp.notes, "Cannot make it");
  } finally {
    harness.restore();
  }
});
