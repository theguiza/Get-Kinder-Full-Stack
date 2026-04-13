import { findNextDonationWithRemaining, resolvePoolId } from "./donationAttributionService.js";
import {
  applySemanticFundingPlan,
  resolveSemanticFundingPlan,
} from "./fundingAllocationService.js";
import { buildFundingPoolCandidates, pickBestFundingPool } from "./poolRoutingService.js";

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

async function getPoolBalance({ client, poolId }) {
  const { rows: [bal] = [] } = await client.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_credits ELSE 0 END), 0) AS credits_in,
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_credits ELSE 0 END), 0) AS credits_out
      FROM pool_transactions
      WHERE pool_id = $1
    `,
    [poolId]
  );
  return toNumber(bal?.credits_in) - toNumber(bal?.credits_out);
}

async function resolveFundingPoolSelection({ client, ownerUserId = null, poolSlug = "general", creditsToFund }) {
  const candidatePoolSlugs = buildFundingPoolCandidates({ ownerUserId, poolSlug });
  const candidates = [];

  for (const candidatePoolSlug of candidatePoolSlugs) {
    const poolId = await resolvePoolId({ client, poolSlug: candidatePoolSlug });
    const poolBalance = await getPoolBalance({ client, poolId });
    candidates.push({
      poolId,
      poolSlug: candidatePoolSlug,
      poolBalance,
    });
  }

  return pickBestFundingPool(candidates, creditsToFund);
}

export async function fundEarnShiftFromPool({
  client,
  ownerUserId = null,
  poolSlug = "general",
  eventId,
  organizationId = null,
  volunteerUserId,
  walletTxId,
  creditsToFund,
  minutesVerified = null,
  policyProfile = null,
}) {
  if (!client) throw new Error("client required");
  const amount = toNumber(creditsToFund);
  if (amount <= 0) throw new Error("Invalid creditsToFund");

  const semanticResolution = await resolveSemanticFundingPlan({
    client,
    ownerUserId,
    poolSlug,
    eventId,
    organizationId,
    creditsToFund: amount,
    policyProfile,
  });

  if (semanticResolution.mode === "semantic" && semanticResolution.selectedPlan?.allocations?.length) {
    if ((semanticResolution.selectedPlan.fundedAmount || 0) < amount) {
      throw new Error("INSUFFICIENT_POOL");
    }
    const applied = await applySemanticFundingPlan({
      client,
      selectedPlan: semanticResolution.selectedPlan,
      walletTxId,
      eventId,
      organizationId,
      volunteerUserId,
      minutesVerified,
    });
    return {
      poolId: applied.poolId,
      poolSlug: applied.poolSlug || poolSlug,
      amountFunded: applied.fundedAmount,
      allocationMode: "semantic",
    };
  }

  const selectedPool = await resolveFundingPoolSelection({ client, ownerUserId, poolSlug, creditsToFund: amount });
  const poolId = selectedPool?.poolId;
  const poolBalance = toNumber(selectedPool?.poolBalance);
  if (poolBalance < amount) {
    throw new Error("INSUFFICIENT_POOL");
  }

  const donationSeed = await findNextDonationWithRemaining({
    client,
    poolId,
    poolSlug: selectedPool?.poolSlug,
  });
  if (!donationSeed?.donationId) {
    throw new Error("INSUFFICIENT_POOL");
  }

  const { rows: donationRows } = await client.query(
    `
      SELECT
        d.id AS donation_id,
        d.created_at,
        COALESCE(SUM(CASE WHEN pt.direction = 'credit' AND pt.reason = 'donation_in' THEN pt.amount_credits ELSE 0 END), 0) AS credits_in,
        COALESCE(SUM(CASE WHEN pt.direction = 'debit' AND pt.reason IN ('shift_out','manual_adjust') THEN pt.amount_credits ELSE 0 END), 0) AS credits_out
      FROM pool_transactions pt
      JOIN donations d ON d.id = pt.donation_id
      WHERE pt.pool_id = $1
      GROUP BY d.id, d.created_at
      HAVING COALESCE(SUM(CASE WHEN pt.direction = 'credit' AND pt.reason = 'donation_in' THEN pt.amount_credits ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN pt.direction = 'debit' AND pt.reason IN ('shift_out','manual_adjust') THEN pt.amount_credits ELSE 0 END), 0) > 0
      ORDER BY d.created_at ASC, d.id ASC
    `,
    [poolId]
  );

  let remaining = amount;

  for (const row of donationRows) {
    if (remaining <= 0) break;
    const available = toNumber(row.credits_in) - toNumber(row.credits_out);
    if (available <= 0) continue;
    const slice = Math.min(remaining, available);

    const minutesValue = minutesVerified == null ? null : toNumber(minutesVerified);

    await client.query(
      `
        INSERT INTO pool_transactions
          (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
        VALUES ($1, 'debit', $2, 'shift_out', $3, $4, $5)
      `,
      [poolId, slice, row.donation_id, eventId || null, walletTxId || null]
    );

    await client.query(
      `
        INSERT INTO donor_receipts
          (donation_id, event_id, volunteer_user_id, wallet_tx_id, credits_funded, minutes_verified)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [row.donation_id, eventId, volunteerUserId, walletTxId, slice, minutesValue]
    );

    remaining -= slice;
  }

  if (remaining > 0) {
    throw new Error("INSUFFICIENT_POOL");
  }

  return { poolId, poolSlug: selectedPool?.poolSlug || poolSlug, amountFunded: amount };
}
