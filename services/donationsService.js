import pool from "../Backend/db/pg.js";

export function computeCreditsFromDonation(amountCents, centsPerCredit = null) {
  const cents = Number(amountCents);
  if (!Number.isFinite(cents) || cents < 0) return 0;
  const divisorRaw = centsPerCredit != null ? centsPerCredit : process.env.CENTS_PER_CREDIT;
  const divisor = Number.isFinite(Number(divisorRaw)) && Number(divisorRaw) > 0 ? Number(divisorRaw) : 100;
  return Math.floor(cents / divisor);
}

export async function recordDonation({
  donorUserId = null,
  squarePaymentId = null,
  amountCents,
  currency = "CAD",
  poolSlug = "general",
  amountCreditsOverride = null,
  centsPerCredit = null,
}) {
  let client;
  let donationId = null;
  let effectiveAmountCents = Number(amountCents);
  const poolName = poolSlug === "general" ? "General Pool" : poolSlug;
  const effectiveCreditsOverride =
    amountCreditsOverride != null && Number.isFinite(Number(amountCreditsOverride))
      ? Math.max(0, Math.floor(Number(amountCreditsOverride)))
      : null;

  try {
    client = await pool.connect();
    await client.query("BEGIN");

    if (squarePaymentId) {
      const { rows } = await client.query(
        `SELECT id, amount_cents FROM donations WHERE square_payment_id = $1 LIMIT 1`,
        [squarePaymentId]
      );
      if (rows?.[0]) {
        donationId = rows[0].id;
        effectiveAmountCents = Number(rows[0].amount_cents);
      }
    }

    if (!donationId) {
      const { rows } = await client.query(
        `
          INSERT INTO donations (donor_user_id, square_payment_id, amount_cents, currency, status)
          VALUES ($1, $2, $3, $4, 'captured')
          RETURNING id, amount_cents
        `,
        [donorUserId || null, squarePaymentId || null, effectiveAmountCents, currency || "CAD"]
      );
      donationId = rows?.[0]?.id;
      effectiveAmountCents = Number(rows?.[0]?.amount_cents);
    }

    const { rows: poolRows } = await client.query(
      `
        INSERT INTO funding_pools (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO UPDATE SET name = funding_pools.name
        RETURNING id
      `,
      [poolSlug, poolName]
    );
    const poolId = poolRows?.[0]?.id;

    const creditsIssued =
      effectiveCreditsOverride !== null
        ? effectiveCreditsOverride
        : computeCreditsFromDonation(effectiveAmountCents, centsPerCredit);

    const { rows: existingCreditRows } = await client.query(
      `
        SELECT COALESCE(SUM(amount_credits), 0) AS issued
          FROM pool_transactions
         WHERE pool_id = $1
           AND donation_id = $2
           AND direction = 'credit'
           AND reason = 'donation_in'
      `,
      [poolId, donationId]
    );
    const alreadyIssued = Number(existingCreditRows?.[0]?.issued) || 0;

    let issuedForReturn = alreadyIssued;
    let creditsInserted = 0;

    if (alreadyIssued === 0) {
      await client.query(
        `
          INSERT INTO pool_transactions
            (pool_id, direction, amount_credits, reason, donation_id)
          VALUES ($1, 'credit', $2, 'donation_in', $3)
        `,
        [poolId, creditsIssued, donationId]
      );
      issuedForReturn = creditsIssued;
      creditsInserted = creditsIssued;
    }

    await client.query("COMMIT");
    return {
      donationId,
      poolId,
      creditsIssued: issuedForReturn || creditsIssued,
      creditsInserted,
    };
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Donation rollback error:", rollbackErr);
      }
    }
    throw err;
  } finally {
    if (client) client.release();
  }
}

export async function recordDonationFromSquarePayment({
  squarePaymentId,
  amountCents,
  currency = "CAD",
  poolSlug = "general",
  centsPerCredit = null,
}) {
  const normalizedAmount = Number(amountCents);
  if (!Number.isInteger(normalizedAmount) || normalizedAmount < 0) {
    throw new Error("invalid_square_payment_amount");
  }

  const normalizedPoolSlug =
    typeof poolSlug === "string" && poolSlug.trim() ? poolSlug.trim() : "general";
  const centsPerCreditOverride = Number.isFinite(Number(centsPerCredit))
    ? Number(centsPerCredit)
    : null;

  const result = await recordDonation({
    donorUserId: null,
    squarePaymentId: squarePaymentId || null,
    amountCents: normalizedAmount,
    currency: currency || "CAD",
    poolSlug: normalizedPoolSlug,
    amountCreditsOverride: null,
    centsPerCredit: centsPerCreditOverride,
  });

  return {
    donationId: result?.donationId || null,
    poolSlug: normalizedPoolSlug,
    amountCents: normalizedAmount,
    currency: currency || "CAD",
    creditsIssued: result?.creditsIssued ?? 0,
    creditsInserted: result?.creditsInserted ?? result?.creditsIssued ?? 0,
    status: "captured",
  };
}
