import express from "express";
import pool from "../Backend/db/pg.js";
import { mapFriendArcRow, toNumber, toSafeString } from "../Backend/lib/friendArcMapper.js";
import { getCached, putCached } from "../repos/idempotencyRepo.js";
import { awardAndMarkStepDone, awardChallengeAndClear } from "../services/pointsRepo.js";
import { progressPercent } from "../shared/metrics.js";
import { buildArcForSpecificPlan } from "../services/ArcGenerator.js";

const router = express.Router();

// TODO: plug in CSRF / allow-list middleware to restrict internal API access.

const STEP_POINTS = 5;
const DEFAULT_LIFETIME = {
  xp: 0,
  total_xp: 0,
  totalXp: 0,
  streak: "0 days",
  streak_days: 0,
  days: 0,
  current_streak: 0,
  currentStreak: 0,
  drag: "0%",
  drag_percent: 0,
  dragPercent: 0,
};

const DAILY_SURPRISE_LIMIT = 3;

const PLAN_PROMOTION_ORDER = [
  "One-Week Starter Arc (Daily)",
  "Acquaintance \u2192 Casual (Text-First, 21d)",
  "Casual \u2192 Friend (Mixed, 28d)",
  "Friend \u2192 Close (Hybrid, 42d)",
  "Close \u2192 Best/Inner Circle (Ritual, 56d)",
  "Three Week Text Reconnect",
  "Two Week Catch-Up Calls",
];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatStreakLabel(days) {
  const safeDays = Math.max(0, Math.round(Number.isFinite(days) ? days : 0));
  return `${safeDays} ${safeDays === 1 ? "day" : "days"}`;
}

function normalizeLifetimeSnapshot(input) {
  const base = isPlainObject(input) ? deepClone(input) : {};
  const xp = toNumber(
    base.xp ?? base.points ?? base.total_xp ?? base.totalXp,
    DEFAULT_LIFETIME.xp
  );
  let streakDays = toNumber(
    base.streak_days ?? base.days ?? base.current_streak ?? base.currentStreak,
    NaN
  );
  if (!Number.isFinite(streakDays)) {
    const streakText = toSafeString(base.streak, "");
    const match = streakText.match(/-?\d+/);
    if (match) {
      streakDays = Number(match[0]);
    }
  }
  if (!Number.isFinite(streakDays)) {
    streakDays = DEFAULT_LIFETIME.streak.startsWith("0") ? 0 : toNumber(DEFAULT_LIFETIME.streak, 0);
  }

  let dragPercent = toNumber(base.drag_percent ?? base.dragPercent, NaN);
  const dragText = toSafeString(base.drag, "");
  if (!Number.isFinite(dragPercent)) {
    const dragMatch = dragText.match(/-?\d+(\.\d+)?/);
    if (dragMatch) {
      dragPercent = Number(dragMatch[0]);
    }
  }
  const drag =
    dragText ||
    (Number.isFinite(dragPercent) ? `${dragPercent}%` : DEFAULT_LIFETIME.drag);

  return {
    source: base,
    xp: Math.max(0, xp),
    streakDays: Math.max(0, Math.round(streakDays)),
    drag,
    dragPercent: Number.isFinite(dragPercent) ? dragPercent : null,
  };
}

function coerceLifetimeObject(input) {
  const normalized = normalizeLifetimeSnapshot(input);
  const baseSource = isPlainObject(normalized.source) ? normalized.source : {};
  const result = { ...DEFAULT_LIFETIME, ...baseSource };
  const xp = Math.max(0, Math.round(normalized.xp));
  const streakDays = Math.max(0, Math.round(normalized.streakDays));

  result.xp = xp;
  result.total_xp = xp;
  result.totalXp = xp;
  result.streak_days = streakDays;
  result.days = streakDays;
  result.current_streak = streakDays;
  result.currentStreak = streakDays;
  result.streak = formatStreakLabel(streakDays);
  result.drag = normalized.drag;
  if (normalized.dragPercent !== null) {
    result.drag_percent = normalized.dragPercent;
    result.dragPercent = normalized.dragPercent;
  }
  if (!result.drag) {
    result.drag = DEFAULT_LIFETIME.drag;
  }
  return result;
}

function applyLifetimeGain(lifetimeInput, delta, { incrementStreak } = {}) {
  const normalized = normalizeLifetimeSnapshot(lifetimeInput);
  const gain = Number.isFinite(delta) ? delta : 0;
  const xp = Math.max(0, Math.round(normalized.xp + gain));
  let streakDays = normalized.streakDays;
  if (incrementStreak && gain > 0) {
    streakDays += 1;
  }

  const result = coerceLifetimeObject(normalized.source);
  result.xp = xp;
  result.total_xp = xp;
  result.totalXp = xp;
  result.streak_days = streakDays;
  result.days = streakDays;
  result.current_streak = streakDays;
  result.currentStreak = streakDays;
  result.streak = formatStreakLabel(streakDays);

  return result;
}
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
      const previousPointsToday = Number.isFinite(state.pointsToday) ? state.pointsToday : 0;
      state.pointsToday = previousPointsToday + delta;
      state.arcPoints = (Number.isFinite(state.arcPoints) ? state.arcPoints : 0) + delta;
      state.lifetime = applyLifetimeGain(state.lifetime, delta, {
        incrementStreak: previousPointsToday <= 0,
      });
      state.lifetime.dailySurpriseLimit = DAILY_SURPRISE_LIMIT;
      state.lifetime.daily_surprise_limit = DAILY_SURPRISE_LIMIT;
      advanceArcDayAfterStepCompletion(state);

      const { row, percent } = await awardAndMarkStepDone(client, {
        arcId,
        userId,
        delta,
        updatedSteps: state.steps,
        nextLifetime: state.lifetime,
        nextDay: state.day,
      });

      let arc = mapFriendArcRow(row);
      arc.percent = percent;

      const threshold = getArcThreshold(arc);
      const totalPoints = toNumber(arc.arcPoints, 0);

      let promotedArc = null;
      let cycleReset = false;
      if (totalPoints >= threshold) {
        promotedArc = await promoteArcIfEligible({
          client,
          arc,
          userId,
          previousPlanName: toSafeString(
            arc?.lifetime?.planName ?? arc?.lifetime?.plan_name ?? "",
            ""
          ),
        });
      }

      if (promotedArc) {
        arc = promotedArc;
      } else if (stepsAreComplete(arc) && totalPoints < threshold) {
        const resetArc = await resetArcStepsForAnotherCycle({
          client,
          arc,
          userId,
        });
        if (resetArc) {
          arc = resetArc;
          cycleReset = true;
        }
      }

      if (cycleReset && arc) {
        const existingFlags = isPlainObject(arc.clientFlags) ? arc.clientFlags : {};
        arc.clientFlags = {
          ...existingFlags,
          cycleReset: true,
          cycleResetAt: new Date().toISOString(),
        };
      }
      if (arc) {
        const pendingDayFlag = toNumber(
          arc.pendingDay ??
            arc.pending_day ??
            arc?.lifetime?.pendingDay ??
            arc?.lifetime?.pending_day,
          0
        );
        const pendingUnlockFlag =
          toSafeString(
            arc.pendingDayUnlockAt ??
              arc.pending_day_unlock_at ??
              arc?.lifetime?.pendingDayUnlockAt ??
              arc?.lifetime?.pending_day_unlock_at,
            ""
          ) || null;
        if (pendingDayFlag > 0) {
          const existingFlags = isPlainObject(arc.clientFlags) ? arc.clientFlags : {};
          arc.clientFlags = {
            ...existingFlags,
            awaitingNextDay: true,
            pendingDay: pendingDayFlag,
            pendingDayUnlockAt: pendingUnlockFlag,
          };
        } else if (isPlainObject(arc.clientFlags) && arc.clientFlags.awaitingNextDay) {
          const { awaitingNextDay, pendingDay, pendingDayUnlockAt, ...rest } = arc.clientFlags;
          arc.clientFlags = Object.keys(rest).length ? rest : null;
        }
      }

      return { changed: true, delta, persistedArc: arc };
    },
    { action: "arc.step.complete" }
  )
);

router.post("/api/arcs/:arcId/steps/refresh", (req, res) =>
  handleArcMutation(
    req,
    res,
    async ({ state, client, arcId, userId }) => {
      if (!state || !Array.isArray(state.steps) || !state.steps.length) {
        return { changed: false, delta: 0 };
      }

      const activeDay = Math.max(
        1,
        Number.isFinite(state.day) && state.day > 0 ? Math.round(state.day) : 1
      );

      const currentDayCompleted = state.steps.some((step, index) => {
        const fallbackDay = Math.floor(index / 2) + 1;
        const candidate = toNumber(
          step?.day,
          step?.day_number,
          step?.dayNumber,
          step?.day_index,
          step?.dayIndex
        );
        const normalized = Number.isFinite(candidate) && candidate > 0 ? candidate : fallbackDay;
        const stepDay = Math.max(1, Math.round(normalized));
        if (stepDay !== activeDay) return false;
        const status = toSafeString(step?.status ?? step?.state ?? "todo").toLowerCase();
        return status === "done";
      });

      if (currentDayCompleted) {
        return { changed: false, delta: 0 };
      }

      const planTemplateId = toNumber(
        state?.lifetime?.planTemplateId ?? state?.lifetime?.plan_template_id,
        0
      );
      if (!Number.isFinite(planTemplateId) || planTemplateId <= 0) {
        return { changed: false, delta: 0 };
      }

      const planRow = await fetchPlanTemplateById(client, planTemplateId);
      if (!planRow) {
        return { changed: false, delta: 0 };
      }

      const payload = {
        user_id: userId,
        friend_id: arcId,
        friend_name: state.name,
        tier: planRow.tier || state?.lifetime?.planName || "General",
        channel_pref: toSafeString(
          planRow.channel ||
            planRow.channel_variant ||
            state.channel ||
            state.lifetime?.channelVariant ||
            "mixed",
          "mixed"
        ),
        effort_capacity: toSafeString(
          planRow.effort || state.effort_capacity || state.lifetime?.effort || "medium",
          "medium"
        ),
        friend_score: state.friendScore ?? null,
        friend_type: state.friendType ?? null,
      };

      let arcRecord;
      try {
        arcRecord = await buildArcForSpecificPlan(client, payload, planRow, {
          forcedStarterPlan: Boolean(state?.lifetime?.starter7AutoSelected),
        });
      } catch (error) {
        console.error("[arcsApi] refresh failed while rebuilding plan:", error);
        return { changed: false, delta: 0 };
      }

      const freshSteps = Array.isArray(arcRecord?.steps)
        ? arcRecord.steps.filter((step) => {
            const candidate = toNumber(
              step?.day,
              step?.day_number,
              step?.dayNumber,
              step?.day_index,
              step?.dayIndex
            );
            const normalized = Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
            const stepDay = Math.max(1, Math.round(normalized || 0));
            return stepDay === activeDay;
          })
        : [];

      if (!freshSteps.length) {
        return { changed: false, delta: 0 };
      }

      let replacementIndex = 0;
      const updatedSteps = state.steps.map((existing, index) => {
        const fallbackDay = Math.floor(index / 2) + 1;
        const candidate = toNumber(
          existing?.day,
          existing?.day_number,
          existing?.dayNumber,
          existing?.day_index,
          existing?.dayIndex
        );
        const normalized = Number.isFinite(candidate) && candidate > 0 ? candidate : fallbackDay;
        const stepDay = Math.max(1, Math.round(normalized));
        if (stepDay !== activeDay) {
          return existing;
        }
        const template = freshSteps[replacementIndex % freshSteps.length];
        replacementIndex += 1;
        return {
          ...template,
          status: "todo",
          state: "todo",
          serverId: template.id,
          serverOrdinal: replacementIndex,
        };
      });

      state.steps = updatedSteps;
      state.clientFlags = {
        ...(isPlainObject(state.clientFlags) ? state.clientFlags : {}),
        refreshedAt: new Date().toISOString(),
      };

      return { changed: true, delta: 0 };
    },
    { action: "arc.step.refresh" }
  )
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
      const previousPointsToday = Number.isFinite(state.pointsToday) ? state.pointsToday : 0;
      state.pointsToday = previousPointsToday + points;
      state.arcPoints = (Number.isFinite(state.arcPoints) ? state.arcPoints : 0) + points;
      state.lifetime = applyLifetimeGain(state.lifetime, points, {
        incrementStreak: previousPointsToday <= 0 && points > 0,
      });
      state.lifetime.dailySurpriseLimit = DAILY_SURPRISE_LIMIT;
      state.lifetime.daily_surprise_limit = DAILY_SURPRISE_LIMIT;
      const tracker = getDailySurpriseTracker(state.lifetime);
      const rawCompletedCount = tracker.count + 1;
      const completedCount = rawCompletedCount > DAILY_SURPRISE_LIMIT ? DAILY_SURPRISE_LIMIT : rawCompletedCount;
      state.lifetime.dailySurpriseDate = tracker.today;
      state.lifetime.daily_surprise_date = tracker.today;
      state.lifetime.dailySurpriseCount = completedCount;
      state.lifetime.daily_surprise_count = completedCount;
      state.challenge = null;

      let nextChallenge = null;
      if (rawCompletedCount < DAILY_SURPRISE_LIMIT) {
        nextChallenge = await selectNextDailyChallenge(client, {
          arcId,
          previousChallenge: challenge,
          badges: state.badges,
        });
      }

      const persistedChallenge = nextChallenge ? deepClone(nextChallenge) : null;
      state.challenge = persistedChallenge;

      const { row, percent } = await awardChallengeAndClear(client, {
        arcId,
        userId,
        delta: points,
        nextChallenge: persistedChallenge,
        nextLifetime: state.lifetime,
      });

      let arc = mapFriendArcRow(row);
      arc.percent = percent;

      const threshold = getArcThreshold(arc);
      const totalPoints = toNumber(arc.arcPoints, 0);

      let promotedArc = null;
      if (totalPoints >= threshold) {
        promotedArc = await promoteArcIfEligible({
          client,
          arc,
          userId,
          previousPlanName: toSafeString(
            arc?.lifetime?.planName ?? arc?.lifetime?.plan_name ?? "",
            ""
          ),
        });
      }

      if (promotedArc) {
        arc = promotedArc;
      }

      return { changed: true, delta: points, persistedArc: arc };
    },
    { action: "arc.challenge.complete" }
  )
);

router.post("/api/arcs/:arcId/challenge/swap", (req, res) =>
  handleArcMutation(
    req,
    res,
    async ({ state, client }) => {
      const currentChallenge = state.challenge;
      if (!currentChallenge) {
        throw httpError(404, "No active challenge to swap");
      }

      const swapsRemaining = Number(currentChallenge.swapsLeft ?? currentChallenge.swaps_left ?? 0);
      if (!Number.isFinite(swapsRemaining) || swapsRemaining <= 0) {
        throw httpError(400, "No swaps remaining for this challenge");
      }

      const currentTemplateId = currentChallenge.templateId ?? currentChallenge.template_id ?? null;

      const existingTags = [
        ...(Array.isArray(currentChallenge.tags) ? currentChallenge.tags : []),
        ...(Array.isArray(state.badges?.tags) ? state.badges.tags : []),
      ];

      const preferredChannel = toSafeString(currentChallenge.channel, state.challenge?.channel).toLowerCase();
      const preferredEffort = toSafeString(currentChallenge.effort, state.challenge?.effort).toLowerCase();

      const candidate = await pickChallengeTemplate(client, {
        excludeTemplateIds: currentTemplateId ? [currentTemplateId] : [],
        preferredChannel,
        preferredEffort,
        existingTags,
      });

      if (!candidate) {
        throw httpError(404, "No alternative challenges available");
      }

      const swapsLeft = Math.max(0, swapsRemaining - 1);
      state.challenge = buildChallengePayload(candidate.row, {
        arcId: state.id ?? state.friendId ?? "friend",
        tags: candidate.tags,
        preferredChannel,
        preferredEffort,
        swapsLeft,
        fallbackTitle: currentChallenge.title,
        fallbackDescription: currentChallenge.description,
        fallbackEstMinutes: currentChallenge.estMinutes,
        fallbackPoints: currentChallenge.points,
      });

      return { changed: true, delta: 0 };
    },
    { action: "arc.challenge.swap" }
  )
);

router.delete("/api/arcs/:arcId", async (req, res) => {
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

    const arcId = toSafeString(req.params.arcId, "");
    if (!arcId) {
      return res.status(400).json({ error: "Arc identifier is required" });
    }

    const { rowCount } = await pool.query(
      `
        DELETE FROM friend_arcs
         WHERE user_id = $1
           AND id::text = $2
      `,
      [userId, arcId]
    );

    if (!rowCount) {
      return res.status(404).json({ error: "Arc not found" });
    }

    return res.json({ ok: true, deletedId: arcId });
  } catch (error) {
    console.error("[arcsApi] delete arc failed", error);
    return res.status(500).json({ error: "Failed to delete arc" });
  }
});

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

      const normalizePendingDayValue = (value) => {
        const numeric = toNumber(value, 0);
        return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
      };
      const normalizePendingUnlockValue = (value) => {
        const text = toSafeString(value, "");
        return text || null;
      };
      const originalLifetime = isPlainObject(currentRow.lifetime) ? currentRow.lifetime : {};
      const stateLifetime = isPlainObject(state.lifetime) ? state.lifetime : {};
      const persistedDay = Math.max(0, toNumber(currentRow.day, 0));
      const resolvedDay = Math.max(0, toNumber(state.day, persistedDay));
      const originalPendingDay = normalizePendingDayValue(
        originalLifetime.pendingDay ?? originalLifetime.pending_day
      );
      const originalPendingUnlock = normalizePendingUnlockValue(
        originalLifetime.pendingDayUnlockAt ?? originalLifetime.pending_day_unlock_at
      );
      const statePendingDay = normalizePendingDayValue(
        state.pendingDay ??
          state.pending_day ??
          stateLifetime.pendingDay ??
          stateLifetime.pending_day
      );
      const statePendingUnlock = normalizePendingUnlockValue(
        state.pendingDayUnlockAt ??
          state.pending_day_unlock_at ??
          stateLifetime.pendingDayUnlockAt ??
          stateLifetime.pending_day_unlock_at
      );
      const resolverTouchedState =
        resolvedDay !== persistedDay ||
        statePendingDay !== originalPendingDay ||
        statePendingUnlock !== originalPendingUnlock;

      const changed = mutationResult?.changed !== false;
      let delta = Number.isFinite(mutationResult?.delta) ? Number(mutationResult.delta) : 0;

      let responseArc;
      if (!changed) {
        if (resolverTouchedState) {
          finalizeState(state);
          const updatedRow = await updateArc(client, arcId, userId, state);
          if (!updatedRow) {
            throw httpError(404, "Arc not found after update");
          }
          responseArc = mapFriendArcRow(updatedRow);
        } else {
          responseArc = mutationResult?.overrideArc ?? mapFriendArcRow(currentRow);
        }
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
  const lifetime = coerceLifetimeObject(row.lifetime);
  const steps = Array.isArray(row.steps) ? deepClone(row.steps) : [];
  const challenge = row.challenge && typeof row.challenge === "object" ? deepClone(row.challenge) : null;
  const badges = row.badges && typeof row.badges === "object" ? deepClone(row.badges) : {};

  const pendingDay =
    toNumber(lifetime.pendingDay ?? lifetime.pending_day ?? row.pending_day ?? row.pendingDay, 0) || 0;
  const pendingDayUnlockAt =
    toSafeString(
      lifetime.pendingDayUnlockAt ??
        lifetime.pending_day_unlock_at ??
        row.pendingDayUnlockAt ??
        row.pending_day_unlock_at,
      ""
    ) || null;

  const state = {
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
    pendingDay: pendingDay > 0 ? pendingDay : null,
    pendingDayUnlockAt,
  };
  const totalDays = Math.max(1, toNumber(state.length, 1));
  resolvePendingDay(state, totalDays);
  return state;
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

  state.lifetime = coerceLifetimeObject(state.lifetime);
  state.steps = Array.isArray(state.steps) ? state.steps.map(normalizeStep) : [];
  state.challenge = state.challenge && typeof state.challenge === "object" ? state.challenge : null;
  state.badges = state.badges && typeof state.badges === "object" ? state.badges : {};

  const pendingDay = toNumber(state.pendingDay ?? state.pending_day, 0);
  const pendingDayUnlockAt = toSafeString(
    state.pendingDayUnlockAt ?? state.pending_day_unlock_at,
    ""
  );
  if (pendingDay > 0) {
    state.pendingDay = pendingDay;
    state.pending_day = pendingDay;
    state.lifetime.pendingDay = pendingDay;
    state.lifetime.pending_day = pendingDay;
  } else {
    delete state.pendingDay;
    delete state.pending_day;
    delete state.lifetime.pendingDay;
    delete state.lifetime.pending_day;
  }
  if (pendingDayUnlockAt) {
    state.pendingDayUnlockAt = pendingDayUnlockAt;
    state.pending_day_unlock_at = pendingDayUnlockAt;
    state.lifetime.pendingDayUnlockAt = pendingDayUnlockAt;
    state.lifetime.pending_day_unlock_at = pendingDayUnlockAt;
  } else {
    delete state.pendingDayUnlockAt;
    delete state.pending_day_unlock_at;
    delete state.lifetime.pendingDayUnlockAt;
    delete state.lifetime.pending_day_unlock_at;
  }
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

function parseStepKey(rawId) {
  const str = toSafeString(rawId, "");
  if (!str) {
    return { base: "", ordinal: 1, hasOrdinal: false };
  }
  const segments = str.split("__");
  if (segments.length <= 1) {
    return { base: str, ordinal: 1, hasOrdinal: false };
  }
  const possibleOrdinal = Number(segments[segments.length - 1]);
  if (Number.isFinite(possibleOrdinal) && possibleOrdinal >= 1) {
    return {
      base: segments.slice(0, -1).join("__"),
      ordinal: possibleOrdinal,
      hasOrdinal: true,
    };
  }
  return { base: str, ordinal: 1, hasOrdinal: false };
}

function findStepWithIndex(state, stepId) {
  if (!state?.steps || !Array.isArray(state.steps) || !stepId) return null;
  const target = parseStepKey(stepId);
  if (!target.base) return null;
  let occurrence = 0;
  for (let index = 0; index < state.steps.length; index += 1) {
    const step = state.steps[index];
    if (!step) continue;
    const candidateKey = parseStepKey(step.id ?? step.step_id ?? step.stepId);
    if (!candidateKey.base || candidateKey.base !== target.base) continue;
    occurrence += 1;
    const candidateOrdinal = candidateKey.hasOrdinal ? candidateKey.ordinal : occurrence;
    if (candidateOrdinal === target.ordinal) {
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

function getNextPlanName(currentName) {
  if (!currentName) return null;
  const index = PLAN_PROMOTION_ORDER.indexOf(currentName);
  if (index === -1 || index + 1 >= PLAN_PROMOTION_ORDER.length) {
    return null;
  }
  return PLAN_PROMOTION_ORDER[index + 1];
}

function stepsAreComplete(arc) {
  if (!arc || !Array.isArray(arc.steps) || !arc.steps.length) return false;
  return arc.steps.every((step) => {
    const status = typeof step?.status === "string" ? step.status.trim().toLowerCase() : "";
    return status === "done";
  });
}

function getArcThreshold(arc) {
  const threshold = toNumber(
    arc?.nextThreshold ?? arc?.next_threshold,
    0
  );
  return threshold > 0 ? threshold : 100;
}

async function fetchPlanTemplateByName(db, name) {
  if (!name) return null;
  const { rows } = await db.query(
    `
      SELECT id,
             name,
             tier,
             length_days,
             cadence_per_week,
             channel_variant,
             channel,
             effort,
             tags
        FROM plan_templates
       WHERE is_active = TRUE
         AND name = $1
       LIMIT 1
    `,
    [name]
  );
  return rows[0] || null;
}

async function fetchPlanTemplateById(db, id) {
  if (!id) return null;
  const { rows } = await db.query(
    `
      SELECT id,
             name,
             tier,
             length_days,
             cadence_per_week,
             channel_variant,
             channel,
             effort,
             tags
        FROM plan_templates
       WHERE is_active = TRUE
         AND id = $1
       LIMIT 1
    `,
    [id]
  );
  return rows[0] || null;
}

async function promoteArcIfEligible({ client, arc, userId, previousPlanName }) {
  if (!client || !arc || !userId) return null;
  const threshold = getArcThreshold(arc);
  if (toNumber(arc.arcPoints, 0) < threshold) return null;

  const nextPlanName = getNextPlanName(previousPlanName);
  if (!nextPlanName) return null;

  const planRow = await fetchPlanTemplateByName(client, nextPlanName);
  if (!planRow) {
    console.warn("[arcsApi] promotion skipped: plan not found", { nextPlanName });
    return null;
  }

  const payload = {
    user_id: userId,
    friend_id: arc.id,
    friend_name: arc.name,
    tier: planRow.tier || previousPlanName || "General",
    channel_pref: toSafeString(planRow.channel, planRow.channel_variant || "") || "mixed",
    effort_capacity: toSafeString(planRow.effort, "") || "medium",
    friend_score: arc.friendScore ?? null,
    friend_type: arc.friendType ?? null,
  };

  let arcRecord;
  try {
    arcRecord = await buildArcForSpecificPlan(client, payload, planRow);
  } catch (error) {
    console.error("[arcsApi] promotion failed while building next arc:", error);
    return null;
  }

  const previousLifetime = isPlainObject(arc.lifetime) ? deepClone(arc.lifetime) : {};
  const sequenceIndex = PLAN_PROMOTION_ORDER.indexOf(nextPlanName);
  const promotionLifetime = {
    ...previousLifetime,
    ...deepClone(arcRecord.lifetime),
    previousPlanName: previousPlanName || previousLifetime?.planName || null,
    planSequenceIndex: sequenceIndex >= 0 ? sequenceIndex : null,
  };

  const promotionState = {
    day: arcRecord.day,
    length: arcRecord.length,
    arcPoints: arcRecord.arcPoints,
    nextThreshold: arcRecord.nextThreshold,
    pointsToday: arcRecord.pointsToday,
    friendScore: arcRecord.friendScore ?? arc.friendScore ?? null,
    friendType: arcRecord.friendType ?? arc.friendType ?? null,
    lifetime: promotionLifetime,
    steps: arcRecord.steps,
    challenge: arcRecord.challenge,
    badges: arcRecord.badges,
  };

  const updatedRow = await updateArc(client, arc.id, userId, promotionState);
  if (!updatedRow) {
    return null;
  }

  const promotedArc = mapFriendArcRow(updatedRow);
  promotedArc.percent = progressPercent(promotedArc.arcPoints, promotedArc.nextThreshold);
  return promotedArc;
}

async function resetArcStepsForAnotherCycle({ client, arc, userId }) {
  if (!client || !arc || !userId) return null;
  if (!Array.isArray(arc.steps) || !arc.steps.length) return null;

  const resetSteps = arc.steps.map((step, index) => {
    const clone = deepClone(step) ?? {};
    clone.status = "todo";
    if (!clone.id) {
      clone.id = `step-${index + 1}`;
    }
    return clone;
  });

  const lifetime = isPlainObject(arc.lifetime) ? deepClone(arc.lifetime) : {};
  delete lifetime.pendingDay;
  delete lifetime.pending_day;
  delete lifetime.pendingDayUnlockAt;
  delete lifetime.pending_day_unlock_at;
  const cyclesCompleted = toNumber(
    lifetime?.cyclesCompleted ?? lifetime?.cycles_completed,
    0
  ) + 1;
  lifetime.cyclesCompleted = cyclesCompleted;
  lifetime.cycles_completed = cyclesCompleted;
  lifetime.dailySurpriseLimit = DAILY_SURPRISE_LIMIT;
  lifetime.daily_surprise_limit = DAILY_SURPRISE_LIMIT;

  const threshold = getArcThreshold(arc);
  const resetState = {
    day: 1,
    length: toNumber(arc.length, resetSteps.length),
    arcPoints: toNumber(arc.arcPoints, 0),
    nextThreshold: threshold,
    pointsToday: toNumber(arc.pointsToday, 0),
    friendScore: arc.friendScore == null ? null : toNumber(arc.friendScore, 0),
    friendType: arc.friendType ?? null,
    lifetime,
    steps: resetSteps,
    challenge: arc.challenge ? deepClone(arc.challenge) : null,
    badges: arc.badges && typeof arc.badges === "object" ? deepClone(arc.badges) : {},
    pendingDay: null,
    pending_day: null,
    pendingDayUnlockAt: null,
    pending_day_unlock_at: null,
  };

  const updatedRow = await updateArc(client, arc.id, userId, resetState);
  if (!updatedRow) return null;
  const updatedArc = mapFriendArcRow(updatedRow);
  updatedArc.percent = progressPercent(updatedArc.arcPoints, updatedArc.nextThreshold);
  const existingFlags = isPlainObject(updatedArc.clientFlags) ? updatedArc.clientFlags : {};
  updatedArc.clientFlags = {
    ...existingFlags,
    cycleReset: true,
    cycleResetAt: new Date().toISOString(),
  };
  return updatedArc;
}

function extractStepDay(step, fallback = 1) {
  const rawDay =
    step?.day ??
    step?.day_number ??
    step?.dayNumber ??
    null;
  const numeric = toNumber(rawDay, fallback);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  return rounded > 0 ? rounded : fallback;
}

function findNextIncompleteDay(steps, minDay) {
  if (!Array.isArray(steps)) return null;
  let candidate = null;
  for (const step of steps) {
    const status = toSafeString(step?.status, "todo").toLowerCase();
    if (status === "done") continue;
    const day = extractStepDay(step, minDay);
    if (day >= minDay && (candidate === null || day < candidate)) {
      candidate = day;
    }
  }
  return candidate;
}

function computeNextDayUnlockAt(now = new Date()) {
  const unlock = new Date(now);
  unlock.setHours(24, 0, 0, 0);
  return unlock.toISOString();
}

function clearPendingDay(state) {
  if (!state) return;
  const lifetime = state.lifetime && typeof state.lifetime === "object" ? state.lifetime : {};
  delete state.pendingDay;
  delete state.pending_day;
  delete state.pendingDayUnlockAt;
  delete state.pending_day_unlock_at;
  delete lifetime.pendingDay;
  delete lifetime.pending_day;
  delete lifetime.pendingDayUnlockAt;
  delete lifetime.pending_day_unlock_at;
}

function schedulePendingDay(state, targetDay, now = new Date()) {
  if (!state || !targetDay) return;
  const lifetime = state.lifetime && typeof state.lifetime === "object" ? state.lifetime : (state.lifetime = {});
  const nextDay = Math.max(1, Math.round(targetDay));
  state.pendingDay = nextDay;
  state.pending_day = nextDay;
  lifetime.pendingDay = nextDay;
  lifetime.pending_day = nextDay;
  const unlockIso = computeNextDayUnlockAt(now);
  state.pendingDayUnlockAt = unlockIso;
  state.pending_day_unlock_at = unlockIso;
  lifetime.pendingDayUnlockAt = unlockIso;
  lifetime.pending_day_unlock_at = unlockIso;
}

function resolvePendingDay(state, totalDays) {
  if (!state) {
    return { currentDay: 1, lifetime: {} };
  }
  const lifetime = state.lifetime && typeof state.lifetime === "object" ? state.lifetime : (state.lifetime = {});
  let currentDay = toNumber(state.day, 1);
  if (!Number.isFinite(currentDay) || currentDay < 1) currentDay = 1;

  const pendingDayCandidate = toNumber(
    state.pendingDay ?? state.pending_day ?? lifetime.pendingDay ?? lifetime.pending_day,
    0
  );
  const pendingUnlockIso = toSafeString(
    state.pendingDayUnlockAt ??
      state.pending_day_unlock_at ??
      lifetime.pendingDayUnlockAt ??
      lifetime.pending_day_unlock_at,
    ""
  );

  if (pendingDayCandidate > 0) {
    const pendingUnlockTimestamp = pendingUnlockIso ? Date.parse(pendingUnlockIso) : NaN;
    if (!Number.isFinite(pendingUnlockTimestamp) || pendingUnlockTimestamp <= Date.now()) {
      const unlockedDay = Math.max(
        1,
        Math.min(totalDays, Math.round(pendingDayCandidate))
      );
      state.day = unlockedDay;
      currentDay = unlockedDay;
      clearPendingDay(state);
    } else {
      state.pendingDay = Math.max(1, Math.round(pendingDayCandidate));
      state.pending_day = state.pendingDay;
      lifetime.pendingDay = state.pendingDay;
      lifetime.pending_day = state.pendingDay;
      state.pendingDayUnlockAt = pendingUnlockIso;
      state.pending_day_unlock_at = pendingUnlockIso;
      lifetime.pendingDayUnlockAt = pendingUnlockIso;
      lifetime.pending_day_unlock_at = pendingUnlockIso;
    }
  }

  return { currentDay, lifetime };
}

function advanceArcDayAfterStepCompletion(state) {
  if (!state || !Array.isArray(state.steps)) return;
  const totalDays = Math.max(1, toNumber(state.length, 1));
  const { currentDay: resolvedDay } = resolvePendingDay(state, totalDays);
  let currentDay = resolvedDay;

  const stepsForCurrentDay = state.steps.filter(
    (step) => extractStepDay(step, currentDay) === currentDay
  );

  if (!stepsForCurrentDay.length) {
    const nextCandidate = findNextIncompleteDay(state.steps, currentDay + 1);
    if (nextCandidate !== null && nextCandidate > currentDay) {
      schedulePendingDay(state, nextCandidate);
    }
    state.day = currentDay;
    return;
  }

  const hasRemaining = stepsForCurrentDay.some((step) => {
    const status = toSafeString(step?.status, "todo").toLowerCase();
    return status !== "done";
  });

  if (!hasRemaining) {
    const nextCandidate = findNextIncompleteDay(state.steps, currentDay + 1);
    let targetDay = null;
    if (nextCandidate !== null) {
      targetDay = nextCandidate;
    } else if (currentDay < totalDays) {
      targetDay = Math.min(totalDays, currentDay + 1);
    }
    if (targetDay && targetDay > currentDay) {
      schedulePendingDay(state, targetDay);
    } else {
      clearPendingDay(state);
    }
  } else {
    clearPendingDay(state);
  }

  const normalizedDay = toNumber(state.day, currentDay);
  state.day = Math.max(
    1,
    Math.min(
      totalDays,
      Number.isFinite(normalizedDay) ? Math.round(normalizedDay) : currentDay
    )
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDailySurpriseTracker(lifetime) {
  const today = todayKey();
  const storedDate = toSafeString(
    lifetime?.dailySurpriseDate ?? lifetime?.daily_surprise_date,
    ""
  );
  let count = toNumber(
    lifetime?.dailySurpriseCount ?? lifetime?.daily_surprise_count,
    0
  );
  if (storedDate !== today) {
    count = 0;
  }
  return { today, count };
}

async function pickChallengeTemplate(client, {
  excludeTemplateIds = [],
  preferredChannel,
  preferredEffort,
  existingTags = [],
}) {
  const exclude = new Set(
    (excludeTemplateIds || [])
      .filter((value) => value !== null && value !== undefined)
      .map((value) => String(value))
  );

  const normalizedExisting = new Set();
  const tagSources = Array.isArray(existingTags)
    ? existingTags
    : existingTags instanceof Set
    ? Array.from(existingTags)
    : existingTags
    ? [existingTags]
    : [];
  for (const tag of tagSources) {
    const normalized = toSafeString(tag, "").toLowerCase();
    if (normalized) normalizedExisting.add(normalized);
  }

  const { rows } = await client.query(
    `
      SELECT
        id,
        title_template       AS title,
        description_template AS description,
        channel,
        effort,
        tags,
        est_minutes,
        points,
        swaps_allowed
      FROM challenge_templates
      WHERE is_active = TRUE
    `
  );

  const candidates = rows
    .filter((row) => !exclude.has(String(row.id)))
    .map((row) => {
      const tags = normalizeTags(row.tags);
      const overlap = countOverlap(tags, normalizedExisting);
      const channelScore = scoreChannel(row.channel, preferredChannel);
      const effortScore = scoreEffort(row.effort, preferredEffort);
      const totalScore = overlap * 10 + channelScore + effortScore;
      return { row, tags, overlap, totalScore };
    })
    .filter((candidate) => candidate.totalScore >= 0);

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return String(a.row.id).localeCompare(String(b.row.id));
  });

  return candidates[0];
}

function buildChallengePayload(templateRow, {
  arcId,
  tags = [],
  preferredChannel,
  preferredEffort,
  swapsLeft,
  fallbackTitle,
  fallbackDescription,
  fallbackEstMinutes,
  fallbackPoints,
}) {
  const arcKey = toSafeString(arcId, "friend");
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = toSafeString(templateRow.channel, preferredChannel);
  const effort = toSafeString(templateRow.effort, preferredEffort);
  const estMinutes = Math.max(
    0,
    toNumber(templateRow.est_minutes, fallbackEstMinutes ?? 15)
  );
  const basePoints = Math.max(
    0,
    toNumber(templateRow.points, fallbackPoints ?? 0)
  );
  const normalizedEffort = (effort || (preferredEffort || "low")).toLowerCase();
  const points = normalizedEffort === "low" ? 10 : basePoints;
  const resolvedSwaps =
    swapsLeft !== undefined && swapsLeft !== null
      ? Math.max(0, Math.round(swapsLeft))
      : Math.max(0, toNumber(templateRow.swaps_allowed, 1));

  return {
    id: `${arcKey}-challenge-${uniqueSuffix}`,
    templateId: templateRow.id,
    template_id: templateRow.id,
    title: toSafeString(templateRow.title, fallbackTitle || "Daily surprise"),
    description: toSafeString(templateRow.description, fallbackDescription || ""),
    channel: channel || (preferredChannel || null),
    effort: effort || (preferredEffort || "low"),
    tags,
    estMinutes,
    est_minutes: estMinutes,
    points,
    swapsLeft: resolvedSwaps,
    swaps_left: resolvedSwaps,
    isFallback: false,
  };
}

async function selectNextDailyChallenge(client, {
  arcId,
  previousChallenge,
  badges,
}) {
  const excludeTemplateIds = [];
  const previousTemplateId =
    previousChallenge?.templateId ??
    previousChallenge?.template_id ??
    previousChallenge?.id ??
    null;
  if (previousTemplateId) {
    excludeTemplateIds.push(previousTemplateId);
  }

  const preferredChannel = toSafeString(previousChallenge?.channel, "").toLowerCase();
  const preferredEffort = toSafeString(previousChallenge?.effort, "").toLowerCase();

  const existingTags = [
    ...(Array.isArray(previousChallenge?.tags) ? previousChallenge.tags : []),
    ...(Array.isArray(badges?.tags) ? badges.tags : []),
  ];

  const candidate = await pickChallengeTemplate(client, {
    excludeTemplateIds,
    preferredChannel,
    preferredEffort,
    existingTags,
  });

  if (!candidate) {
    return null;
  }

  const resolvedSwapsAllowed = Math.max(
    0,
    toNumber(candidate.row.swaps_allowed, 1)
  );

  return buildChallengePayload(candidate.row, {
    arcId,
    tags: candidate.tags,
    preferredChannel,
    preferredEffort,
    swapsLeft: resolvedSwapsAllowed,
    fallbackTitle: previousChallenge?.title,
    fallbackDescription: previousChallenge?.description,
    fallbackEstMinutes: previousChallenge?.estMinutes,
    fallbackPoints: previousChallenge?.points,
  });
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
