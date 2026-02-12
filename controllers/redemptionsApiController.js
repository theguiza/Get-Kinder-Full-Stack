import pool from "../Backend/db/pg.js";
import {
  getRedemptionHistory,
  listActiveOffers,
  redeemOffer,
} from "../services/redemptionService.js";

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

export async function getOffersHandler(req, res) {
  try {
    const offers = await listActiveOffers();
    return res.json({ ok: true, data: { offers } });
  } catch (err) {
    console.error("GET /api/redemptions/offers error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load offers." });
  }
}

export async function getHistoryHandler(req, res) {
  try {
    const userId = await resolveUserId(req);
    const limit = req.query?.limit || 25;
    const items = await getRedemptionHistory({ userId, limit });
    return res.json({ ok: true, data: { items } });
  } catch (err) {
    console.error("GET /api/redemptions/history error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to load redemption history." });
  }
}

export async function redeemHandler(req, res) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const offerSlug = (req.body?.offer_slug || "").trim();
    if (!offerSlug || offerSlug.length > 80) {
      return res.status(400).json({ ok: false, error: "INVALID_REQUEST", message: "offer_slug is required." });
    }

    const result = await redeemOffer({ userId, offerSlug });
    return res.json({
      ok: true,
      data: {
        redemption_id: result?.redemptionId || null,
        wallet_tx_id: result?.walletTxId || null,
        new_balance: Number.isFinite(Number(result?.newBalance)) ? Number(result.newBalance) : null,
      },
    });
  } catch (err) {
    if (err?.code === "OFFER_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "OFFER_NOT_FOUND", message: "Offer not found." });
    }
    if (err?.code === "INSUFFICIENT_BALANCE") {
      const balance = Number(err.balance) || 0;
      const cost = Number(err.cost) || 0;
      return res.status(400).json({
        ok: false,
        error: "INSUFFICIENT_BALANCE",
        message: `Insufficient balance. You have ${balance} credits.`,
        data: { balance, cost },
      });
    }
    console.error("POST /api/redemptions/redeem error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to redeem offer." });
  }
}
