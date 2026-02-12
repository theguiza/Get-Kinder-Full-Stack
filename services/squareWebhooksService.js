import crypto from "crypto";
import { recordDonationFromSquarePayment } from "./donationsService.js";

const COMPLETED_STATUSES = new Set(["COMPLETED", "CAPTURED", "APPROVED"]);

export function verifySquareWebhookSignature({
  signatureKey,
  notificationUrl,
  rawBody,
  signatureHeader,
}) {
  if (!signatureKey || !notificationUrl || !rawBody || !signatureHeader) {
    return false;
  }

  try {
    const payload = `${notificationUrl}${rawBody.toString("utf8")}`;
    const hmac = crypto.createHmac("sha256", signatureKey);
    hmac.update(payload);
    const expected = hmac.digest();
    const provided = Buffer.from(signatureHeader, "base64");
    if (provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(provided, expected);
  } catch (err) {
    console.error("Square signature verify error:", err);
    return false;
  }
}

function extractPayment(event) {
  const object = event?.data?.object;
  if (!object) return null;
  if (object.payment) return object.payment;
  if (object.object === "payment") return object;
  return null;
}

function derivePoolSlug(payment) {
  const meta = payment?.metadata || {};
  const candidates = [
    meta.pool_slug,
    meta.poolSlug,
    meta.pool,
    payment?.reference_id,
  ];

  const chosen = candidates.find(
    (val) => typeof val === "string" && val.trim().length > 0
  );
  return chosen ? chosen.trim() : "general";
}

function extractMoney(payment) {
  return payment?.amount_money || payment?.total_money || payment?.approved_money;
}

export async function processSquareWebhookEvent({ event, centsPerCredit = null }) {
  const eventType = event?.type || null;
  const payment = extractPayment(event);
  const paymentId = payment?.id || null;
  const statusRaw = typeof payment?.status === "string" ? payment.status : "";
  const status = statusRaw.toUpperCase();
  const money = extractMoney(payment);
  const amountCents = Number(money?.amount);
  const currency = money?.currency || "CAD";
  const poolSlug = derivePoolSlug(payment);

  if (!paymentId) {
    return {
      ok: true,
      eventType,
      paymentId: null,
      donationId: null,
      creditsAdded: 0,
      status,
      amountCents: null,
      currency,
      poolSlug,
    };
  }

  if (!COMPLETED_STATUSES.has(status)) {
    return {
      ok: true,
      eventType,
      paymentId,
      donationId: null,
      creditsAdded: 0,
      status,
      amountCents,
      currency,
      poolSlug,
    };
  }

  if (!Number.isInteger(amountCents) || amountCents < 0) {
    return {
      ok: false,
      error: "INVALID_AMOUNT",
      eventType,
      paymentId,
      donationId: null,
      creditsAdded: 0,
      status,
      amountCents: Number.isFinite(amountCents) ? amountCents : null,
      currency,
      poolSlug,
    };
  }

  const donationResult = await recordDonationFromSquarePayment({
    squarePaymentId: paymentId,
    amountCents,
    currency,
    poolSlug,
    centsPerCredit,
  });

  return {
    ok: true,
    eventType,
    paymentId,
    donationId: donationResult?.donationId || null,
    creditsAdded: donationResult?.creditsInserted ?? donationResult?.creditsIssued ?? 0,
    status,
    amountCents,
    currency,
    poolSlug,
  };
}
