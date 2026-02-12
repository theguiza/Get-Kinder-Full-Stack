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
    const userId = await resolveUserId(req);

    const { rows: [row] } = await pool.query(
      `
        WITH my_donations AS (
          SELECT id, amount_cents FROM donations WHERE donor_user_id = $1
        ),
        issued AS (
          SELECT COALESCE(SUM(pt.amount_credits), 0) AS credits_issued
            FROM pool_transactions pt
            JOIN my_donations d ON d.id = pt.donation_id
           WHERE pt.reason = 'donation_in'
        ),
        debited AS (
          SELECT COALESCE(SUM(pt.amount_credits), 0) AS credits_debited
            FROM pool_transactions pt
            JOIN my_donations d ON d.id = pt.donation_id
           WHERE pt.direction = 'debit' AND pt.reason IN ('shift_out','manual_adjust')
        ),
        receipts AS (
          SELECT
            COALESCE(SUM(dr.credits_funded), 0) AS credits_funded,
            COALESCE(SUM(COALESCE(dr.minutes_verified, 0)), 0) AS minutes_funded
            FROM donor_receipts dr
            JOIN my_donations d ON d.id = dr.donation_id
        )
        SELECT
          (SELECT COALESCE(SUM(amount_cents), 0) FROM my_donations) AS donated_lifetime_cents,
          (SELECT credits_issued FROM issued) AS credits_issued_lifetime,
          (SELECT credits_funded FROM receipts) AS credits_funded_lifetime,
          (SELECT minutes_funded FROM receipts) AS funded_minutes_lifetime,
          (SELECT credits_debited FROM debited) AS credits_debited_lifetime,
          (SELECT COUNT(*) FROM my_donations) AS donations_count
      `,
      [userId]
    );

    const donatedCents = Number(row?.donated_lifetime_cents) || 0;
    const creditsIssued = Number(row?.credits_issued_lifetime) || 0;
    const creditsDebited = Number(row?.credits_debited_lifetime) || 0;
    const creditsFunded = Number(row?.credits_funded_lifetime) || 0;
    const minutesFunded = Number(row?.funded_minutes_lifetime) || 0;
    const hoursFunded = Math.round((minutesFunded / 60) * 10) / 10;

    return res.json({
      ok: true,
      data: {
        donated_lifetime_cents: donatedCents,
        credits_issued_lifetime: creditsIssued,
        credits_funded_lifetime: creditsFunded,
        credits_unused_balance: creditsIssued - creditsDebited,
        funded_minutes_lifetime: minutesFunded,
        funded_hours_lifetime: hoursFunded,
        donations_count: Number(row?.donations_count) || 0,
      },
    });
  } catch (err) {
    console.error("GET /api/donor/summary error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load donor summary." });
  }
}

export async function getDonorReceipts(req, res) {
  try {
    const userId = await resolveUserId(req);
    const parsedLimit = Number.parseInt(req.query?.limit, 10);
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50;

    const { rows } = await pool.query(
      `
        SELECT
          dr.id AS receipt_id,
          dr.donation_id,
          dr.event_id,
          e.title AS event_title,
          e.start_at AS event_start_at,
          dr.credits_funded,
          dr.minutes_verified,
          dr.created_at
        FROM donor_receipts dr
        JOIN donations d ON d.id = dr.donation_id
        LEFT JOIN events e ON e.id = dr.event_id
        WHERE d.donor_user_id = $1
        ORDER BY dr.created_at DESC
        LIMIT $2
      `,
      [userId, limit]
    );

    const items = (rows || []).map((row) => ({
      receipt_id: row.receipt_id,
      donation_id: row.donation_id,
      event_id: row.event_id,
      event_title: row.event_title,
      event_start_at: row.event_start_at,
      credits_funded: Number(row.credits_funded) || 0,
      minutes_verified: row.minutes_verified != null ? Number(row.minutes_verified) || 0 : null,
      created_at: row.created_at,
    }));

    return res.json({ ok: true, data: { items } });
  } catch (err) {
    console.error("GET /api/donor/receipts error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load donor receipts." });
  }
}
