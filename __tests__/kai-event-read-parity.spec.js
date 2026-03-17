import test from "node:test";
import assert from "node:assert/strict";

import pool from "../Backend/db/pg.js";
import { executeToolCall } from "../Backend/services/kai-tool-executor.js";
import { fetchEventById, fetchEvents } from "../services/eventsService.js";

function createEventReadHarness({
  events = [],
  rsvps = [],
  roles = [],
  rolesTableExists = true,
}) {
  const originalQuery = pool.query;

  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();

    if (trimmed.startsWith("SELECT to_regclass")) {
      const [regclass] = params;
      if (regclass === "public.event_roles") {
        return { rows: [{ table_name: rolesTableExists ? regclass : null }], rowCount: 1 };
      }
      return { rows: [{ table_name: null }], rowCount: 1 };
    }

    if (
      trimmed.includes("FROM event_roles") &&
      trimmed.includes("WHERE event_id = $1")
    ) {
      const [eventId] = params;
      const matchedRoles = roles
        .filter((row) => String(row.event_id) === String(eventId))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return { rows: matchedRoles.map((row) => ({ ...row })), rowCount: matchedRoles.length };
    }

    if (
      trimmed.includes("FROM event_rsvps") &&
      trimmed.includes("COUNT(*) FILTER (WHERE status IN ('accepted', 'checked_in')) AS accepted")
    ) {
      const [eventId] = params;
      const matched = rsvps.filter((row) => String(row.event_id) === String(eventId));
      const accepted = matched.filter((row) => row.status === "accepted" || row.status === "checked_in").length;
      const checkedIn = matched.filter((row) => row.status === "checked_in").length;
      const waitlisted = matched.filter((row) => row.status === "waitlisted").length;
      return {
        rows: [{ accepted, checked_in: checkedIn, waitlisted: waitlisted }],
        rowCount: 1,
      };
    }

    if (
      trimmed.includes("FROM events e") &&
      trimmed.includes("WHERE e.id = $1")
    ) {
      const [eventId] = params;
      const event = events.find((row) => String(row.id) === String(eventId));
      if (!event) return { rows: [], rowCount: 0 };
      const accepted = rsvps.filter(
        (row) =>
          String(row.event_id) === String(eventId) &&
          (row.status === "accepted" || row.status === "checked_in"),
      ).length;
      return {
        rows: [{
          ...event,
          org_id: event.org_id ?? null,
          org_rating_value: event.org_rating_value ?? null,
          org_rating_count: event.org_rating_count ?? 0,
          rsvp_accepted: accepted,
        }],
        rowCount: 1,
      };
    }

    if (
      trimmed.includes("FROM events e") &&
      trimmed.includes("LEFT JOIN userdata creator") &&
      trimmed.includes("ORDER BY COALESCE(e.start_at, 'infinity'::timestamptz) ASC")
    ) {
      const limit = Number(params[params.length - 1]) || 0;
      const now = Date.now();
      const visibleRows = events
        .filter((event) => event.status === "published")
        .filter((event) => {
          const endOrStart = event.end_at || event.start_at;
          return new Date(endOrStart).getTime() >= now - 2 * 60 * 60 * 1000;
        })
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
        .slice(0, limit)
        .map((event) => {
          const accepted = rsvps.filter(
            (row) =>
              String(row.event_id) === String(event.id) &&
              (row.status === "accepted" || row.status === "checked_in"),
          ).length;
          return {
            ...event,
            org_id: event.org_id ?? null,
            org_rating_value: event.org_rating_value ?? null,
            org_rating_count: event.org_rating_count ?? 0,
            rsvp_accepted: accepted,
          };
        });
      return { rows: visibleRows, rowCount: visibleRows.length };
    }

    throw new Error(`Unhandled event read query: ${trimmed}`);
  };

  return {
    restore() {
      pool.query = originalQuery;
    },
  };
}

function createEventRow(overrides = {}) {
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

test("KAI search_events uses canonical upcoming visibility semantics", async () => {
  const now = Date.now();
  const harness = createEventReadHarness({
    events: [
      createEventRow({
        id: "future-published",
        title: "Future Beach Cleanup",
        category: "Environment",
        start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
        cause_tags: ["Environment"],
      }),
      createEventRow({
        id: "ongoing-published",
        title: "Ongoing Food Drive",
        category: "Food Security",
        start_at: new Date(now - 30 * 60 * 1000).toISOString(),
        end_at: new Date(now + 30 * 60 * 1000).toISOString(),
        cause_tags: ["Food Security"],
      }),
      createEventRow({
        id: "recently-ended",
        title: "Recently Ended Park Sweep",
        category: "Environment",
        start_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now - 60 * 60 * 1000).toISOString(),
        cause_tags: ["Environment"],
      }),
      createEventRow({
        id: "old-archive",
        title: "Old Archive Event",
        start_at: new Date(now - 10 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now - 5 * 60 * 60 * 1000).toISOString(),
      }),
      createEventRow({
        id: "cancelled-event",
        title: "Cancelled Event",
        start_at: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        status: "cancelled",
      }),
      createEventRow({
        id: "draft-event",
        title: "Draft Event",
        start_at: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 3 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
        status: "draft",
      }),
    ],
  });

  try {
    const canonical = await fetchEvents({ view: "upcoming", limit: 100 });
    const result = await executeToolCall("search_events", { limit: 10, days_ahead: 365 }, "user-1");

    assert.equal(result.status, "success");
    assert.deepEqual(
      result.events.map((event) => event.id),
      canonical.events.map((event) => event.id),
    );
    assert.deepEqual(result.events.map((event) => event.id), [
      "recently-ended",
      "ongoing-published",
      "future-published",
    ]);
    assert.ok(result.events.every((event) => event.status === "published"));
  } finally {
    harness.restore();
  }
});

test("KAI search_events keeps canonical visibility and applies chat filters on top", async () => {
  const now = Date.now();
  const harness = createEventReadHarness({
    events: [
      createEventRow({
        id: "evt-environment-1",
        title: "Victoria Beach Cleanup",
        category: "Environment",
        start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
        location_text: "Victoria, BC",
        cause_tags: ["Environment"],
      }),
      createEventRow({
        id: "evt-food-1",
        title: "Food Packing",
        category: "Food Security",
        start_at: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 49 * 60 * 60 * 1000).toISOString(),
        location_text: "Victoria, BC",
        cause_tags: ["Food Security"],
      }),
    ],
  });

  try {
    const result = await executeToolCall(
      "search_events",
      {
        query: "Victoria",
        category: "Environment",
        cause_tags: ["Environment"],
        limit: 10,
        days_ahead: 365,
      },
      "user-1",
    );

    assert.equal(result.status, "success");
    assert.deepEqual(result.events.map((event) => event.id), ["evt-environment-1"]);
    assert.equal(result.events[0].category, "Environment");
  } finally {
    harness.restore();
  }
});

test("KAI get_event_details uses canonical detail event model and count semantics", async () => {
  const now = Date.now();
  const harness = createEventReadHarness({
    events: [
      createEventRow({
        id: "evt-detail-1",
        title: "Detail Event",
        category: "Environment",
        description: "Help clean the shoreline.",
        start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
        location_text: "Dallas Road",
        org_name: "Ocean Org",
        community_tag: "Victoria",
        cause_tags: ["Environment"],
        capacity: 20,
      }),
    ],
    rsvps: [
      { event_id: "evt-detail-1", attendee_user_id: "u1", status: "accepted" },
      { event_id: "evt-detail-1", attendee_user_id: "u2", status: "checked_in" },
      { event_id: "evt-detail-1", attendee_user_id: "u3", status: "waitlisted" },
    ],
    roles: [
      { id: "role-1", event_id: "evt-detail-1", title: "Greeter" },
    ],
  });

  try {
    const canonical = await fetchEventById("evt-detail-1");
    const result = await executeToolCall("get_event_details", { event_id: "evt-detail-1" }, "user-1");

    assert.equal(result.status, "success");
    assert.equal(result.event.id, canonical.id);
    assert.equal(result.event.title, canonical.title);
    assert.equal(result.event.category, canonical.category);
    assert.equal(result.event.description, canonical.description);
    assert.equal(result.event.location_text, canonical.location_text);
    assert.equal(result.event.org_name, canonical.org_name);
    assert.deepEqual(result.event.cause_tags, canonical.cause_tags);
    assert.deepEqual(result.event.rsvp_counts, canonical.rsvp_counts);
    assert.equal(result.event.rsvp_summary.accepted, canonical.rsvp_counts.accepted);
    assert.equal(result.event.rsvp_summary.checked_in, 1);
    assert.equal(result.event.rsvp_summary.waitlisted, 1);
    assert.ok(!Object.hasOwn(result.event.rsvp_summary, "pending"));
    assert.deepEqual(result.event.roles, [{ id: "role-1", event_id: "evt-detail-1", title: "Greeter" }]);
  } finally {
    harness.restore();
  }
});

test("KAI get_event_details returns not_found for missing events", async () => {
  const harness = createEventReadHarness({
    events: [],
    rsvps: [],
    roles: [],
  });

  try {
    const result = await executeToolCall("get_event_details", { event_id: "missing-event" }, "user-1");
    assert.deepEqual(result, {
      status: "not_found",
      message: "Event not found.",
    });
  } finally {
    harness.restore();
  }
});
