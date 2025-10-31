import express from "express";
import pool from "../Backend/db/pg.js";
import { mapFriendArcRow, toNumber, toSafeString } from "../Backend/lib/friendArcMapper.js";
import { getCached, putCached } from "../repos/idempotencyRepo.js";
import { awardAndMarkStepDone, awardChallengeAndClear } from "../services/pointsRepo.js";
import { progressPercent } from "../shared/metrics.js";

const router = express.Router();

// TODO: plug in CSRF / allow-list middleware to restrict internal API access.

const STEP_POINTS = 5;
const DEFAULT_LIFETIME = { xp: 0, streak: "0 days", drag: "0%" };
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

router.post("/api/arcs/:arcId/photo", (req, res) =>
  handleArcMutation(
    req,
    res,
    async ({ arcId, userId, req: request, currentRow }) => {
      const picture = request?.body?.picture;
      if (typeof picture !== "string" || !isDataImage(picture)) {
        throw httpError(400, "Invalid image data");
      }

    const estimatedBytes = estimateDataUrlSize(picture);
    if (estimatedBytes > MAX_IMAGE_SIZE_BYTES) {
      throw httpError(400, "Image exceeds the 2MB limit");
    }

    const friendId = String(arcId);
    const { rowCount } = await pool.query(
      `
        UPDATE friends
           SET picture = $1,
               updated_at = NOW()
         WHERE id::text = $2
           AND owner_user_id = $3
      `,
      [picture, friendId, userId]
    );

    if (!rowCount) {
      throw httpError(404, "Friend not found");
    }

    const arc = mapFriendArcRow(currentRow);
    const snapshot =
      arc.snapshot && typeof arc.snapshot === "object"
        ? { ...arc.snapshot }
        : {};
    if (!snapshot.photo) snapshot.photo = picture;
    if (!snapshot.picture) snapshot.picture = picture;
    arc.snapshot = snapshot;
    arc.picture = picture;
    arc.photoSrc = picture;

      return { changed: false, overrideArc: arc };
    },
    { action: "arc.photo.upload" }
  )
);

router.post("/api/arcs/:arcId/steps/:stepId/start", (req, res) =>
  handleArcMutation(req, res, ({ state, stepId }) => {
    const located = findStepWithIndex(state, stepId);
    const step = located?.step;
    if (!step) throw httpError(404, "Step not found");
    if (step.status === "done" || step.status === "inProgress") {
      return { changed: false };
    }
    step.status = "inProgress";
    return { changed: true, delta: 0 };
  }, { action: "arc.step.start" })
);

router.post("/api/arcs/:arcId/steps/:stepId/complete", (req, res) =>
  handleArcMutation(
    req,
    res,
    async ({ state, stepId, client, arcId, userId }) => {
      const located = findStepWithIndex(state, stepId);
      if (!located) throw httpError(404, "Step not found");

      const { step } = located;
      if (step.status === "done") {
        return { changed: false, delta: 0 };
      }

      const delta = STEP_POINTS;
      step.status = "done";
      state.pointsToday += delta;
      state.arcPoints += delta;

      const { row, percent } = await awardAndMarkStepDone(client, {
        arcId,
        userId,
        delta,
        updatedSteps: state.steps,
      });

      const arc = mapFriendArcRow(row);
      arc.percent = percent;

      return { changed: true, delta, persistedArc: arc };
    },
    { action: "arc.step.complete" }
  )
);

router.post("/api/arcs/:arcId/steps/extend", (req, res) =>
  handleArcMutation(req, res, () => ({ changed: false, delta: 0 }), { action: "arc.step.extend" })
);

router.post("/api/arcs/:arcId/steps/snooze", (req, res) =>
  handleArcMutation(req, res, () => ({ changed: false, delta: 0 }), { action: "arc.step.snooze" })
);

router.post("/api/arcs/:arcId/steps/fail-forward", (req, res) =>
  handleArcMutation(req, res, ({ state }) => {
    const nextDay = Math.min(state.day + 1, Math.max(state.length, 1));
    if (nextDay === state.day) {
      return { changed: false };
    }
    state.day = nextDay;
    return { changed: true, delta: 0 };
  }, { action: "arc.step.fail-forward" })
);

router.post("/api/arcs/:arcId/challenge/:challengeId/complete", (req, res) =>
  handleArcMutation(
    req,
    res,
    async ({ state, challengeId, client, arcId, userId }) => {
      const challenge = state.challenge;
      if (!challenge) {
        return { changed: false, delta: 0 };
      }

      const identifiers = new Set(
        [
          challenge.id,
          challenge.templateId,
          challenge.template_id,
        ]
          .filter((value) => value !== null && value !== undefined)
          .map((value) => String(value))
      );

      if (!identifiers.has(String(challengeId))) {
        throw httpError(404, "Challenge not found");
      }

      const points = Math.max(0, toNumber(challenge.points, 0));
      state.pointsToday += points;
      state.arcPoints += points;
      state.challenge = null;

      const { row, percent } = await awardChallengeAndClear(client, {
        arcId,
        userId,
        delta: points,
        nextChallenge: null,
      });

      const arc = mapFriendArcRow(row);
      arc.percent = percent;

      return { changed: true, delta: points, persistedArc: arc };
    },
    { action: "arc.challenge.complete" }
  )
);

router.post("/api/arcs/:arcId/challenge/swap", (req, res) =>
  handleArcMutation(
    req,
    res,
    async ({ state }) => {
      const currentChallenge = state.challenge;
      if (!currentChallenge) {
        throw httpError(404, "No active challenge to swap");
      }

    const swapsRemaining = Number(currentChallenge.swapsLeft ?? currentChallenge.swaps_left ?? 0);
    if (!Number.isFinite(swapsRemaining) || swapsRemaining <= 0) {
      throw httpError(400, "No swaps remaining for this challenge");
    }

    const currentTemplateId = currentChallenge.templateId ?? currentChallenge.template_id ?? null;

    const existingTags = new Set([
      ...(Array.isArray(currentChallenge.tags) ? currentChallenge.tags : []),
      ...(Array.isArray(state.badges?.tags) ? state.badges.tags : []),
    ].map((tag) => String(tag).toLowerCase()));

    const preferredChannel = toSafeString(currentChallenge.channel, state.challenge?.channel).toLowerCase();
    const preferredEffort = toSafeString(currentChallenge.effort, state.challenge?.effort).toLowerCase();

    const { rows } = await pool.query(
      `
        SELECT
          id,
          title_template       AS title,
          description_template AS description,
          channel,
          effort,
          tags,
          est_minutes,
          points
        FROM challenge_templates
        WHERE is_active = TRUE
      `
    );

    const candidates = rows
      .filter((row) => String(row.id) !== String(currentTemplateId))
      .map((row) => {
        const tags = normalizeTags(row.tags);
        const overlap = countOverlap(tags, existingTags);
        const channelScore = scoreChannel(row.channel, preferredChannel);
        const effortScore = scoreEffort(row.effort, preferredEffort);
        const totalScore = overlap * 10 + channelScore + effortScore;
        return { row, tags, overlap, totalScore };
      })
      .filter((candidate) => candidate.totalScore >= 0);

    if (!candidates.length) {
      throw httpError(404, "No alternative challenges available");
    }

    candidates.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return String(a.row.id).localeCompare(String(b.row.id));
    });

    const best = candidates[0];
    state.challenge = {
      id: `${state.id ?? state.friendId ?? "friend"}-challenge-${Date.now()}`,
      templateId: best.row.id,
      title: best.row.title,
      description: best.row.description,
      channel: toSafeString(best.row.channel, currentChallenge.channel),
      effort: toSafeString(best.row.effort, currentChallenge.effort),
      tags: best.tags,
      estMinutes: Math.max(0, toNumber(best.row.est_minutes, currentChallenge.estMinutes ?? 15)),
      points: Math.max(0, toNumber(best.row.points, currentChallenge.points ?? 0)),
      swapsLeft: swapsRemaining - 1,
    };

    return { changed: true, delta: 0 };
    },
    { action: "arc.challenge.swap" }
  )
);

export default router;

async function handleArcMutation(req, res, mutator, options = {}) {
  const actionName = options.action ?? req.route?.path ?? "arc.mutation";
  try {
    const expectedCsrf = req.session?.csrfToken;
    const providedCsrf = req.get("X-CSRF-Token");
    if (!expectedCsrf || !providedCsrf || providedCsrf !== expectedCsrf) {
      return res.status(403).json({ error: "Invalid CSRF token" });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const arcId = req.params.arcId;
    if (!arcId) {
      throw httpError(400, "Arc identifier is required");
    }

    const idempotencyKey = req.get("Idempotency-Key");
    if (!idempotencyKey) {
      return res.status(400).json({ error: "Missing Idempotency-Key" });
    }

    const client = await pool.connect();
    let inTransaction = false;
    try {
      const cached = await getCached(client, arcId, idempotencyKey);
      if (cached) {
        console.info(
          JSON.stringify({
            source: "arc-mutation",
            arcId,
            action: actionName,
            idempotencyKey,
            cacheHit: true,
            timestamp: new Date().toISOString(),
          })
        );
        return res.json(cached);
      }

      await client.query("BEGIN");
      inTransaction = true;

      const arcRowResult = await client.query(
        `
          SELECT
            id,
            user_id,
            name,
            day,
            length,
            arc_points,
            next_threshold,
            points_today,
            friend_score,
            friend_type,
            lifetime,
            steps,
            challenge,
            badges
          FROM friend_arcs
          WHERE id = $1 AND user_id = $2
          FOR UPDATE
          LIMIT 1
        `,
        [arcId, userId]
      );

      if (!arcRowResult.rows.length) {
        throw httpError(404, "Arc not found");
      }

      const currentRow = arcRowResult.rows[0];
      const thresholdValue = Number(currentRow.next_threshold);
      if (!Number.isFinite(thresholdValue) || thresholdValue <= 0) {
        await client.query(
          `
            UPDATE friend_arcs
               SET next_threshold = 100,
                   updated_at     = NOW()
             WHERE id = $1
               AND user_id = $2
          `,
          [arcId, userId]
        );
        currentRow.next_threshold = 100;
      }
      const state = buildStateFromRow(currentRow);

      const context = {
        state,
        arcId,
        userId,
        stepId: req.params.stepId ? String(req.params.stepId) : null,
        challengeId: req.params.challengeId ? String(req.params.challengeId) : null,
        req,
        currentRow,
        client,
        idempotencyKey,
      };

      const mutationResult = await mutator(context);

      const changed = mutationResult?.changed !== false;
      let delta = Number.isFinite(mutationResult?.delta) ? Number(mutationResult.delta) : 0;

      let responseArc;
      if (!changed) {
        responseArc = mutationResult?.overrideArc ?? mapFriendArcRow(currentRow);
      } else if (mutationResult?.persistedArc) {
        responseArc = mutationResult.persistedArc;
      } else if (mutationResult?.persistedRow) {
        responseArc = mapFriendArcRow(mutationResult.persistedRow);
      } else {
        finalizeState(state);
        const updatedRow = await updateArc(client, arcId, userId, state);
        if (!updatedRow) {
          throw httpError(404, "Arc not found after update");
        }
        responseArc = mapFriendArcRow(updatedRow);
        if (!delta) {
          delta = responseArc.arcPoints - toNumber(currentRow.arc_points, 0);
        }
      }

      {
        const points = toNumber(responseArc?.arcPoints, 0);
        const fallbackThreshold = toNumber(responseArc?.next_threshold, 0);
        const incomingThreshold = toNumber(responseArc?.nextThreshold, fallbackThreshold);
        const threshold = incomingThreshold > 0 ? incomingThreshold : 100;
        responseArc.percent = progressPercent(points, threshold);
        if (responseArc.nextThreshold !== undefined) {
          responseArc.nextThreshold = threshold;
        }
        if (responseArc.next_threshold !== undefined) {
          responseArc.next_threshold = threshold;
        }
      }
      }

      const payload = { arc: responseArc };
      await putCached(client, arcId, idempotencyKey, payload);
      await client.query("COMMIT");
      inTransaction = false;

      console.info(
        JSON.stringify({
          source: "arc-mutation",
          arcId,
          action: actionName,
          idempotencyKey,
          delta: Number.isFinite(delta) ? delta : 0,
          newArcPoints: responseArc.arcPoints,
          timestamp: new Date().toISOString(),
        })
      );

      return res.json(payload);
    } catch (error) {
      if (inTransaction) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore rollback errors
        }
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const status = error.status ?? 500;
    const message = error.message || "Failed to update arc";
    if (status >= 500) {
      console.error("[arcsApi] mutation failed:", error);
    }
    return res.status(status).json({ error: message });
  }
}

function buildStateFromRow(row) {
  const lifetime = row.lifetime && typeof row.lifetime === "object" ? deepClone(row.lifetime) : { ...DEFAULT_LIFETIME };
  const steps = Array.isArray(row.steps) ? deepClone(row.steps) : [];
  const challenge = row.challenge && typeof row.challenge === "object" ? deepClone(row.challenge) : null;
  const badges = row.badges && typeof row.badges === "object" ? deepClone(row.badges) : {};

  return {
    id: row.id,
    friendId: row.id ?? null,
    name: toSafeString(row.name, `Friend ${row.id ?? ""}`),
    day: Math.max(0, toNumber(row.day, 0)),
    length: Math.max(0, toNumber(row.length, 0)),
    arcPoints: Math.max(0, toNumber(row.arc_points, 0)),
    nextThreshold: toNumber(row.next_threshold, 0) > 0 ? toNumber(row.next_threshold, 0) : 100,
    pointsToday: Math.max(0, toNumber(row.points_today, 0)),
    friendScore: row.friend_score == null ? null : toNumber(row.friend_score, 0),
    friendType: toSafeString(row.friend_type, null) || null,
    lifetime,
    steps,
    challenge,
    badges,
  };
}

function finalizeState(state) {
  state.day = Math.max(0, toNumber(state.day, 0));
  state.length = Math.max(0, toNumber(state.length, 0));
  state.arcPoints = Math.max(0, toNumber(state.arcPoints, 0));
  state.nextThreshold = toNumber(state.nextThreshold, 0);
  if (state.nextThreshold <= 0) {
    state.nextThreshold = 100;
  }
  state.pointsToday = Math.max(0, toNumber(state.pointsToday, 0));
  if (state.friendScore != null) {
    state.friendScore = toNumber(state.friendScore, 0);
  }

  state.lifetime = state.lifetime && typeof state.lifetime === "object" ? state.lifetime : { ...DEFAULT_LIFETIME };
  state.steps = Array.isArray(state.steps) ? state.steps.map(normalizeStep) : [];
  state.challenge = state.challenge && typeof state.challenge === "object" ? state.challenge : null;
  state.badges = state.badges && typeof state.badges === "object" ? state.badges : {};

}

function normalizeStep(step, index) {
  if (!step || typeof step !== "object") {
    return {
      id: `step-${index + 1}`,
      title: `Step ${index + 1}`,
      status: "todo",
      meta: "",
    };
  }
  const id = toSafeString(step.id ?? step.step_id ?? step.stepId, `step-${index + 1}`);
  const title = toSafeString(step.title ?? step.name, `Step ${index + 1}`);
  const status = toSafeString(step.status ?? step.state, "todo") || "todo";
  const meta = toSafeString(step.meta ?? step.hint ?? step.summary, "");
  const clone = { ...step, id, title, status, meta };
  return clone;
}

function findStepWithIndex(state, stepId) {
  if (!state?.steps || !Array.isArray(state.steps) || !stepId) return null;
  const id = String(stepId);
  for (let index = 0; index < state.steps.length; index += 1) {
    const step = state.steps[index];
    if (step && String(step.id ?? step.step_id ?? step.stepId) === id) {
      return { step, index };
    }
  }
  return null;
}

function findStep(state, stepId) {
  return findStepWithIndex(state, stepId)?.step ?? null;
}

async function updateArc(db, arcId, userId, state) {
  const { rows } = await db.query(
    `
      UPDATE friend_arcs
         SET day = $3,
             length = $4,
             arc_points = $5,
             next_threshold = $6,
             points_today = $7,
             friend_score = $8,
             friend_type = $9,
             lifetime = $10::jsonb,
             steps = $11::jsonb,
             challenge = $12::jsonb,
             badges = $13::jsonb
       WHERE id = $1 AND user_id = $2
   RETURNING id, user_id, name, day, length, arc_points, next_threshold, points_today, friend_score, friend_type, lifetime, steps, challenge, badges
    `,
    [
      arcId,
      userId,
      state.day,
      state.length,
      state.arcPoints,
      state.nextThreshold,
      state.pointsToday,
      state.friendScore,
      state.friendType,
      JSON.stringify(state.lifetime),
      JSON.stringify(state.steps),
      JSON.stringify(state.challenge),
      JSON.stringify(state.badges),
    ]
  );

  return rows[0];
}

function normalizeTags(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeTags(item))
      .filter(Boolean)
      .map((tag) => tag.toLowerCase());
  }
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try {
      const trimmed = value.trim();
      if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
        const parsed = JSON.parse(trimmed);
        return normalizeTags(parsed);
      }
    } catch {
      // ignore parse errors
    }
    return value
      .split(/[,|]/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.values(value)
      .flatMap((item) => normalizeTags(item))
      .filter(Boolean);
  }
  return [String(value).trim().toLowerCase()].filter(Boolean);
}

function countOverlap(tags, tagSet) {
  if (!Array.isArray(tags) || !(tagSet instanceof Set) || !tagSet.size) {
    return 0;
  }
  let overlap = 0;
  for (const tag of tags) {
    if (tagSet.has(tag)) overlap += 1;
  }
  return overlap;
}

function scoreChannel(candidateChannel, preferredChannel) {
  const candidate = toSafeString(candidateChannel, "").toLowerCase();
  if (!candidate && !preferredChannel) return 0;
  if (candidate === preferredChannel) return 6;
  if (candidate === "mixed" || preferredChannel === "mixed") return 3;
  return 0;
}

function scoreEffort(candidateEffort, preferredEffort) {
  const candidate = toSafeString(candidateEffort, "").toLowerCase();
  if (!candidate && !preferredEffort) return 0;
  if (candidate === preferredEffort) return 4;
  return 0;
}

function isDataImage(value) {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

function estimateDataUrlSize(value) {
  if (typeof value !== "string") return 0;
  const commaIndex = value.indexOf(",");
  if (commaIndex === -1) return 0;
  const base64 = value.slice(commaIndex + 1).replace(/\s/g, "");
  return Math.ceil((base64.length * 3) / 4);
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
