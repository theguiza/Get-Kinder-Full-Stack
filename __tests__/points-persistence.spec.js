import test from "node:test";
import assert from "node:assert/strict";

import { getCached, putCached } from "../repos/idempotencyRepo.js";
import { awardAndMarkStepDone, awardChallengeAndClear } from "../services/pointsRepo.js";
import { mapFriendArcRow } from "../Backend/lib/friendArcMapper.js";

const STEP_POINTS = 5;
const SELECT_ARC_FOR_UPDATE = "SELECT * FROM friend_arcs WHERE id = $1 AND user_id = $2 FOR UPDATE";

const deepClone = (value) => JSON.parse(JSON.stringify(value));

class FakeArcStore {
  constructor(row) {
    this.arc = deepClone(row);
    this.arcMutations = new Map();
    this.locked = false;
    this.lockOwner = null;
    this.waiters = [];
  }

  createClient() {
    return new FakeClient(this);
  }

  snapshot() {
    return deepClone(this.arc);
  }

  async acquireLock(client) {
    if (this.lockOwner === client) return;
    while (this.locked) {
      await new Promise((resolve) => this.waiters.push(resolve));
    }
    this.locked = true;
    this.lockOwner = client;
  }

  releaseLock(client) {
    if (this.lockOwner !== client) return;
    this.locked = false;
    this.lockOwner = null;
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  readMutation(arcId, key) {
    return this.arcMutations.get(`${arcId}::${key}`) ?? null;
  }

  writeMutation(arcId, key, payload) {
    this.arcMutations.set(`${arcId}::${key}`, deepClone(payload));
  }
}

class FakeClient {
  constructor(store) {
    this.store = store;
    this.inTransaction = false;
  }

  async query(sql, params = []) {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    if (upper.startsWith("BEGIN")) {
      this.inTransaction = true;
      return { rows: [] };
    }

    if (upper.startsWith("COMMIT")) {
      this.inTransaction = false;
      this.store.releaseLock(this);
      return { rows: [] };
    }

    if (upper.startsWith("ROLLBACK")) {
      this.inTransaction = false;
      this.store.releaseLock(this);
      return { rows: [] };
    }

    if (upper.includes("FROM ARC_MUTATIONS")) {
      const arcId = params[0];
      const key = params[1];
      const entry = this.store.readMutation(arcId, key);
      return entry ? { rows: [{ response_json: deepClone(entry) }] } : { rows: [] };
    }

    if (upper.startsWith("INSERT INTO ARC_MUTATIONS")) {
      const [arcId, key, payload] = params;
      this.store.writeMutation(arcId, key, payload);
      return { rows: [] };
    }

    if (upper.includes("FROM FRIEND_ARCS") && upper.includes("FOR UPDATE")) {
      await this.store.acquireLock(this);
      const row = this.store.snapshot();
      return { rows: [row] };
    }

    if (upper.startsWith("UPDATE FRIEND_ARCS")) {
      if (!this.inTransaction) {
        throw new Error("UPDATE without active transaction");
      }

      const [arcId, userId] = params;
      const target = this.store.arc;
      if (String(target.id) !== String(arcId) || String(target.user_id) !== String(userId)) {
        return { rows: [] };
      }

      const delta = Number(params[2] ?? 0);
      if (Number.isFinite(delta)) {
        target.arc_points += delta;
        target.points_today += delta;
      }

      if (upper.includes("STEPS")) {
        const stepsJson = params[3];
        target.steps = typeof stepsJson === "string" ? JSON.parse(stepsJson) : deepClone(stepsJson ?? []);
      }

      if (upper.includes("CHALLENGE")) {
        const challengeJson = params[3];
        target.challenge =
          typeof challengeJson === "string" ? JSON.parse(challengeJson) : deepClone(challengeJson ?? null);
      }

      target.updated_at = new Date().toISOString();

      return { rows: [deepClone(target)] };
    }

    throw new Error(`Unsupported query: ${trimmed}`);
  }

  release() {
    this.store.releaseLock(this);
  }
}

const createArcRow = (overrides = {}) => ({
  id: "arc-1",
  user_id: "user-1",
  name: "Arc One",
  day: 1,
  length: 5,
  arc_points: 0,
  next_threshold: 100,
  points_today: 0,
  friend_score: null,
  friend_type: null,
  lifetime: { xp: 0, streak: "0 days", drag: "0%" },
  steps: [
    { id: "step-1", status: "todo" },
    { id: "step-2", status: "todo" },
  ],
  challenge: {
    id: "challenge-1",
    templateId: "challenge-1",
    points: 10,
  },
  badges: {},
  ...overrides,
});

async function completeStep({ store, stepId, key }) {
  const client = store.createClient();
  const arcId = store.arc.id;
  const userId = store.arc.user_id;

  try {
    const cached = await getCached(client, arcId, key);
    if (cached) {
      return { arc: cached.arc, fromCache: true };
    }

    await client.query("BEGIN");
    let committed = false;
    try {
      const { rows } = await client.query(SELECT_ARC_FOR_UPDATE, [arcId, userId]);
      if (!rows.length) throw new Error("Arc not found");
      const row = rows[0];
      const steps = Array.isArray(row.steps) ? deepClone(row.steps) : [];
      const index = steps.findIndex((step) => String(step.id) === String(stepId));
      if (index === -1) throw new Error("Step not found");

      if (steps[index].status !== "done") {
        steps[index] = { ...steps[index], status: "done" };
        const { row: updatedRow, percent } = await awardAndMarkStepDone(client, {
          arcId,
          userId,
          delta: STEP_POINTS,
          updatedSteps: steps,
        });
        const arc = mapFriendArcRow(updatedRow);
        arc.percent = percent;
        await putCached(client, arcId, key, { arc });
        await client.query("COMMIT");
        committed = true;
        return { arc, fromCache: false };
      }

      const arc = mapFriendArcRow(row);
      await putCached(client, arcId, key, { arc });
      await client.query("COMMIT");
      committed = true;
      return { arc, fromCache: false };
    } finally {
      if (!committed) {
        await client.query("ROLLBACK");
      }
    }
  } finally {
    client.release();
  }
}

async function completeChallenge({ store, key }) {
  const client = store.createClient();
  const arcId = store.arc.id;
  const userId = store.arc.user_id;

  try {
    const cached = await getCached(client, arcId, key);
    if (cached) {
      return { arc: cached.arc, fromCache: true };
    }

    await client.query("BEGIN");
    let committed = false;
    try {
      const { rows } = await client.query(SELECT_ARC_FOR_UPDATE, [arcId, userId]);
      if (!rows.length) throw new Error("Arc not found");
      const row = rows[0];
      const points = Number(row.challenge?.points ?? 0);
      const { row: updatedRow, percent } = await awardChallengeAndClear(client, {
        arcId,
        userId,
        delta: points,
        nextChallenge: null,
      });
      const arc = mapFriendArcRow(updatedRow);
      arc.percent = percent;
      await putCached(client, arcId, key, { arc });
      await client.query("COMMIT");
      committed = true;
      return { arc, fromCache: false };
    } finally {
      if (!committed) {
        await client.query("ROLLBACK");
      }
    }
  } finally {
    client.release();
  }
}

test("step completion with different idempotency keys preserves both updates", async () => {
  const store = new FakeArcStore(createArcRow());

  const [first, second] = await Promise.all([
    completeStep({ store, stepId: "step-1", key: "key-1" }),
    completeStep({ store, stepId: "step-2", key: "key-2" }),
  ]);

  assert.equal(first.arc.arcPoints, STEP_POINTS);
  assert.equal(second.arc.arcPoints, STEP_POINTS * 2);
  assert.equal(store.snapshot().arc_points, STEP_POINTS * 2);
});

test("duplicate idempotency key returns cached payload without double awarding", async () => {
  const store = new FakeArcStore(createArcRow());

  const first = await completeStep({ store, stepId: "step-1", key: "dupe-key" });
  const second = await completeStep({ store, stepId: "step-1", key: "dupe-key" });

  assert.equal(first.arc.arcPoints, STEP_POINTS);
  assert.deepEqual(second.arc, first.arc);
  assert.equal(store.snapshot().arc_points, STEP_POINTS);
});

test("arc reload matches mutation response percent and totals", async () => {
  const store = new FakeArcStore(createArcRow());
  const result = await completeStep({ store, stepId: "step-1", key: "reload-key" });

  const reloadedArc = mapFriendArcRow(store.snapshot());
  assert.equal(reloadedArc.arcPoints, result.arc.arcPoints);
  assert.equal(reloadedArc.pointsToday, result.arc.pointsToday);
  assert.equal(reloadedArc.percent, result.arc.percent);
});

test("challenge completion clears challenge and clamps percent", async () => {
  const store = new FakeArcStore(
    createArcRow({
      arc_points: 0,
      next_threshold: 0,
      challenge: { id: "challenge-1", templateId: "challenge-1", points: 15 },
    })
  );

  const result = await completeChallenge({ store, key: "challenge-key" });

  assert.equal(result.arc.arcPoints, 15);
  assert.equal(result.arc.percent, 0);
  assert.equal(result.arc.challenge, null);
});
