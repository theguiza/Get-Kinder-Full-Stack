import pool from "../Backend/db/pg.js";
import { recordDonation } from "../services/donationsService.js";
import { fetchSquarePayment, parsePaymentAmount } from "../services/squareService.js";

function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return email && list.includes(email.toLowerCase());
}

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

export async function createManualDonation(req, res) {
  try {
    const resolvedUserId = await resolveUserId(req);
    if (!resolvedUserId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const userEmail = req.user?.email || "";
    if (process.env.NODE_ENV === "production" && !isAdminEmail(userEmail)) {
      return res.status(403).json({ ok: false, error: "forbidden", message: "Admin access required in production." });
    }

    const amountCentsRaw = req.body?.amount_cents;
    const amountCents = Number(amountCentsRaw);
    const currency = (req.body?.currency || "CAD").trim();
    const squarePaymentId = req.body?.square_payment_id ? String(req.body.square_payment_id).trim() : null;
    const poolSlug = (req.body?.pool_slug || "general").trim() || "general";
    const amountCreditsOverrideRaw = req.body?.amount_credits;
    const amountCreditsOverride =
      amountCreditsOverrideRaw != null && Number.isFinite(Number(amountCreditsOverrideRaw))
        ? Math.max(0, Math.floor(Number(amountCreditsOverrideRaw)))
        : null;

    if (!Number.isInteger(amountCents) || amountCents < 0 || amountCents > 50_000_000) {
      return res.status(400).json({ ok: false, error: "INVALID_REQUEST", message: "amount_cents must be an integer between 0 and 50,000,000." });
    }
    if (currency.length > 8) {
      return res.status(400).json({ ok: false, error: "INVALID_REQUEST", message: "currency too long." });
    }
    if (squarePaymentId && squarePaymentId.length > 128) {
      return res.status(400).json({ ok: false, error: "INVALID_REQUEST", message: "square_payment_id too long." });
    }

    const centsPerCredit = Number.isFinite(Number(process.env.CENTS_PER_CREDIT))
      ? Number(process.env.CENTS_PER_CREDIT)
      : null;

    // Allow explicit donor_user_id override (admin context); default to current user
    const donorUserId =
      req.body?.donor_user_id != null && Number.isFinite(Number(req.body.donor_user_id))
        ? String(req.body.donor_user_id)
        : resolvedUserId;

    const result = await recordDonation({
      donorUserId,
      squarePaymentId: squarePaymentId || null,
      amountCents,
      currency: currency || "CAD",
      poolSlug,
      amountCreditsOverride,
      centsPerCredit,
    });

    return res.json({
      ok: true,
      data: {
        donation: {
          id: result?.donationId || null,
          amount_cents: amountCents,
          currency,
          pool_slug: poolSlug,
        },
        pool_tx: {
          pool_id: result?.poolId || null,
        },
        amount_credits: result?.creditsIssued ?? amountCreditsOverride ?? null,
      },
    });
  } catch (err) {
    console.error("POST /api/donations/manual error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to record donation." });
  }
}

export async function confirmSquareDonation(req, res) {
  try {
    const donorUserId = await resolveUserId(req);
    if (!donorUserId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const paymentId = (req.body?.square_payment_id || "").trim();
    const poolSlug = (req.body?.pool_slug || "general").trim() || "general";
    if (!paymentId) {
      return res.status(400).json({ ok: false, error: "INVALID_REQUEST", message: "square_payment_id is required." });
    }

    let payment;
    try {
      payment = await fetchSquarePayment(paymentId);
    } catch (err) {
      const code = err?.code === "square_token_missing" ? "SQUARE_CONFIG_MISSING" : "SQUARE_NOT_VERIFIED";
      return res.status(400).json({ ok: false, error: code, message: err?.message || "Unable to verify Square payment." });
    }

    const { captured, amountCents, currency, status } = parsePaymentAmount(payment);
    if (!captured) {
      return res.status(400).json({ ok: false, error: "PAYMENT_NOT_CAPTURED", message: `Payment status ${status}` });
    }
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      return res.status(400).json({ ok: false, error: "INVALID_AMOUNT", message: "Square amount invalid." });
    }

    const centsPerCredit = Number.isFinite(Number(process.env.CENTS_PER_CREDIT))
      ? Number(process.env.CENTS_PER_CREDIT)
      : null;

    const result = await recordDonation({
      donorUserId,
      squarePaymentId: paymentId,
      amountCents,
      currency: currency || "CAD",
      poolSlug,
      amountCreditsOverride: null,
      centsPerCredit,
    });

    return res.json({
      ok: true,
      data: {
        donation_id: result?.donationId || null,
        square_payment_id: paymentId,
        amount_cents: amountCents,
        currency: currency || "CAD",
        credits_added: result?.creditsIssued ?? null,
        pool_slug: poolSlug,
        status: "captured",
      },
    });
  } catch (err) {
    console.error("POST /api/donations/square/confirm error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to confirm Square payment." });
  }
}

export async function claimDonation(req, res) {
  try {
    const donorUserId = await resolveUserId(req);
    if (!donorUserId) return res.status(401).json({ ok: false, error: "unauthorized" });

    const donationIdRaw = req.body?.donation_id;
    const paymentIdRaw = req.body?.square_payment_id;
    const donationId = Number.isFinite(Number(donationIdRaw)) ? Number(donationIdRaw) : null;
    const paymentId = typeof paymentIdRaw === "string" && paymentIdRaw.trim() ? paymentIdRaw.trim() : null;

    if (!donationId && !paymentId) {
      return res.status(400).json({ ok: false, error: "INVALID_REQUEST", message: "donation_id or square_payment_id required" });
    }

    const params = [];
    let whereClause = "";
    if (donationId) {
      whereClause = "id = $1";
      params.push(donationId);
    } else {
      whereClause = "square_payment_id = $1";
      params.push(paymentId);
    }

    const { rows: [donation] = [] } = await pool.query(
      `SELECT id, donor_user_id, square_payment_id FROM donations WHERE ${whereClause} LIMIT 1`,
      params
    );

    if (!donation) {
      return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    }

    const existingDonor = donation.donor_user_id ? String(donation.donor_user_id) : null;
    if (existingDonor && existingDonor !== String(donorUserId)) {
      return res.status(409).json({ ok: false, error: "ALREADY_CLAIMED" });
    }

    if (!existingDonor) {
      await pool.query(
        `UPDATE donations SET donor_user_id = $1 WHERE id = $2`,
        [donorUserId, donation.id]
      );
    }

    return res.json({
      ok: true,
      data: {
        donation_id: donation.id,
        donor_user_id: donorUserId,
      },
    });
  } catch (err) {
    console.error("POST /api/donations/claim error:", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: "Unable to claim donation." });
  }
}
