// scripts/clampPendingDayUnlocks.js
// Resets wildly future/past pending-day unlock timestamps so arcs can advance again.

import pool from "../Backend/db/pg.js";

const SAFE_WINDOW_HOURS = 36;
const STALE_LOOKBACK_DAYS = 7;

async function clampPendingDayUnlocks() {
  const sql = `
    WITH candidate AS (
      SELECT
        id,
        user_id,
        COALESCE(
          (lifetime->>'pendingDay')::int,
          (lifetime->>'pending_day')::int,
          0
        ) AS pending_day,
        COALESCE(
          (lifetime->>'pendingDayUnlockAt')::timestamptz,
          (lifetime->>'pending_day_unlock_at')::timestamptz
        ) AS unlock_at
      FROM friend_arcs
    )
    UPDATE friend_arcs fa
       SET lifetime = jsonb_set(
                         jsonb_set(
                           fa.lifetime,
                           '{pendingDayUnlockAt}',
                           to_jsonb((NOW() AT TIME ZONE 'UTC' + INTERVAL '1 day')::text),
                           true
                         ),
                         '{pending_day_unlock_at}',
                         to_jsonb((NOW() AT TIME ZONE 'UTC' + INTERVAL '1 day')::text),
                         true
                       ),
           updated_at = NOW()
      FROM candidate c
     WHERE fa.id = c.id
       AND fa.user_id = c.user_id
       AND c.pending_day > 0
       AND (
         c.unlock_at IS NULL
         OR c.unlock_at > NOW() + ($1 * INTERVAL '1 hour')
         OR c.unlock_at < NOW() - ($2 * INTERVAL '1 day')
       )
  `;

  const { rowCount } = await pool.query(sql, [SAFE_WINDOW_HOURS, STALE_LOOKBACK_DAYS]);
  console.log(`Clamped ${rowCount} friend_arcs pending-day unlock timestamps.`);
}

clampPendingDayUnlocks()
  .catch((error) => {
    console.error("Pending-day clamp failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
