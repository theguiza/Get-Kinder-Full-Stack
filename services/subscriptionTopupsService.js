import pool from "../Backend/db/pg.js";
import { resolvePoolId } from "./donationAttributionService.js";
import { computeCreditsFromDonation } from "./donationsService.js";

const DEFAULT_POOL_SLUG = "general";
const POOL_SCOPE_SEP = "__";
const POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SCOPED_POOL_RE = /^u([1-9]\d*)__([a-z0-9][a-z0-9_-]{0,63})$/;

function parsePositiveInt(value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
}

function normalizePoolSlug(value, { allowScoped = false } = {}) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return DEFAULT_POOL_SLUG;
  if (POOL_SLUG_RE.test(raw)) return raw;
  if (allowScoped) {
    const scopedMatch = raw.match(SCOPED_POOL_RE);
    if (scopedMatch) {
      const owner = parsePositiveInt(scopedMatch[1]);
      const slug = scopedMatch[2];
      if (owner && POOL_SLUG_RE.test(slug)) return `u${owner}${POOL_SCOPE_SEP}${slug}`;
    }
  }
  return DEFAULT_POOL_SLUG;
}

function buildScopedPoolSlug(ownerUserId, poolSlug) {
  const owner = parsePositiveInt(ownerUserId);
  if (!owner) return poolSlug;
  return `u${owner}${POOL_SCOPE_SEP}${poolSlug}`;
}

function extractOwnerFromScopedPoolSlug(poolSlug) {
  const raw = typeof poolSlug === "string" ? poolSlug.trim().toLowerCase() : "";
  const match = raw.match(SCOPED_POOL_RE);
  if (!match) return null;
  return parsePositiveInt(match[1]);
}

function resolveTargetPoolSlug({ ownerUserId = null, poolSlug }) {
  const normalizedRaw = normalizePoolSlug(poolSlug, { allowScoped: true });
  const scopedOwner = extractOwnerFromScopedPoolSlug(normalizedRaw);
  if (scopedOwner) return normalizedRaw;
  const baseSlug = normalizePoolSlug(poolSlug, { allowScoped: false });
  return buildScopedPoolSlug(ownerUserId, baseSlug);
}

function parseAmountCents(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("invalid_square_payment_amount");
  }
  return amount;
}

function parseCreditsOverride(value) {
  if (value == null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("invalid_credits_override");
  }
  return amount;
}

export async function recordSubscriptionTopupFromSquarePayment({
  squarePaymentId,
  amountCents,
  currency = "CAD",
  poolSlug = DEFAULT_POOL_SLUG,
  ownerUserId = null,
  providerSubscriptionId = null,
  amountCreditsOverride = null,
  centsPerCredit = null,
}) {
  const paymentId = typeof squarePaymentId === "string" ? squarePaymentId.trim() : "";
  if (!paymentId) {
    throw new Error("square_payment_id_required");
  }

  const normalizedAmountCents = parseAmountCents(amountCents);
  const normalizedOwnerUserId = parsePositiveInt(ownerUserId);
  const normalizedCurrency = typeof currency === "string" && currency.trim() ? currency.trim() : "CAD";
  const normalizedPoolSlug = resolveTargetPoolSlug({
    ownerUserId: normalizedOwnerUserId,
    poolSlug,
  });
  const parsedOverride = parseCreditsOverride(amountCreditsOverride);
  const creditsToIssue =
    parsedOverride != null
      ? parsedOverride
      : computeCreditsFromDonation(normalizedAmountCents, centsPerCredit);
  const normalizedProviderSubscriptionId =
    typeof providerSubscriptionId === "string" && providerSubscriptionId.trim()
      ? providerSubscriptionId.trim()
      : null;

  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const poolId = await resolvePoolId({ client, poolSlug: normalizedPoolSlug });

    const { rows: [insertedTopup] = [] } = await client.query(
      `
        INSERT INTO subscription_topups
          (
            square_payment_id,
            owner_user_id,
            pool_id,
            provider_subscription_id,
            amount_cents,
            currency,
            amount_credits
          )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (square_payment_id) DO NOTHING
        RETURNING id, owner_user_id, pool_id, amount_credits, created_at
      `,
      [
        paymentId,
        normalizedOwnerUserId,
        poolId,
        normalizedProviderSubscriptionId,
        normalizedAmountCents,
        normalizedCurrency,
        creditsToIssue,
      ]
    );

    let topupId = null;
    let poolTransactionId = null;
    let creditsIssued = creditsToIssue;
    let creditsInserted = 0;
    let createdAt = null;

    if (insertedTopup?.id) {
      const { rows: [txRow] = [] } = await client.query(
        `
          INSERT INTO pool_transactions
            (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
          VALUES ($1, 'credit', $2, 'subscription_topup', NULL, NULL, NULL)
          RETURNING id, amount_credits
        `,
        [poolId, creditsToIssue]
      );

      topupId = insertedTopup.id;
      poolTransactionId = txRow?.id || null;
      creditsIssued = Number(txRow?.amount_credits) || creditsToIssue;
      creditsInserted = creditsIssued;
      createdAt = insertedTopup.created_at || null;

      if (poolTransactionId) {
        await client.query(
          `
            UPDATE subscription_topups
               SET pool_transaction_id = $1
             WHERE id = $2
          `,
          [poolTransactionId, topupId]
        );
      }
    } else {
      const { rows: [existingTopup] = [] } = await client.query(
        `
          SELECT id, owner_user_id, pool_id, amount_credits, pool_transaction_id, created_at
            FROM subscription_topups
           WHERE square_payment_id = $1
           LIMIT 1
        `,
        [paymentId]
      );
      topupId = existingTopup?.id || null;
      poolTransactionId = existingTopup?.pool_transaction_id || null;
      creditsIssued = Number(existingTopup?.amount_credits) || creditsToIssue;
      createdAt = existingTopup?.created_at || null;
    }

    const { rows: [balanceRow] = [] } = await client.query(
      `
        SELECT
          COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_credits ELSE 0 END), 0) AS credits_in,
          COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_credits ELSE 0 END), 0) AS credits_out
        FROM pool_transactions
        WHERE pool_id = $1
      `,
      [poolId]
    );
    const creditsIn = Number(balanceRow?.credits_in) || 0;
    const creditsOut = Number(balanceRow?.credits_out) || 0;

    await client.query("COMMIT");

    return {
      topupId,
      poolTransactionId,
      poolId,
      poolSlug: normalizedPoolSlug,
      ownerUserId: normalizedOwnerUserId,
      amountCents: normalizedAmountCents,
      currency: normalizedCurrency,
      creditsIssued,
      creditsInserted,
      alreadyProcessed: creditsInserted === 0,
      providerSubscriptionId: normalizedProviderSubscriptionId,
      createdAt,
      poolCreditsInTotal: creditsIn,
      poolCreditsOutTotal: creditsOut,
      poolCreditsRemaining: Math.max(0, creditsIn - creditsOut),
    };
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Subscription top-up rollback error:", rollbackError);
      }
    }
    throw error;
  } finally {
    if (client) client.release();
  }
}
