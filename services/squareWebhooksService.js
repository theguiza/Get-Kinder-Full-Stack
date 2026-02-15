import crypto from "crypto";
import { recordDonationFromSquarePayment } from "./donationsService.js";
import { recordSubscriptionTopupFromSquarePayment } from "./subscriptionTopupsService.js";

const COMPLETED_STATUSES = new Set(["COMPLETED", "CAPTURED", "APPROVED"]);
const DEFAULT_POOL_SLUG = "general";
const POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SCOPED_POOL_SLUG_RE = /^u([1-9]\d*)__([a-z0-9][a-z0-9_-]{0,63})$/;
const FUNDING_ACTION = {
  DONATION: "donation",
  SUBSCRIPTION_TOPUP: "subscription_topup",
};

const SUBSCRIPTION_HINT_SET = new Set([
  "subscription",
  "subscription_topup",
  "subscription-topup",
  "subscriptiontopup",
  "recurring",
  "recurring_subscription",
  "membership",
]);

const DONATION_HINT_SET = new Set([
  "donation",
  "donation_in",
  "donationin",
  "gift",
]);

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

function firstMetaValue(payment, keys) {
  const meta = payment?.metadata || {};
  for (const key of keys) {
    const raw = meta?.[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return null;
}

function normalizePoolSlug(rawSlug) {
  const slug = typeof rawSlug === "string" ? rawSlug.trim().toLowerCase() : "";
  if (!slug) return DEFAULT_POOL_SLUG;
  if (POOL_SLUG_RE.test(slug)) return slug;
  if (SCOPED_POOL_SLUG_RE.test(slug)) return slug;
  return DEFAULT_POOL_SLUG;
}

function derivePoolSlug(payment) {
  const candidates = [
    firstMetaValue(payment, ["pool_slug", "poolSlug", "pool"]),
    payment?.reference_id,
  ];

  const chosen = candidates.find(
    (val) => typeof val === "string" && val.trim().length > 0
  );
  return normalizePoolSlug(chosen);
}

function extractMoney(payment) {
  return payment?.amount_money || payment?.total_money || payment?.approved_money;
}

function normalizeHint(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase().replace(/\s+/g, "_");
}

function deriveFundingAction({ payment, eventType }) {
  const hintKeys = [
    "impact_tx_type",
    "impact_type",
    "funding_type",
    "topup_source",
    "credit_source",
    "source",
    "purpose",
    "kind",
    "reason",
  ];
  const explicitHint = firstMetaValue(payment, hintKeys);
  const normalizedHint = normalizeHint(explicitHint);
  if (SUBSCRIPTION_HINT_SET.has(normalizedHint)) {
    return FUNDING_ACTION.SUBSCRIPTION_TOPUP;
  }
  if (DONATION_HINT_SET.has(normalizedHint)) {
    return FUNDING_ACTION.DONATION;
  }

  const reference = normalizeHint(payment?.reference_id || "");
  if (
    reference.startsWith("subscription_topup:") ||
    reference.startsWith("sub_topup:") ||
    reference.startsWith("subscription:")
  ) {
    return FUNDING_ACTION.SUBSCRIPTION_TOPUP;
  }

  const eventTypeNormalized = normalizeHint(eventType);
  if (eventTypeNormalized.includes("subscription") && !/^payment[._]/.test(eventTypeNormalized)) {
    return FUNDING_ACTION.SUBSCRIPTION_TOPUP;
  }

  return FUNDING_ACTION.DONATION;
}

function parsePositiveInt(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

function deriveOwnerUserId(payment, poolSlug) {
  const metaOwner = firstMetaValue(payment, [
    "owner_user_id",
    "ownerUserId",
    "org_user_id",
    "organization_user_id",
    "creator_user_id",
    "host_user_id",
  ]);
  const parsedMetaOwner = parsePositiveInt(metaOwner);
  if (parsedMetaOwner) return parsedMetaOwner;

  const scopedMatch = typeof poolSlug === "string" ? poolSlug.match(SCOPED_POOL_SLUG_RE) : null;
  if (scopedMatch?.[1]) {
    return parsePositiveInt(scopedMatch[1]);
  }
  return null;
}

function deriveProviderSubscriptionId(payment) {
  return firstMetaValue(payment, [
    "subscription_id",
    "subscriptionId",
    "square_subscription_id",
    "plan_subscription_id",
    "billing_subscription_id",
  ]);
}

function deriveCreditsOverride(payment) {
  const raw = firstMetaValue(payment, ["amount_credits", "credits", "impact_credits"]);
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < 0) return null;
  return amount;
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
  const fundingAction = deriveFundingAction({ payment, eventType });
  const ownerUserId = deriveOwnerUserId(payment, poolSlug);
  const providerSubscriptionId = deriveProviderSubscriptionId(payment);
  const amountCreditsOverride = deriveCreditsOverride(payment);

  if (!paymentId) {
    return {
      ok: true,
      eventType,
      fundingAction,
      paymentId: null,
      donationId: null,
      topupId: null,
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
      fundingAction,
      paymentId,
      donationId: null,
      topupId: null,
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
      fundingAction,
      paymentId,
      donationId: null,
      topupId: null,
      creditsAdded: 0,
      status,
      amountCents: Number.isFinite(amountCents) ? amountCents : null,
      currency,
      poolSlug,
    };
  }

  if (fundingAction === FUNDING_ACTION.SUBSCRIPTION_TOPUP) {
    const topupResult = await recordSubscriptionTopupFromSquarePayment({
      squarePaymentId: paymentId,
      amountCents,
      currency,
      poolSlug,
      ownerUserId,
      providerSubscriptionId,
      amountCreditsOverride,
      centsPerCredit,
    });

    return {
      ok: true,
      eventType,
      fundingAction,
      paymentId,
      donationId: null,
      topupId: topupResult?.topupId || null,
      creditsAdded: topupResult?.creditsInserted ?? topupResult?.creditsIssued ?? 0,
      status,
      amountCents,
      currency,
      poolSlug: topupResult?.poolSlug || poolSlug,
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
    fundingAction,
    paymentId,
    donationId: donationResult?.donationId || null,
    topupId: null,
    creditsAdded: donationResult?.creditsInserted ?? donationResult?.creditsIssued ?? 0,
    status,
    amountCents,
    currency,
    poolSlug,
  };
}
