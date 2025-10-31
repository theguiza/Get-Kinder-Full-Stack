import { progressPercent } from "../shared/metrics.js";

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

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function normalizeLifetimeForStorage(lifetime) {
  if (!isPlainObject(lifetime)) {
    return DEFAULT_LIFETIME;
  }
  const next = { ...DEFAULT_LIFETIME, ...lifetime };

  const toFiniteNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const xpCandidate =
    toFiniteNumber(next.xp) ??
    toFiniteNumber(next.total_xp) ??
    toFiniteNumber(next.totalXp) ??
    DEFAULT_LIFETIME.xp;
  const xp = Math.max(0, Math.round(xpCandidate));
  next.xp = xp;
  next.total_xp = xp;
  next.totalXp = xp;

  const extractDays = () => {
    const fromNumeric =
      toFiniteNumber(next.streak_days) ??
      toFiniteNumber(next.days) ??
      toFiniteNumber(next.current_streak) ??
      toFiniteNumber(next.currentStreak);
    if (fromNumeric !== null) return fromNumeric;
    if (typeof next.streak === "string") {
      const match = next.streak.match(/-?\d+/);
      if (match) {
        const parsed = Number(match[0]);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return 0;
  };

  const rawDays = extractDays();
  const days = Math.max(0, Math.round(rawDays));
  next.streak_days = days;
  next.days = days;
  next.current_streak = days;
  next.currentStreak = days;
  next.streak =
    typeof next.streak === "string" && next.streak.trim()
      ? next.streak
      : `${days} ${days === 1 ? "day" : "days"}`;

  const dragCandidate =
    toFiniteNumber(next.drag_percent) ?? toFiniteNumber(next.dragPercent);
  if (dragCandidate !== null) {
    next.drag_percent = dragCandidate;
    next.dragPercent = dragCandidate;
    if (typeof next.drag !== "string" || !next.drag.trim()) {
      next.drag = `${dragCandidate}%`;
    }
  }

  if (typeof next.drag !== "string" || !next.drag.trim()) {
    next.drag = DEFAULT_LIFETIME.drag;
  }
  return next;
}

function clampPercent(pct) {
  const num = Number.isFinite(pct) ? pct : 0;
  const rounded = Math.round(num);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

export async function awardAndMarkStepDone(client, { arcId, userId, delta, updatedSteps, nextLifetime }) {
  if (!client) throw new Error("Database client is required");

  const updateDelta = Number.isFinite(delta) ? delta : 0;
  const stepsJson = updatedSteps ?? [];
  const lifetimeJson = normalizeLifetimeForStorage(nextLifetime);

  const { rows: [updated] = [] } = await client.query(
    `UPDATE friend_arcs
        SET arc_points   = arc_points + $3,
            points_today = points_today + $3,
            steps        = $4::jsonb,
            lifetime     = $5::jsonb,
            updated_at   = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id,
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
                badges`,
    [arcId, userId, updateDelta, JSON.stringify(stepsJson), JSON.stringify(lifetimeJson)]
  );

  if (!updated) {
    throw Object.assign(new Error("Arc not found after update"), { status: 404 });
  }

  const rawThreshold = Number(updated.next_threshold);
  const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? rawThreshold : 100;
  const percent = clampPercent(progressPercent(updated.arc_points, threshold));
  return { row: updated, percent };
}

export async function awardChallengeAndClear(client, { arcId, userId, delta, nextChallenge, nextLifetime }) {
  if (!client) throw new Error("Database client is required");

  const updateDelta = Number.isFinite(delta) ? delta : 0;
  const challengeJson = nextChallenge ?? null;
  const lifetimeJson = normalizeLifetimeForStorage(nextLifetime);

  const { rows: [updated] = [] } = await client.query(
    `UPDATE friend_arcs
        SET arc_points   = arc_points + $3,
            points_today = points_today + $3,
            challenge    = $4::jsonb,
            lifetime     = $5::jsonb,
            updated_at   = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id,
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
                badges`,
    [arcId, userId, updateDelta, JSON.stringify(challengeJson), JSON.stringify(lifetimeJson)]
  );

  if (!updated) {
    throw Object.assign(new Error("Arc not found after update"), { status: 404 });
  }

  const rawThreshold = Number(updated.next_threshold);
  const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? rawThreshold : 100;
  const percent = clampPercent(progressPercent(updated.arc_points, threshold));
  return { row: updated, percent };
}
