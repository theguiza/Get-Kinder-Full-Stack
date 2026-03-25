import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pool from "../Backend/db/pg.js";
import kaiRouter, { __testables as kaiApiTestables } from "../Backend/routes/kaiApi.js";
import { __testables as kaiServiceTestables } from "../Backend/services/kai.js";
import { __testables as kaiToolTestables, executeToolCall } from "../Backend/services/kai-tool-executor.js";
import { __testables as guestTelemetryTestables } from "../Backend/services/kai-guest-telemetry.js";
import { getAvailableTools } from "../Backend/middleware/kai-tier.js";

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

function createGuestSearchHarness(events = []) {
  const originalQuery = pool.query;

  pool.query = async (rawSql, params = []) => {
    const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
    const trimmed = sql.trim();

    if (
      trimmed.includes("SELECT COUNT(*)::int AS total_matching") &&
      trimmed.includes("FROM events e")
    ) {
      const now = Date.now();
      const matched = events
        .filter((event) => event.status === "published")
        .filter((event) => {
          const endOrStart = event.end_at || event.start_at;
          return new Date(endOrStart).getTime() >= now - 2 * 60 * 60 * 1000;
        });
      return {
        rows: [{ total_matching: matched.length }],
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
          rsvp_accepted: 0,
        }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unhandled guest search query: ${trimmed}`);
  };

  return {
    restore() {
      pool.query = originalQuery;
    },
  };
}

function getGuestRouteHandler() {
  const layer = kaiRouter.stack.find(
    (entry) => entry?.route?.path === "/guest" && entry.route.methods?.post
  );
  if (!layer) {
    throw new Error("Guest POST route not found");
  }
  return layer.route.stack[0].handle;
}

function createResponseRecorder() {
  const record = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return record;
}

function installGuestAnthropicStub() {
  kaiServiceTestables.setAnthropicCreateForTests(async (payload) => {
    const lastMessage = payload.messages[payload.messages.length - 1];
    const contentBlocks = Array.isArray(lastMessage?.content)
      ? lastMessage.content
      : [{ type: "text", text: String(lastMessage?.content || "") }];
    const hasToolResult = contentBlocks.some((block) => block?.type === "tool_result");

    if (hasToolResult) {
      const toolResultBlock = contentBlocks.find((block) => block?.type === "tool_result");
      const parsed = JSON.parse(toolResultBlock?.content || "{}");
      const finalText = Array.isArray(parsed?.events) && parsed.events.length > 0
        ? "Here are some volunteer opportunities."
        : "I couldn't find any matching volunteer events right now.";
      return {
        content: [{ type: "text", text: finalText }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }

    const userText = contentBlocks
      .map((block) => (typeof block?.text === "string" ? block.text : ""))
      .join(" ")
      .toLowerCase();

    return {
      content: [{
        type: "tool_use",
        id: "tool-search-1",
        name: "search_events",
        input: {
          query: userText.includes("animal") ? "animal" : userText.includes("none") ? "nope" : "environment",
          days_ahead: 30,
          limit: 5,
        },
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });
}

function captureGuestTelemetry() {
  const events = [];
  guestTelemetryTestables.setTelemetrySinkForTests((eventName, payload) => {
    events.push({ eventName, payload });
  });
  return {
    events,
    restore() {
      guestTelemetryTestables.resetTelemetrySinkForTests();
    },
  };
}

test("guest tier exposes only search_events", () => {
  assert.deepEqual(getAvailableTools("guest"), ["search_events"]);
});

test("guest /api/kai/guest can search public events and return structured event results", async () => {
  const now = Date.now();
  const harness = createGuestSearchHarness([
    createEvent({
      id: "evt-guest-1",
      title: "Environmental Cleanup",
      category: "Environment",
      description: "Help restore the park.",
      start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
      location_text: "Victoria, BC",
      org_name: "Ocean Org",
      community_tag: "Victoria",
      cause_tags: ["Environment"],
    }),
    createEvent({
      id: "evt-hidden",
      title: "Cancelled Event",
      start_at: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 49 * 60 * 60 * 1000).toISOString(),
      status: "cancelled",
    }),
  ]);
  installGuestAnthropicStub();
  kaiApiTestables.resetUsageForTests();
  const telemetry = captureGuestTelemetry();
  const guestHandler = getGuestRouteHandler();

  try {
    const res = createResponseRecorder();
    await guestHandler(
      {
        body: { message: "Find environmental volunteer events near me" },
        ip: "1.2.3.4",
      },
      res,
    );
    const data = res.body;

    assert.equal(res.statusCode, 200);
    assert.equal(data.success, true);
    assert.match(data.message, /volunteer opportunities/i);
    assert.ok(Array.isArray(data.structuredEvents?.events));
    assert.deepEqual(data.structuredEvents.events.map((event) => event.id), ["evt-guest-1"]);
    assert.ok(data.structuredEvents.events.every((event) => event.status === "published"));
    assert.ok(telemetry.events.some((row) => row.eventName === "guest_kai_message_sent"));
    assert.ok(telemetry.events.some((row) => row.eventName === "guest_kai_search_executed"));
    const resultsEvent = telemetry.events.find((row) => row.eventName === "guest_kai_search_results");
    assert.equal(resultsEvent?.payload?.result_count_bucket, "1");
  } finally {
    harness.restore();
    kaiApiTestables.resetUsageForTests();
    kaiServiceTestables.resetAnthropicCreateForTests();
    telemetry.restore();
  }
});

test("guest search no-result case stays sane", async () => {
  const now = Date.now();
  const harness = createGuestSearchHarness([
    createEvent({
      id: "evt-guest-2",
      title: "Environment Day",
      category: "Environment",
      start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
      location_text: "Victoria, BC",
      cause_tags: ["Environment"],
    }),
  ]);
  installGuestAnthropicStub();
  kaiApiTestables.resetUsageForTests();
  const telemetry = captureGuestTelemetry();
  const guestHandler = getGuestRouteHandler();

  try {
    const res = createResponseRecorder();
    await guestHandler(
      {
        body: { message: "Find none events" },
        ip: "1.2.3.5",
      },
      res,
    );
    const data = res.body;

    assert.equal(res.statusCode, 200);
    assert.equal(data.success, true);
    assert.match(data.message, /couldn't find any matching volunteer events/i);
    assert.deepEqual(data.structuredEvents?.events, []);
    assert.ok(telemetry.events.some((row) => row.eventName === "guest_kai_search_no_results"));
  } finally {
    harness.restore();
    kaiApiTestables.resetUsageForTests();
    kaiServiceTestables.resetAnthropicCreateForTests();
    telemetry.restore();
  }
});

test("guest vague weekend discovery falls back to broad upcoming search", async () => {
  const now = Date.now();
  const harness = createGuestSearchHarness([
    createEvent({
      id: "evt-guest-weekend",
      title: "Community Garden Shift",
      category: "Community",
      start_at: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      location_text: "Victoria, BC",
      community_tag: "Victoria",
    }),
  ]);

  try {
    const result = await executeToolCall(
      "search_events",
      { query: "What can I do this weekend?", days_ahead: 14, limit: 5 },
      null,
    );

    assert.equal(result.status, "success");
    assert.equal(result.search_context?.broad_search, true);
    assert.equal(result.search_context?.needs_location_hint, false);
    assert.deepEqual(result.events.map((event) => event.id), ["evt-guest-weekend"]);
    assert.match(result.intro, /Add a cause, city, or date/i);
  } finally {
    harness.restore();
  }
});

test("guest near-me discovery stays honest about missing location", async () => {
  const now = Date.now();
  const harness = createGuestSearchHarness([
    createEvent({
      id: "evt-guest-broad",
      title: "Park Cleanup",
      category: "Environment",
      start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
      location_text: "Victoria, BC",
      community_tag: "Victoria",
    }),
  ]);

  try {
    const result = await executeToolCall(
      "search_events",
      { query: "How can I help near me?", days_ahead: 14, limit: 5 },
      null,
    );

    assert.equal(result.status, "success");
    assert.equal(result.search_context?.broad_search, true);
    assert.equal(result.search_context?.needs_location_hint, true);
    assert.match(result.intro, /Share a city|do not know your city/i);
  } finally {
    harness.restore();
  }
});

test("guest route rate limiting still works", async () => {
  const now = Date.now();
  const harness = createGuestSearchHarness([
    createEvent({
      id: "evt-rate-limit",
      title: "Weekend Cleanup",
      category: "Environment",
      start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
      location_text: "Victoria, BC",
      cause_tags: ["Environment"],
    }),
  ]);
  installGuestAnthropicStub();
  kaiApiTestables.resetUsageForTests();
  const telemetry = captureGuestTelemetry();
  const guestHandler = getGuestRouteHandler();

  try {
    for (let i = 0; i < 10; i += 1) {
      const res = createResponseRecorder();
      await guestHandler(
        {
          body: { message: `Find environmental events ${i}` },
          ip: "1.2.3.6",
        },
        res,
      );
      assert.equal(res.statusCode, 200);
    }

    const blocked = createResponseRecorder();
    await guestHandler(
      {
        body: { message: "Find one more event" },
        ip: "1.2.3.6",
      },
      blocked,
    );
    const data = blocked.body;

    assert.equal(blocked.statusCode, 429);
    assert.equal(data.rateLimited, true);
    assert.ok(telemetry.events.some((row) => row.eventName === "guest_kai_rate_limited"));
  } finally {
    harness.restore();
    kaiApiTestables.resetUsageForTests();
    kaiServiceTestables.resetAnthropicCreateForTests();
    telemetry.restore();
  }
});

test("guest execution remains blocked for account and write tools", async () => {
  const [profileResult, balanceResult, rsvpResult, cancelResult] = await Promise.all([
    executeToolCall("get_user_profile", {}, null),
    executeToolCall("get_ic_balance", {}, null),
    executeToolCall("rsvp_to_event", { event_id: "evt-1" }, null),
    executeToolCall("cancel_rsvp", { event_id: "evt-1" }, null),
  ]);

  for (const result of [profileResult, balanceResult, rsvpResult, cancelResult]) {
    assert.equal(result.status, "error");
    assert.equal(result.code, "login_required");
    assert.match(result.message, /sign in/i);
  }
});

test("guest search helpers and empty-state copy stay accurate", () => {
  const template = readFileSync(
    new URL("../views/partials/kai-chat-floating.ejs", import.meta.url),
    "utf8",
  );

  assert.deepEqual(getAvailableTools("guest"), ["search_events"]);
  assert.equal(kaiToolTestables.normalizeSearchQuery("How can I help near me?").needsLocationHint, true);
  assert.equal(kaiToolTestables.normalizeSearchQuery("What can I do this weekend?").broadSearch, true);
  assert.match(template, /discover public volunteer events by cause, city, or date/i);
  assert.match(template, /loginLink\.textContent = 'Log in'/);
  assert.match(template, /to RSVP, save events, or get personalized matches\./i);
  assert.match(template, /guest_kai_opened/);
  assert.match(template, /guest_kai_chip_clicked/);
  assert.match(template, /guest_kai_event_card_clicked/);
  assert.match(template, /guest_kai_login_cta_clicked/);
});

test("guest route emits telemetry for vague fallback and restricted intent", async () => {
  const now = Date.now();
  const harness = createGuestSearchHarness([
    createEvent({
      id: "evt-telemetry",
      title: "Weekend Cleanup",
      category: "Environment",
      start_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
      location_text: "Victoria, BC",
      community_tag: "Victoria",
    }),
  ]);
  kaiApiTestables.resetUsageForTests();
  const telemetry = captureGuestTelemetry();
  const guestHandler = getGuestRouteHandler();

  kaiServiceTestables.setAnthropicCreateForTests(async (payload) => {
    const lastMessage = payload.messages[payload.messages.length - 1];
    const contentBlocks = Array.isArray(lastMessage?.content)
      ? lastMessage.content
      : [{ type: "text", text: String(lastMessage?.content || "") }];
    const hasToolResult = contentBlocks.some((block) => block?.type === "tool_result");

    if (hasToolResult) {
      return {
        content: [{ type: "text", text: "Here are some public volunteer opportunities." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }

    const userText = contentBlocks
      .map((block) => (typeof block?.text === "string" ? block.text : ""))
      .join(" ")
      .toLowerCase();

    if (userText.includes("rsvp")) {
      return {
        content: [{ type: "text", text: "Please sign in to RSVP or manage your account." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }

    return {
      content: [{
        type: "tool_use",
        id: "tool-search-vague",
        name: "search_events",
        input: {
          query: "What can I do this weekend?",
          days_ahead: 14,
          limit: 5,
        },
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  });

  try {
    const vagueRes = createResponseRecorder();
    await guestHandler(
      { body: { message: "What can I do this weekend?" }, ip: "1.2.3.8" },
      vagueRes,
    );
    assert.equal(vagueRes.statusCode, 200);
    assert.ok(telemetry.events.some((row) => row.eventName === "guest_kai_vague_fallback"));

    const restrictedRes = createResponseRecorder();
    await guestHandler(
      { body: { message: "RSVP me to the first event" }, ip: "1.2.3.9" },
      restrictedRes,
    );
    assert.equal(restrictedRes.statusCode, 200);
    assert.ok(telemetry.events.some((row) => row.eventName === "guest_kai_restricted_intent"));
  } finally {
    harness.restore();
    kaiApiTestables.resetUsageForTests();
    kaiServiceTestables.resetAnthropicCreateForTests();
    telemetry.restore();
  }
});
