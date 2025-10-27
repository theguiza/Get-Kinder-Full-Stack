// scripts/backfillFriendArcs.js
// Backfill friend_arcs for existing friends that do not yet have an arc.

import pool from "../Backend/db/pg.js";
import { generateArcForQuiz } from "../services/ArcGenerator.js";

const tierFromScore = (score) => {
  const num = Number(score);
  if (!Number.isFinite(num)) return null;
  if (num >= 85) return "Bestie Material";
  if (num >= 70) return "Strong Contender";
  if (num >= 50) return "Potential Pal";
  return "Acquaintance Energy";
};

const chooseTier = (explicitTier, score) => {
  if (typeof explicitTier === "string" && explicitTier.trim()) {
    return explicitTier.trim();
  }
  return tierFromScore(score) || "General";
};

const chooseChannelPref = (value) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  return "mixed";
};

async function backfillArcs() {
  const { rows } = await pool.query(`
    SELECT
      f.id            AS friend_id,
      f.owner_user_id AS user_id,
      f.name          AS friend_name,
      f.score         AS friend_score,
      f.snapshot      AS snapshot,
      f.signals       AS signals
    FROM public.friends f
    LEFT JOIN public.friend_arcs fa
      ON fa.id = f.id
     AND fa.user_id = f.owner_user_id
    WHERE fa.id IS NULL
  `);

  if (!rows.length) {
    console.log("No friends require backfill. friend_arcs is already in sync.");
    return;
  }

  console.log(`Backfilling ${rows.length} friend arcs...`);

  let success = 0;
  for (const row of rows) {
    const payload = {
      user_id: row.user_id,
      friend_id: row.friend_id,
      friend_name: row.friend_name,
      tier: chooseTier(row.snapshot?.tier ?? row.snapshot?.friend_tier, row.friend_score),
      channel_pref: chooseChannelPref(row.snapshot?.preferred_channel),
      goal: row.snapshot?.goal ?? row.snapshot?.goals ?? null,
      availability: row.snapshot?.availability ?? null,
      effort_capacity: row.snapshot?.effort_capacity ?? null,
    };

    try {
      await generateArcForQuiz(pool, payload);
      success += 1;
      console.log(`✔ Generated arc for friend ${row.friend_name} (${row.friend_id})`);
    } catch (err) {
      console.error(`✖ Failed to generate arc for friend ${row.friend_id}:`, err.message);
    }
  }

  console.log(`Backfill complete. Generated ${success} of ${rows.length} arcs.`);
}

backfillArcs()
  .catch((err) => {
    console.error("Backfill run failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
