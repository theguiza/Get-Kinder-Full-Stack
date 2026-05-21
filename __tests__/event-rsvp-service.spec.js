import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { applyEventRsvpAction } from "../services/eventRsvpService.js";

function createRsvpServiceHarness({
  event,
  rsvps = [],
  roles = [],
  hasNotes = true,
}) {
  const state = {
    event: event ? { ...event } : null,
    rsvps: Array.isArray(rsvps) ? rsvps.map((row) => ({ ...row })) : [],
    roles: Array.isArray(roles) ? roles.map((row) => ({ spots_needed: 10, spots_filled: 0, ...row })) : [],
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
        trimmed.startsWith("SELECT id, capacity, status") &&
        trimmed.includes("FROM events")
      ) {
        return {
          rows: state.event
            ? [{
                id: state.event.id,
                capacity: state.event.capacity,
                status: state.event.status,
              }]
            : [],
          rowCount: state.event ? 1 : 0,
        };
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
        return {
          rows: match ? [{
            status: match.status,
            role_id: match.role_id ?? null,
            no_show: match.no_show === true,
          }] : [],
          rowCount: match ? 1 : 0,
        };
      }

      if (
        trimmed.includes("SELECT id, event_id, spots_needed, spots_filled") &&
        trimmed.includes("FROM event_roles") &&
        trimmed.includes("WHERE event_id = $1")
      ) {
        const [eventId] = params;
        const rows = state.roles.filter((row) => String(row.event_id) === String(eventId));
        return { rows: rows.map((row) => ({ ...row })), rowCount: rows.length };
      }

      if (
        trimmed.includes("SELECT id, event_id, spots_needed, spots_filled") &&
        trimmed.includes("FROM event_roles") &&
        trimmed.includes("WHERE id = $1")
      ) {
        const [roleId] = params;
        const match = state.roles.find((row) => String(row.id) === String(roleId));
        return { rows: match ? [{ ...match }] : [], rowCount: match ? 1 : 0 };
      }

      if (trimmed.startsWith("UPDATE event_roles SET spots_filled = spots_filled + 1")) {
        const [roleId] = params;
        const match = state.roles.find((row) => String(row.id) === String(roleId));
        if (match) match.spots_filled = Number(match.spots_filled) + 1;
        return { rows: match ? [{ spots_filled: match.spots_filled }] : [], rowCount: match ? 1 : 0 };
      }

      if (trimmed.startsWith("UPDATE event_roles SET spots_filled = GREATEST")) {
        const [roleId] = params;
        const match = state.roles.find((row) => String(row.id) === String(roleId));
        if (match) match.spots_filled = Math.max(Number(match.spots_filled) - 1, 0);
        return { rows: match ? [{ spots_filled: match.spots_filled }] : [], rowCount: match ? 1 : 0 };
      }

      if (trimmed.startsWith("INSERT INTO event_rsvps") && trimmed.includes("role_id")) {
        const [eventId, attendeeId, status, roleId] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(attendeeId),
        );
        if (match) {
          match.status = status;
          match.role_id = roleId;
          match.check_in_method = null;
          match.checked_in_at = null;
        } else {
          state.rsvps.push({
            event_id: eventId,
            attendee_user_id: attendeeId,
            status,
            role_id: roleId,
            notes: null,
            check_in_method: null,
            checked_in_at: null,
          });
        }
        return { rows: [], rowCount: 1 };
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

      if (trimmed.startsWith("INSERT INTO event_rsvps") && !trimmed.includes("notes")) {
        const [eventId, attendeeId, status] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(attendeeId),
        );
        if (match) {
          match.status = status;
          match.check_in_method = null;
          match.checked_in_at = null;
        } else {
          state.rsvps.push({
            event_id: eventId,
            attendee_user_id: attendeeId,
            status,
            notes: null,
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
        (
          trimmed.includes("COUNT(*) FILTER (WHERE status IN ('accepted','checked_in')) AS accepted")
          || trimmed.includes("COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in')) AS accepted")
          || trimmed.includes("COUNT(*) FILTER (WHERE status IN ('accepted','checked_in'))::int AS accepted_count")
          || trimmed.includes("COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in'))::int AS accepted_count")
        ) &&
        trimmed.includes("FROM event_rsvps")
      ) {
        const [eventId] = params;
        const accepted = state.rsvps.filter(
          (row) =>
            String(row.event_id) === String(eventId) &&
            String(row.attendee_user_id) !== String(state.event?.creator_user_id) &&
            (row.status === "accepted" || row.status === "checked_in"),
        ).length;
        return { rows: [{ accepted, accepted_count: accepted }], rowCount: 1 };
      }

      if (
        trimmed.includes("COUNT(*) FILTER (WHERE status = 'waitlisted')::int AS waitlisted_count") &&
        trimmed.includes("FROM event_rsvps")
      ) {
        const [eventId] = params;
        const accepted = state.rsvps.filter(
          (row) =>
            String(row.event_id) === String(eventId) &&
            String(row.attendee_user_id) !== String(state.event?.creator_user_id) &&
            (row.status === "accepted" || row.status === "checked_in"),
        ).length;
        const waitlisted = state.rsvps.filter(
          (row) => String(row.event_id) === String(eventId) && row.status === "waitlisted",
        ).length;
        return { rows: [{ accepted_count: accepted, waitlisted_count: waitlisted }], rowCount: 1 };
      }

      if (trimmed.startsWith("WITH candidates AS (") && trimmed.includes("UPDATE event_rsvps r")) {
        return { rows: [], rowCount: 0 };
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
      return {
        rows: [{
          exists: columnName === "notes" ? hasNotes : columnName === "role_id" || columnName === "no_show",
        }],
        rowCount: 1,
      };
    }

    if (trimmed.startsWith("SELECT to_regclass")) {
      const tableName = String(params?.[0] || "");
      return { rows: [{ table_name: tableName === "public.event_roles" ? "event_roles" : null }], rowCount: 1 };
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
    assert.equal(result.data.previous_status, null);

    const [rsvp] = harness.state.rsvps;
    assert.equal(rsvp.status, "declined");
    assert.equal(rsvp.notes, "Cannot make it");
  } finally {
    harness.restore();
  }
});

test("shared RSVP service reports the previous status when cancelling an existing RSVP", async () => {
  const harness = createRsvpServiceHarness({
    event: {
      id: "evt-service-2b",
      creator_user_id: "host-9",
      title: "Food Drive",
      start_at: "2026-05-11T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
    },
    roles: [
      { id: "role-service-2b", event_id: "evt-service-2b", spots_needed: 10, spots_filled: 1 },
    ],
    rsvps: [
      {
        event_id: "evt-service-2b",
        attendee_user_id: "user-2b",
        status: "accepted",
        role_id: "role-service-2b",
        check_in_method: null,
        checked_in_at: null,
      },
    ],
  });

  try {
    const result = await applyEventRsvpAction({
      eventId: "evt-service-2b",
      attendeeId: "user-2b",
      action: "decline",
      hostUserIds: [],
      requireExistingForDecline: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.status, "declined");
    assert.equal(result.data.previous_status, "accepted");
  } finally {
    harness.restore();
  }
});

test("shared RSVP service creates pending RSVPs until an org approves them", async () => {
  const harness = createRsvpServiceHarness({
    event: {
      id: "evt-service-3",
      creator_user_id: "host-3",
      title: "River Cleanup",
      start_at: "2026-05-12T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
    },
    roles: [
      { id: "role-service-3", event_id: "evt-service-3", spots_needed: 10, spots_filled: 0 },
    ],
  });

  try {
    const result = await applyEventRsvpAction({
      eventId: "evt-service-3",
      attendeeId: "user-3",
      action: "accept",
      hostUserIds: [],
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.status, "pending");

    const [rsvp] = harness.state.rsvps;
    assert.equal(rsvp.status, "pending");
    assert.equal(rsvp.role_id, "role-service-3");
    assert.equal(harness.state.roles[0].spots_filled, 1);
  } finally {
    harness.restore();
  }
});

test("shared RSVP service still waitlists when the event is full", async () => {
  const harness = createRsvpServiceHarness({
    event: {
      id: "evt-service-4",
      creator_user_id: "host-4",
      title: "Food Rescue",
      start_at: "2026-05-13T18:00:00.000Z",
      status: "published",
      capacity: 1,
      waitlist_enabled: true,
    },
    roles: [
      { id: "role-service-4", event_id: "evt-service-4", spots_needed: 10, spots_filled: 1 },
    ],
    rsvps: [
      {
        event_id: "evt-service-4",
        attendee_user_id: "user-accepted",
        status: "accepted",
        role_id: "role-service-4",
        check_in_method: null,
        checked_in_at: null,
      },
    ],
  });

  try {
    const result = await applyEventRsvpAction({
      eventId: "evt-service-4",
      attendeeId: "user-4",
      action: "accept",
      hostUserIds: [],
    });
    assert.equal(result.ok, true);
    assert.equal(result.data.status, "waitlisted");

    const inserted = harness.state.rsvps.find((row) => row.attendee_user_id === "user-4");
    assert.equal(inserted?.status, "waitlisted");
  } finally {
    harness.restore();
  }
});
