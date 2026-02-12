import pool from "../Backend/db/pg.js";
import { getWalletSummary } from "../services/walletService.js";

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

export async function getWalletSummaryHandler(req, res) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });
    const summary = await getWalletSummary({ userId });
    return res.json({
      ok: true,
      data: {
        balance: Number(summary?.balance) || 0,
        earned_lifetime: Number(summary?.earned_lifetime) || 0,
        donated_lifetime: Number(summary?.donated_lifetime) || 0,
        earnable_this_week: 0,
      },
    });
  } catch (err) {
    console.error("GET /api/wallet/summary error:", err);
    return res.status(500).json({ ok: false, error: "Unable to load wallet summary" });
  }
}
