import { progressPercent } from "../shared/metrics.js";

function clampPercent(pct) {
  const num = Number.isFinite(pct) ? pct : 0;
  const rounded = Math.round(num);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

export async function awardAndMarkStepDone(client, { arcId, userId, delta, updatedSteps }) {
  if (!client) throw new Error("Database client is required");

  const updateDelta = Number.isFinite(delta) ? delta : 0;
  const stepsJson = updatedSteps ?? [];

  const { rows: [updated] = [] } = await client.query(
    `UPDATE friend_arcs
        SET arc_points   = arc_points + $3,
            points_today = points_today + $3,
            steps        = $4::jsonb,
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
    [arcId, userId, updateDelta, JSON.stringify(stepsJson)]
  );

  if (!updated) {
    throw Object.assign(new Error("Arc not found after update"), { status: 404 });
  }

  const rawThreshold = Number(updated.next_threshold);
  const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? rawThreshold : 100;
  const percent = clampPercent(progressPercent(updated.arc_points, threshold));
  return { row: updated, percent };
}

export async function awardChallengeAndClear(client, { arcId, userId, delta, nextChallenge }) {
  if (!client) throw new Error("Database client is required");

  const updateDelta = Number.isFinite(delta) ? delta : 0;
  const challengeJson = nextChallenge ?? null;

  const { rows: [updated] = [] } = await client.query(
    `UPDATE friend_arcs
        SET arc_points   = arc_points + $3,
            points_today = points_today + $3,
            challenge    = $4::jsonb,
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
    [arcId, userId, updateDelta, JSON.stringify(challengeJson)]
  );

  if (!updated) {
    throw Object.assign(new Error("Arc not found after update"), { status: 404 });
  }

  const rawThreshold = Number(updated.next_threshold);
  const threshold = Number.isFinite(rawThreshold) && rawThreshold > 0 ? rawThreshold : 100;
  const percent = clampPercent(progressPercent(updated.arc_points, threshold));
  return { row: updated, percent };
}
