import test from "node:test";
import assert from "node:assert/strict";
import { generateArcForQuiz, __testables } from "../services/ArcGenerator.js";

function createStubPool({
  existingArc = null,
  planRows = [],
  stepRows = [],
  challengeRows = [],
}) {
  const pool = {
    lastInsert: null,
    queries: [],
    async query(rawSql, params = []) {
      const sql = typeof rawSql === "string" ? rawSql : rawSql?.text ?? "";
      pool.queries.push({ sql, params });
      const trimmed = sql.trim();

      if (trimmed.startsWith("ALTER TABLE") || trimmed.startsWith("CREATE INDEX") || trimmed.startsWith("UPDATE plan_templates")) {
        return { rows: [], rowCount: 0 };
      }

      if (trimmed.includes("FROM friend_arcs") && trimmed.includes("quiz_session_id")) {
        return { rows: existingArc ? [existingArc] : [] };
      }

      if (trimmed.includes("FROM plan_templates")) {
        return { rows: planRows };
      }

      if (trimmed.includes("FROM step_templates")) {
        return { rows: stepRows };
      }

      if (trimmed.includes("FROM challenge_templates")) {
        return { rows: challengeRows };
      }

      if (trimmed.startsWith("INSERT INTO friend_arcs")) {
        const [
          id,
          userId,
          quizSessionId,
          name,
          day,
          length,
          arcPoints,
          nextThreshold,
          pointsToday,
          friendScore,
          friendType,
          lifetimeJson,
          stepsJson,
          challengeJson,
          badgesJson,
        ] = params;

        const row = {
          id,
          user_id: userId,
          quiz_session_id: quizSessionId,
          name,
          day,
          length,
          arc_points: arcPoints,
          next_threshold: nextThreshold,
          points_today: pointsToday,
          friend_score: friendScore,
          friend_type: friendType,
          lifetime: JSON.parse(lifetimeJson),
          steps: JSON.parse(stepsJson),
          challenge: JSON.parse(challengeJson),
          badges: JSON.parse(badgesJson),
        };

        pool.lastInsert = { params, row };
        return { rows: [row] };
      }

      return { rows: [] };
    },
  };

  return pool;
}

function buildPayload(overrides = {}) {
  return {
    user_id: 42,
    friend_id: "friend-42",
    friend_name: "Jordan",
    tier: "Gold",
    channel_pref: "text",
    effort_capacity: "low",
    ...overrides,
  };
}

const starterPlanRow = {
  id: "starter-001",
  name: "Starter 7",
  tier: "Silver",
  channel: "email",
  effort: "high",
  length_days: 7,
  tags: '["Starter","Focus"]',
};

const fallbackPlanRow = {
  id: "plan-200",
  name: "High Fit Plan",
  tier: "Gold",
  channel: "text",
  effort: "low",
  length_days: 5,
  tags: "growth",
};

const defaultStepRows = [
  {
    id: "step-1",
    day_number: 1,
    title: "Day 1 kickoff",
    meta: null,
    channel: "text",
    effort: "low",
  },
];

const defaultChallengeRows = [
  {
    id: "challenge-1",
    title: "Starter Challenge",
    description: "Do a nice thing",
    channel: "mixed",
    effort: "low",
    tags: ["starter"],
    est_minutes: 10,
    points: 100,
    swaps_allowed: 0,
  },
];

function suppressConsoleInfo(fn) {
  return async (...args) => {
    const original = console.info;
    console.info = () => {};
    try {
      return await fn(...args);
    } finally {
      console.info = original;
    }
  };
}

test("always forces starter plan when available", suppressConsoleInfo(async (t) => {
  const pool = createStubPool({
    planRows: [starterPlanRow, fallbackPlanRow],
    stepRows: defaultStepRows,
    challengeRows: defaultChallengeRows,
  });

  const arc = await generateArcForQuiz(pool, buildPayload());

  assert.ok(arc, "expected arc to be returned");
  assert.ok(pool.lastInsert, "expected new arc insert");

  const lifetime = pool.lastInsert.row.lifetime;
  assert.equal(lifetime.planTemplateId, "starter-001");
  assert.equal(lifetime.planName, "Starter 7");
  assert.equal(lifetime.starter7AutoSelected, true);
}));

test("falls back to scorer when starter plan unavailable", suppressConsoleInfo(async (t) => {
  const pool = createStubPool({
    planRows: [fallbackPlanRow],
    stepRows: defaultStepRows,
    challengeRows: defaultChallengeRows,
  });

  await generateArcForQuiz(pool, buildPayload());

  assert.ok(pool.lastInsert, "expected insert to occur");
  const lifetime = pool.lastInsert.row.lifetime;
  assert.equal(lifetime.planTemplateId, "plan-200");
  assert.equal(lifetime.starter7AutoSelected, undefined);
}));

test("existing arc returns existing without reselection", suppressConsoleInfo(async (t) => {
  const existingArc = {
    id: "friend-42",
    user_id: 42,
    quiz_session_id: null,
    name: "Existing Arc",
    day: 2,
    length: 5,
    arc_points: 120,
    next_threshold: 500,
    points_today: 40,
    friend_score: 10,
    friend_type: "Gold",
    lifetime: { xp: 120, streak: "2 days", drag: "0%" },
    steps: [],
    challenge: { id: "challenge-existing" },
    badges: {},
  };

  const pool = createStubPool({ existingArc });

  const arc = await generateArcForQuiz(pool, buildPayload());

  assert.equal(arc.id, "friend-42");
  assert.equal(arc.name, "Existing Arc");
  assert.equal(pool.lastInsert, null, "should not insert a new arc");
}));

test("normalizeTagList handles array, JSON, CSV, and scalar input", () => {
  const { normalizeTagList } = __testables;

  assert.deepEqual(normalizeTagList(["Starter", "Focus", "Starter"]), ["starter", "focus"]);
  assert.deepEqual(normalizeTagList('["Starter","Focus"]'), ["starter", "focus"]);
  assert.deepEqual(normalizeTagList("Starter, Focus | Momentum"), ["starter", "focus", "momentum"]);
  assert.deepEqual(normalizeTagList(42), ["42"]);
});
