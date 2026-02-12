import pool from "../Backend/db/pg.js";

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export async function resolvePoolId({ client, poolSlug = "general" } = {}) {
  const runner = client || pool;
  const name = poolSlug === "general" ? "General Pool" : poolSlug;
  const { rows } = await runner.query(
    `
      INSERT INTO funding_pools (slug, name)
      VALUES ($1, $2)
      ON CONFLICT (slug) DO UPDATE SET name = funding_pools.name
      RETURNING id
    `,
    [poolSlug, name]
  );
  return rows?.[0]?.id;
}

export async function findNextDonationWithRemaining({ client, poolId: providedPoolId = null, poolSlug = "general" } = {}) {
  const runner = client || pool;
  const poolId = providedPoolId || (await resolvePoolId({ client: runner, poolSlug }));
  const { rows } = await runner.query(
    `
      SELECT
        d.id AS donation_id,
        COALESCE(SUM(CASE WHEN pt.direction = 'credit' AND pt.reason = 'donation_in' THEN pt.amount_credits ELSE 0 END), 0) AS credits_in,
        COALESCE(SUM(CASE WHEN pt.direction = 'debit'  AND pt.reason = 'shift_out'   THEN pt.amount_credits ELSE 0 END), 0) AS credits_out
      FROM donations d
      JOIN pool_transactions pt ON pt.donation_id = d.id
     WHERE pt.pool_id = $1
       AND d.status = 'captured'
     GROUP BY d.id, d.created_at
     HAVING COALESCE(SUM(CASE WHEN pt.direction = 'credit' AND pt.reason = 'donation_in' THEN pt.amount_credits ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN pt.direction = 'debit'  AND pt.reason = 'shift_out'   THEN pt.amount_credits ELSE 0 END), 0) > 0
     ORDER BY d.created_at ASC, d.id ASC
     LIMIT 1
    `,
    [poolId]
  );

  const row = rows?.[0];
  if (!row) return { poolId, donationId: null, donationRemainingCredits: 0 };

  const donationRemainingCredits = toNumber(row.credits_in) - toNumber(row.credits_out);
  if (donationRemainingCredits <= 0) return { poolId, donationId: null, donationRemainingCredits: 0 };

  return {
    poolId,
    donationId: row.donation_id,
    donationRemainingCredits,
  };
}
