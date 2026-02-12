import pool from "../Backend/db/pg.js";

async function resolveUserId(req) {
  if (req.user?.id) return String(req.user.id);
  if (req.user?.user_id) return String(req.user.user_id);
  if (!req.user?.email) throw new Error("Missing authenticated user email.");
  const { rows } = await pool.query(
    "SELECT id FROM public.userdata WHERE email=$1 LIMIT 1",
    [req.user.email]
  );
  if (!rows[0]) {
    throw new Error("User record not found.");
  }
  return String(rows[0].id);
}

export async function getDonorSummary(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const userId = await resolveUserId(req);

    const { rows: [row] = [] } = await pool.query(
      `
        WITH my_donations AS (
          SELECT id, amount_cents, currency
            FROM donations
           WHERE donor_user_id = $1
             AND status = 'captured'
        ),
        credits_in AS (
          SELECT donation_id, SUM(amount_credits) AS credits_in
            FROM pool_transactions
           WHERE direction = 'credit'
             AND reason = 'donation_in'
             AND donation_id IN (SELECT id FROM my_donations)
           GROUP BY donation_id
        ),
        credits_out AS (
          SELECT donation_id, SUM(amount_credits) AS credits_out
            FROM pool_transactions
           WHERE direction = 'debit'
             AND reason = 'shift_out'
             AND donation_id IN (SELECT id FROM my_donations)
           GROUP BY donation_id
        ),
        receipts AS (
          SELECT donation_id,
                 SUM(credits_funded)     AS credits_funded,
                 SUM(minutes_verified)    AS minutes_funded
            FROM donor_receipts
           WHERE donation_id IN (SELECT id FROM my_donations)
           GROUP BY donation_id
        ),
        deficit AS (
          SELECT
            SUM(GREATEST(wt.kind_amount - COALESCE(dr.credits_funded, 0), 0)) AS deficit_credits,
            SUM(
              CASE WHEN wt.kind_amount - COALESCE(dr.credits_funded, 0) > 0
                   THEN COALESCE(dr.minutes_verified, 0)
                   ELSE 0 END
            ) AS deficit_minutes
          FROM donor_receipts dr
          JOIN donations d ON d.id = dr.donation_id
          JOIN wallet_transactions wt ON wt.id = dr.wallet_tx_id
         WHERE d.donor_user_id = $1
           AND wt.reason = 'earn_shift'
           AND wt.direction = 'credit'
        )
        SELECT
          (SELECT COALESCE(SUM(amount_cents), 0) FROM my_donations) AS donated_lifetime_cents,
          (SELECT COUNT(*) FROM my_donations) AS donations_count,
          (SELECT COALESCE(SUM(credits_funded), 0) FROM receipts) AS credits_funded_lifetime,
          (SELECT COALESCE(SUM(minutes_funded), 0) FROM receipts) AS minutes_funded_lifetime,
          (SELECT COALESCE(SUM(credits_in), 0) FROM credits_in) AS credits_in_total,
          (SELECT COALESCE(SUM(credits_out), 0) FROM credits_out) AS credits_out_total,
          (SELECT COALESCE(deficit_credits, 0) FROM deficit) AS deficit_credits_total,
          (SELECT COALESCE(deficit_minutes, 0) FROM deficit) AS deficit_minutes_total
      `,
      [userId]
    );

    const donatedCents = Number(row?.donated_lifetime_cents) || 0;
    const donationsCount = Number(row?.donations_count) || 0;
    const creditsFunded = Number(row?.credits_funded_lifetime) || 0;
    const minutesFunded = Number(row?.minutes_funded_lifetime) || 0;
    const creditsIn = Number(row?.credits_in_total) || 0;
    const creditsRemaining = Math.max(0, creditsIn - creditsFunded);
    const hoursFunded = Math.round((minutesFunded / 60) * 10) / 10;
    const deficitCredits = Number(row?.deficit_credits_total) || 0;
    const deficitHours = Math.round(((Number(row?.deficit_minutes_total) || 0) / 60) * 10) / 10;

    return res.json({
      ok: true,
      data: {
        donated_cents_total: donatedCents,
        donation_count: donationsCount,
        credits_funded_total: creditsFunded,
        minutes_verified_total: minutesFunded,
        remaining_pool_credits: creditsRemaining,
        pending_deficit_credits_total: deficitCredits,
        pending_deficit_hours_total: deficitHours,
        // legacy keys preserved for backward compatibility
        donated_lifetime_cents: donatedCents,
        donations_count: donationsCount,
        credits_funded_lifetime: creditsFunded,
        minutes_funded_lifetime: minutesFunded,
        hours_funded_lifetime: hoursFunded,
        credits_remaining: creditsRemaining,
        credits_unused_balance: creditsRemaining,
      },
    });
  } catch (err) {
    console.error("GET /api/donor/summary error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load donor summary." });
  }
}

export async function getDonorReceipts(req, res) {
  try {
    res.set("Cache-Control", "no-store");
    const userId = await resolveUserId(req);
    const parsedLimit = Number.parseInt(req.query?.limit, 10);
    const parsedOffset = Number.parseInt(req.query?.offset, 10);
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 25;
    const offset = Number.isInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;

    const { rows } = await pool.query(
      `
        SELECT
          dr.id AS receipt_id,
          dr.donation_id,
          d.amount_cents,
          d.currency,
          wt.kind_amount AS wallet_amount,
          dr.event_id,
          e.title AS event_title,
          e.end_at AS event_end_at,
          e.start_at AS event_start_at,
          dr.wallet_tx_id,
          dr.volunteer_user_id,
          dr.credits_funded,
          dr.minutes_verified,
          dr.created_at
        FROM donor_receipts dr
        JOIN donations d ON d.id = dr.donation_id
        LEFT JOIN wallet_transactions wt ON wt.id = dr.wallet_tx_id
        LEFT JOIN events e ON e.id = dr.event_id
        WHERE d.donor_user_id = $1
        ORDER BY dr.created_at DESC
        LIMIT $2 OFFSET $3
      `,
      [userId, limit, offset]
    );

    const items = (rows || []).map((row) => ({
      id: row.receipt_id,
      donation_id: row.donation_id,
      amount_cents: Number(row.amount_cents) || 0,
      currency: row.currency || "CAD",
      event_id: row.event_id,
      event_title: row.event_title || null,
      event_start_at: row.event_start_at || null,
      event_end_at: row.event_end_at || null,
      wallet_tx_id: row.wallet_tx_id || null,
      volunteer_user_id: row.volunteer_user_id,
      credits_funded: Number(row.credits_funded) || 0,
      credits_deficit: Math.max(0, (Number(row.wallet_amount) || 0) - (Number(row.credits_funded) || 0)),
      minutes_verified: row.minutes_verified != null ? Number(row.minutes_verified) || 0 : null,
      created_at: row.created_at,
    }));

    const hasMore = items.length === limit;
    const nextOffset = hasMore ? offset + limit : offset;

    return res.json({
      ok: true,
      data: {
        receipts: items,
        limit,
        offset,
        next_offset: nextOffset,
        has_more: hasMore,
        // legacy keys
        items,
      },
    });
  } catch (err) {
    console.error("GET /api/donor/receipts error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load donor receipts." });
  }
}
