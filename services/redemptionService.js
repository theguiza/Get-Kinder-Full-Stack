import pool from "../Backend/db/pg.js";

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export async function listActiveOffers() {
  const { rows } = await pool.query(
    `
      SELECT id, slug, title, description, cost_credits
        FROM redemption_offers
       WHERE active = true
       ORDER BY cost_credits ASC, slug ASC
    `
  );
  return rows || [];
}

export async function getRedemptionHistory({ userId, limit = 25 }) {
  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit = Number.isInteger(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, 100)
    : 25;
  const { rows } = await pool.query(
    `
      SELECT r.id,
             o.slug,
             o.title,
             r.cost_credits,
             r.status,
             r.created_at
        FROM redemptions r
        JOIN redemption_offers o ON o.id = r.offer_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2
    `,
    [userId, safeLimit]
  );
  return rows || [];
}

export async function redeemOffer({ userId, offerSlug }) {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const { rows: offerRows } = await client.query(
      `
        SELECT id, slug, cost_credits
          FROM redemption_offers
         WHERE slug = $1
           AND active = true
         LIMIT 1
      `,
      [offerSlug]
    );
    const offer = offerRows?.[0] || null;
    if (!offer) {
      throw { code: "OFFER_NOT_FOUND" };
    }

    const lockKey = Number(userId);
    if (Number.isSafeInteger(lockKey)) {
      await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
    } else {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(userId)]);
    }

    const { rows: balanceRows } = await client.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN direction = 'credit' THEN kind_amount ELSE 0 END), 0) AS credits,
          COALESCE(SUM(CASE WHEN direction = 'debit' THEN kind_amount ELSE 0 END), 0) AS debits
        FROM wallet_transactions
        WHERE user_id = $1
      `,
      [userId]
    );
    const credits = toNumber(balanceRows?.[0]?.credits);
    const debits = toNumber(balanceRows?.[0]?.debits);
    const balance = credits - debits;

    const cost = toNumber(offer.cost_credits);
    if (cost <= 0) {
      throw new Error("Invalid offer cost");
    }
    if (balance < cost) {
      throw { code: "INSUFFICIENT_BALANCE", balance, cost };
    }

    const walletNote = `redeem:${offer.slug}`;
    const { rows: walletRows } = await client.query(
      `
        INSERT INTO wallet_transactions (user_id, kind_amount, direction, reason, note)
        VALUES ($1, $2, 'debit', 'redeem', $3)
        RETURNING id
      `,
      [userId, cost, walletNote]
    );
    const walletTxId = walletRows?.[0]?.id || null;

    const { rows: redemptionRows } = await client.query(
      `
        INSERT INTO redemptions (user_id, offer_id, cost_credits, status)
        VALUES ($1, $2, $3, 'requested')
        RETURNING id
      `,
      [userId, offer.id, cost]
    );
    const redemptionId = redemptionRows?.[0]?.id || null;

    await client.query("COMMIT");
    return {
      redemptionId,
      walletTxId,
      newBalance: balance - cost,
    };
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Redeem rollback error:", rollbackErr);
      }
    }
    throw err;
  } finally {
    if (client) client.release();
  }
}
