import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { executeToolCall } from "../Backend/services/kai-tool-executor.js";

function createKaiWriteHarness({
  userSuspended = false,
  event,
  rsvps = [],
  roles = [],
  users = [],
  memberships = [],
  organizations = [],
  hasUpdatedAt = true,
  hasNotes = true,
  hasRoleIdColumn = true,
  hasRolesTable = true,
  hasUserOrgMembershipTable = true,
}) {
  const state = {
    event: event ? { ...event } : null,
    rsvps: Array.isArray(rsvps) ? rsvps.map((row) => ({ ...row })) : [],
    roles: Array.isArray(roles) ? roles.map((row) => ({ ...row })) : [],
    users: Array.isArray(users) ? users.map((row) => ({ ...row })) : [],
    memberships: Array.isArray(memberships) ? memberships.map((row) => ({ ...row })) : [],
    organizations: Array.isArray(organizations) ? organizations.map((row) => ({ ...row })) : [],
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
        trimmed.includes("SELECT id, event_id") &&
        trimmed.includes("FROM event_roles")
      ) {
        const [roleId] = params;
        const match = state.roles.find((row) => String(row.id) === String(roleId));
        return {
          rows: match ? [{ id: match.id, event_id: match.event_id }] : [],
          rowCount: match ? 1 : 0,
        };
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
        (
          trimmed.includes("COUNT(*) FILTER (WHERE status IN ('accepted','checked_in'))::int AS accepted_count")
          || trimmed.includes("COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in'))::int AS accepted_count")
        ) &&
        !trimmed.includes("waitlisted_count")
      ) {
        const [eventId] = params;
        const acceptedCount = state.rsvps.filter(
          (row) =>
            String(row.event_id) === String(eventId) &&
            String(row.attendee_user_id) !== String(state.event?.creator_user_id) &&
            (row.status === "accepted" || row.status === "checked_in"),
        ).length;
        return { rows: [{ accepted_count: acceptedCount }], rowCount: 1 };
      }

      if (
        (
          trimmed.includes("COUNT(*) FILTER (WHERE status IN ('accepted','checked_in'))::int AS accepted_count")
          || trimmed.includes("COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in'))::int AS accepted_count")
        ) &&
        trimmed.includes("COUNT(*) FILTER (WHERE status = 'waitlisted')::int AS waitlisted_count")
      ) {
        const [eventId] = params;
        const acceptedCount = state.rsvps.filter(
          (row) =>
            String(row.event_id) === String(eventId) &&
            String(row.attendee_user_id) !== String(state.event?.creator_user_id) &&
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

      if (
        (
          trimmed.includes("COUNT(*) FILTER (WHERE status IN ('accepted','checked_in')) AS accepted")
          || trimmed.includes("COUNT(*) FILTER (WHERE r.status IN ('accepted','checked_in')) AS accepted")
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
        return { rows: [{ accepted }], rowCount: 1 };
      }

      if (trimmed.startsWith("INSERT INTO event_rsvps") && trimmed.includes("role_id")) {
        const [eventId, userId, status, roleId] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(userId),
        );
        if (match) {
          match.status = status;
          match.role_id = roleId;
          match.check_in_method = null;
          match.checked_in_at = null;
          return { rows: [], rowCount: 1 };
        }
        state.rsvps.push({
          event_id: eventId,
          attendee_user_id: userId,
          status,
          role_id: roleId,
          check_in_method: null,
          checked_in_at: null,
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.startsWith("INSERT INTO event_rsvps") && !trimmed.includes("role_id")) {
        const [eventId, userId, status] = params;
        const match = state.rsvps.find(
          (row) => String(row.event_id) === String(eventId) && String(row.attendee_user_id) === String(userId),
        );
        if (match) {
          match.status = status;
          match.check_in_method = null;
          match.checked_in_at = null;
          return { rows: [], rowCount: 1 };
        }
        state.rsvps.push({
          event_id: eventId,
          attendee_user_id: userId,
          status,
          role_id: null,
          check_in_method: null,
          checked_in_at: null,
        });
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
        match.check_in_method = null;
        match.checked_in_at = null;
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
      const [userId] = params;
      const user = state.users.find((row) => String(row.id) === String(userId));
      return { rows: [{ is_suspended: user?.is_suspended ?? userSuspended }], rowCount: 1 };
    }

    if (
      trimmed.startsWith("SELECT id, org_id, org_rep FROM public.userdata")
    ) {
      const [userId] = params;
      const user = state.users.find((row) => String(row.id) === String(userId));
      return { rows: user ? [{ id: user.id, org_id: user.org_id ?? null, org_rep: user.org_rep === true }] : [], rowCount: user ? 1 : 0 };
    }

    if (trimmed.startsWith("SELECT to_regclass")) {
      const tableName = String(params?.[0] || "");
      if (tableName === "public.event_roles") {
        return { rows: [{ table_name: hasRolesTable ? "event_roles" : null }], rowCount: 1 };
      }
      if (tableName === "public.user_org_memberships") {
        return { rows: [{ table_name: hasUserOrgMembershipTable ? "user_org_memberships" : null }], rowCount: 1 };
      }
      if (tableName === "public.event_rsvps") {
        return { rows: [{ table_name: "event_rsvps" }], rowCount: 1 };
      }
      return { rows: [{ table_name: null }], rowCount: 1 };
    }

    if (
      trimmed.includes("FROM public.user_org_memberships m") &&
      trimmed.includes("LEFT JOIN public.organizations o")
    ) {
      const [userId] = params;
      const rows = state.memberships
        .filter((row) => String(row.user_id) === String(userId) && row.is_active !== false)
        .map((row) => {
          const org = state.organizations.find((entry) => Number(entry.id) === Number(row.org_id));
          return {
            org_id: row.org_id,
            role: row.role || "admin",
            is_active: row.is_active !== false,
            org_name: org?.name || "",
            org_status: org?.status || "",
          };
        });
      return { rows, rowCount: rows.length };
    }

    if (
      trimmed.includes("SELECT user_id AS id") &&
      trimmed.includes("FROM public.user_org_memberships")
    ) {
      const [orgId] = params;
      const rows = state.memberships
        .filter((row) => Number(row.org_id) === Number(orgId) && row.is_active !== false)
        .map((row) => ({ id: row.user_id }))
        .sort((a, b) => Number(a.id) - Number(b.id));
      return { rows, rowCount: rows.length };
    }

    if (
      trimmed.includes("SELECT id") &&
      trimmed.includes("FROM public.userdata") &&
      trimmed.includes("WHERE org_id = $1")
    ) {
      const [orgId] = params;
      const rows = state.users
        .filter((row) => Number(row.org_id) === Number(orgId))
        .map((row) => ({ id: row.id }))
        .sort((a, b) => Number(a.id) - Number(b.id));
      return { rows, rowCount: rows.length };
    }

    if (
      trimmed.includes("SELECT id, name, status") &&
      trimmed.includes("FROM public.organizations")
    ) {
      const [orgId] = params;
      const org = state.organizations.find((row) => Number(row.id) === Number(orgId));
      return {
        rows: org ? [{ id: org.id, name: org.name || "", status: org.status || "" }] : [],
        rowCount: org ? 1 : 0,
      };
    }

    if (trimmed.includes("FROM information_schema.columns")) {
      const columnName = String(params?.[1] || "");
      const exists =
        columnName === "updated_at"
          ? hasUpdatedAt
          : columnName === "notes"
            ? hasNotes
            : columnName === "role_id"
              ? hasRoleIdColumn
              : false;
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

test("suspended user cannot RSVP through KAI", async () => {
  const harness = createKaiWriteHarness({
    userSuspended: true,
    event: {
      id: "evt-s1",
      title: "Shelter Support",
      start_at: "2026-04-30T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
      creator_user_id: "host-1",
    },
  });

  try {
    const result = await executeToolCall("rsvp_to_event", { event_id: "evt-s1" }, "user-suspended");
    assert.deepEqual(result, {
      status: "error",
      code: "account_suspended",
      message: "Your account is suspended.",
    });
    assert.equal(harness.state.rsvps.length, 0);
  } finally {
    harness.restore();
  }
});

test("suspended user cannot cancel through KAI", async () => {
  const harness = createKaiWriteHarness({
    userSuspended: true,
    event: {
      id: "evt-s2",
      title: "Shelter Support",
      start_at: "2026-04-30T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
      creator_user_id: "host-1",
    },
    rsvps: [
      {
        event_id: "evt-s2",
        attendee_user_id: "user-suspended",
        status: "accepted",
        check_in_method: null,
        checked_in_at: null,
      },
    ],
  });

  try {
    const result = await executeToolCall("cancel_rsvp", { event_id: "evt-s2" }, "user-suspended");
    assert.deepEqual(result, {
      status: "error",
      code: "account_suspended",
      message: "Your account is suspended.",
    });
    assert.equal(harness.state.rsvps[0].status, "accepted");
  } finally {
    harness.restore();
  }
});

test("KAI rejects role_id from another event", async () => {
  const harness = createKaiWriteHarness({
    event: {
      id: "evt-r1",
      title: "Tree Planting",
      start_at: "2026-05-02T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
      creator_user_id: "host-2",
    },
    roles: [
      { id: "role-other", event_id: "evt-other" },
    ],
  });

  try {
    const result = await executeToolCall(
      "rsvp_to_event",
      { event_id: "evt-r1", role_id: "role-other" },
      "user-1",
    );
    assert.deepEqual(result, {
      status: "error",
      code: "invalid_role_id",
      message: "Role does not belong to this event.",
    });
    assert.equal(harness.state.rsvps.length, 0);
  } finally {
    harness.restore();
  }
});

test("KAI rejects nonexistent role_id", async () => {
  const harness = createKaiWriteHarness({
    event: {
      id: "evt-r2",
      title: "Food Drive",
      start_at: "2026-05-03T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
      creator_user_id: "host-3",
    },
    roles: [],
  });

  try {
    const result = await executeToolCall(
      "rsvp_to_event",
      { event_id: "evt-r2", role_id: "role-missing" },
      "user-2",
    );
    assert.deepEqual(result, {
      status: "not_found",
      code: "role_not_found",
      message: "Role not found.",
    });
    assert.equal(harness.state.rsvps.length, 0);
  } finally {
    harness.restore();
  }
});

test("KAI persists a valid same-event role_id", async () => {
  const harness = createKaiWriteHarness({
    event: {
      id: "evt-r3",
      title: "Beach Cleanup",
      start_at: "2026-05-04T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
      creator_user_id: "host-4",
    },
    roles: [
      { id: "role-same", event_id: "evt-r3" },
    ],
  });

  try {
    const result = await executeToolCall(
      "rsvp_to_event",
      { event_id: "evt-r3", role_id: "role-same" },
      "user-3",
    );
    assert.equal(result.status, "success");
    assert.equal(result.rsvp_status, "pending");

    const [rsvp] = harness.state.rsvps;
    assert.equal(rsvp.status, "pending");
    assert.equal(rsvp.role_id, "role-same");
  } finally {
    harness.restore();
  }
});

test("KAI RSVP success path still works without role_id", async () => {
  const harness = createKaiWriteHarness({
    event: {
      id: "evt-r4",
      title: "Community Garden",
      start_at: "2026-05-05T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
      creator_user_id: "host-5",
    },
  });

  try {
    const result = await executeToolCall("rsvp_to_event", { event_id: "evt-r4" }, "user-4");
    assert.equal(result.status, "success");
    assert.equal(result.rsvp_status, "pending");

    const [rsvp] = harness.state.rsvps;
    assert.equal(rsvp.status, "pending");
    assert.equal(rsvp.role_id, null);
  } finally {
    harness.restore();
  }
});

test("KAI blocks RSVP for events owned by the caller's default org scope", async () => {
  const harness = createKaiWriteHarness({
    event: {
      id: "evt-host",
      title: "Org Cleanup",
      start_at: "2026-05-06T18:00:00.000Z",
      status: "published",
      capacity: 10,
      waitlist_enabled: true,
      creator_user_id: "202",
    },
    users: [
      { id: "101", org_id: 7, org_rep: true, is_suspended: false },
      { id: "202", org_id: 7, org_rep: true, is_suspended: false },
    ],
    organizations: [
      { id: 7, name: "Kind Org", status: "approved" },
    ],
    hasUserOrgMembershipTable: false,
  });

  try {
    const result = await executeToolCall("rsvp_to_event", { event_id: "evt-host" }, "101");
    assert.deepEqual(result, {
      status: "error",
      message: "Hosts do not need to RSVP",
    });
    assert.equal(harness.state.rsvps.length, 0);
  } finally {
    harness.restore();
  }
});
