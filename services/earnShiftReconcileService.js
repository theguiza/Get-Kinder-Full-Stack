import pool from "../Backend/db/pg.js";
import { insertEarnShiftTx } from "./walletService.js";
import { fundEarnShiftFromPool } from "./poolFundingService.js";

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const DEFAULT_POOL_SLUG = "general";
const POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const POOL_SCOPE_SEP = "__";

const normalizePoolSlug = (value) => {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return DEFAULT_POOL_SLUG;
  return POOL_SLUG_RE.test(slug) ? slug : DEFAULT_POOL_SLUG;
};

const buildScopedPoolSlug = (ownerUserId, poolSlug) => {
  const owner = String(ownerUserId || "").trim();
  if (!owner) return poolSlug;
  return `u${owner}${POOL_SCOPE_SEP}${poolSlug}`;
};

export async function reconcileEarnShiftCredits({ limit = 200, dryRun = false } = {}) {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 200;

  const { rows } = await pool.query(
    `
      SELECT
        r.event_id,
        r.attendee_user_id,
        r.attended_minutes,
        r.verified_at,
        e.reward_pool_kind,
        e.capacity,
        e.funding_pool_slug,
        e.creator_user_id,
        e.title
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
      WHERE r.verification_status = 'verified'
      ORDER BY r.verified_at NULLS LAST, r.created_at ASC
      LIMIT $1
    `,
    [safeLimit]
  );

  const summary = {
    scanned: rows.length,
    awarded: 0,
    funded: 0,
    skippedExisting: 0,
    skippedZero: 0,
    errors: 0,
  };

  for (const row of rows) {
    const rewardPool = toNumber(row.reward_pool_kind);
    const capacity = Math.max(1, toNumber(row.capacity, 1));
    const creditsToAward = Math.floor(rewardPool / capacity);

    if (!Number.isFinite(creditsToAward) || creditsToAward <= 0) {
      summary.skippedZero += 1;
      continue;
    }

    const noteBase = `earn_shift:${row.event_id || ""}`;
    const note = noteBase.length > 180 ? noteBase.slice(0, 180) : noteBase;

    if (dryRun) {
      summary.awarded += 1;
      summary.funded += 1;
      continue;
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const { inserted, amount, walletTxId } = await insertEarnShiftTx({
        client,
        userId: row.attendee_user_id,
        eventId: row.event_id,
        amount: creditsToAward,
        note,
      });

      if (!inserted) {
        summary.skippedExisting += 1;
        await client.query("ROLLBACK");
        continue;
      }

      await fundEarnShiftFromPool({
        client,
        poolSlug: buildScopedPoolSlug(row.creator_user_id, normalizePoolSlug(row.funding_pool_slug)),
        eventId: row.event_id,
        volunteerUserId: row.attendee_user_id,
        walletTxId: walletTxId,
        creditsToFund: amount,
        minutesVerified: row.attended_minutes ?? null,
      });

      await client.query("COMMIT");
      summary.awarded += 1;
      summary.funded += 1;
    } catch (err) {
      summary.errors += 1;
      try {
        if (client) await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Reconcile rollback error:", rollbackErr);
      }
      console.error("Reconcile earn_shift error:", err);
    } finally {
      if (client) client.release();
    }
  }

  return summary;
}
