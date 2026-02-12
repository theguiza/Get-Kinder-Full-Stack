import pool from "../Backend/db/pg.js";

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export async function getWalletSummary({ userId }) {
  const { rows } = await pool.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN kind_amount ELSE 0 END), 0) AS credits,
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN kind_amount ELSE 0 END), 0) AS debits,
        COALESCE(SUM(CASE WHEN direction = 'debit' AND reason = 'donate' THEN kind_amount ELSE 0 END), 0) AS donated
      FROM wallet_transactions
      WHERE user_id = $1
    `,
    [userId]
  );

  const credits = toNumber(rows?.[0]?.credits);
  const debits = toNumber(rows?.[0]?.debits);
  const donated = toNumber(rows?.[0]?.donated);

  return {
    balance: credits - debits,
    earned_lifetime: credits,
    donated_lifetime: donated,
    earnable_this_week: 0,
  };
}

export async function findEarnShiftTx({ client, userId, eventId }) {
  const runner = client || pool;
  const { rows } = await runner.query(
    `
      SELECT kind_amount
        FROM wallet_transactions
       WHERE user_id = $1
         AND event_id = $2
         AND reason = 'earn_shift'
         AND direction = 'credit'
       ORDER BY created_at DESC
       LIMIT 1
    `,
    [userId, eventId]
  );
  const amount = rows?.[0]?.kind_amount;
  return Number.isFinite(Number(amount)) ? Number(amount) : null;
}

export async function insertEarnShiftTx({ client, userId, eventId, amount, note }) {
  const runner = client || pool;
  const existing = await findEarnShiftTx({ client: runner, userId, eventId });
  if (existing !== null) {
    return { inserted: false, amount: existing, walletTxId: null };
  }
  const { rows } = await runner.query(
    `
      INSERT INTO wallet_transactions (user_id, kind_amount, direction, reason, event_id, note)
      VALUES ($1, $2, 'credit', 'earn_shift', $3, $4)
      RETURNING id, kind_amount
    `,
    [userId, amount, eventId, note || null]
  );
  const insertedAmount = Number(rows?.[0]?.kind_amount) || 0;
  const walletTxId = rows?.[0]?.id || null;
  return { inserted: true, amount: insertedAmount, walletTxId };
}
