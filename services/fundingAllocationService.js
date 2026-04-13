import { resolvePoolId } from "./donationAttributionService.js";
import { resolveEffectivePolicyProfile } from "./donationPolicyService.js";
import { buildFundingPoolCandidates } from "./poolRoutingService.js";

const ACTIVE_ALLOCATION_STATUS = new Set(["available", "allocated", "partially_spent"]);
const SOURCE_PRIORITY = {
  event_package: 10,
  org_topup: 20,
  subscription: 30,
  admin_grant: 40,
  pilot_subsidy: 40,
  donation: 50,
  reserve: 60,
};
const SCOPE_PRIORITY = {
  event: 0,
  org: 1,
  unrestricted: 2,
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toPositiveInteger = (value) => {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
};

const toNullableDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function buildFundingPolicyProfile(candidate = {}) {
  return resolveEffectivePolicyProfile(candidate);
}

export function buildFundingAllocationContext({
  eventId = null,
  organizationId = null,
  creditsToFund = 0,
  policyProfile = null,
  now = new Date(),
} = {}) {
  return {
    eventId: eventId || null,
    organizationId: toPositiveInteger(organizationId),
    creditsToFund: Math.max(0, toNumber(creditsToFund)),
    allowUnrestrictedDonation: policyProfile?.isEligible === true,
    now: toNullableDate(now) || new Date(),
  };
}

export function isFundingCreditEligible(row, context = {}) {
  if (!row) return false;

  const allocationStatus = String(row.allocation_status || "").trim().toLowerCase();
  if (!ACTIVE_ALLOCATION_STATUS.has(allocationStatus)) return false;

  const remainingIc = Math.max(0, toNumber(row.remaining_ic));
  if (remainingIc <= 0) return false;

  const expiresAt = toNullableDate(row.expires_at);
  if (expiresAt && expiresAt.getTime() <= (context.now?.getTime?.() || Date.now())) return false;

  const scopeType = String(row.scope_type || "").trim().toLowerCase();
  const sourceType = String(row.source_type || "").trim().toLowerCase();
  const organizationId = toPositiveInteger(row.organization_id);
  const eventId = row.event_id || null;

  if (scopeType === "event" && String(eventId || "") !== String(context.eventId || "")) {
    return false;
  }
  if (scopeType === "org" && organizationId !== toPositiveInteger(context.organizationId)) {
    return false;
  }
  if (scopeType === "unrestricted" && sourceType === "donation" && context.allowUnrestrictedDonation !== true) {
    return false;
  }

  if (sourceType === "event_package") {
    return scopeType === "event" && String(eventId || "") === String(context.eventId || "");
  }

  return Boolean(SOURCE_PRIORITY[sourceType]);
}

function compareFundingCredits(a, b) {
  const sourceRankA = SOURCE_PRIORITY[String(a.source_type || "").trim().toLowerCase()] ?? 999;
  const sourceRankB = SOURCE_PRIORITY[String(b.source_type || "").trim().toLowerCase()] ?? 999;
  if (sourceRankA !== sourceRankB) return sourceRankA - sourceRankB;

  const scopeRankA = SCOPE_PRIORITY[String(a.scope_type || "").trim().toLowerCase()] ?? 99;
  const scopeRankB = SCOPE_PRIORITY[String(b.scope_type || "").trim().toLowerCase()] ?? 99;
  if (scopeRankA !== scopeRankB) return scopeRankA - scopeRankB;

  const expiresA = toNullableDate(a.expires_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  const expiresB = toNullableDate(b.expires_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (expiresA !== expiresB) return expiresA - expiresB;

  const createdA = toNullableDate(a.created_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  const createdB = toNullableDate(b.created_at)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (createdA !== createdB) return createdA - createdB;

  return toNumber(a.id, 0) - toNumber(b.id, 0);
}

export function buildFundingAllocationPlan(rows = [], context = {}) {
  const normalizedContext = buildFundingAllocationContext(context);
  const eligibleCredits = (Array.isArray(rows) ? rows : [])
    .filter((row) => isFundingCreditEligible(row, normalizedContext))
    .sort(compareFundingCredits);

  let remaining = normalizedContext.creditsToFund;
  const allocations = [];

  for (const row of eligibleCredits) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, Math.max(0, toNumber(row.remaining_ic)));
    if (slice <= 0) continue;
    allocations.push({
      fundingCreditId: toNumber(row.id, 0),
      poolId: toNumber(row.pool_id, 0),
      sourceType: String(row.source_type || "").trim().toLowerCase(),
      scopeType: String(row.scope_type || "").trim().toLowerCase(),
      organizationId: toPositiveInteger(row.organization_id),
      eventId: row.event_id || null,
      donationId: toPositiveInteger(row.donation_id),
      amountIc: slice,
      allocationRank: allocations.length + 1,
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {},
    });
    remaining -= slice;
  }

  return {
    eligibleCredits,
    allocations,
    fundedAmount: normalizedContext.creditsToFund - remaining,
    remainingAmount: remaining,
    semanticAvailableAmount: eligibleCredits.reduce((sum, row) => sum + Math.max(0, toNumber(row.remaining_ic)), 0),
  };
}

async function fetchFundingCreditsForPool(client, poolId, now = new Date()) {
  const { rows } = await client.query(
    `
      SELECT
        fc.id,
        fc.pool_id,
        fc.source_type,
        fc.scope_type,
        fc.organization_id,
        fc.event_id,
        fc.donation_id,
        fc.amount_ic,
        fc.remaining_ic,
        fc.allocation_status,
        fc.expires_at,
        fc.metadata,
        fc.created_at
      FROM public.funding_credits fc
      WHERE fc.pool_id = $1
        AND fc.remaining_ic > 0
        AND fc.allocation_status IN ('available', 'allocated', 'partially_spent')
        AND (fc.expires_at IS NULL OR fc.expires_at > $2)
      ORDER BY fc.created_at ASC, fc.id ASC
    `,
    [poolId, now],
  );
  return rows || [];
}

async function getPoolBalance(client, poolId) {
  const { rows: [row] = [] } = await client.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_credits ELSE 0 END), 0) AS credits_in,
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_credits ELSE 0 END), 0) AS credits_out
      FROM public.pool_transactions
      WHERE pool_id = $1
    `,
    [poolId],
  );
  return Math.max(0, toNumber(row?.credits_in) - toNumber(row?.credits_out));
}

export async function resolveSemanticFundingPlan({
  client,
  ownerUserId = null,
  poolSlug = "general",
  eventId = null,
  organizationId = null,
  creditsToFund = 0,
  policyProfile = null,
  now = new Date(),
} = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("client with query() is required");
  }

  const candidatePoolSlugs = buildFundingPoolCandidates({ ownerUserId, poolSlug });
  const context = buildFundingAllocationContext({
    eventId,
    organizationId,
    creditsToFund,
    policyProfile,
    now,
  });

  const candidatePlans = [];
  for (let index = 0; index < candidatePoolSlugs.length; index += 1) {
    const candidatePoolSlug = candidatePoolSlugs[index];
    const poolId = await resolvePoolId({ client, poolSlug: candidatePoolSlug });
    const [poolBalance, creditRows] = await Promise.all([
      getPoolBalance(client, poolId),
      fetchFundingCreditsForPool(client, poolId, context.now),
    ]);
    const plan = buildFundingAllocationPlan(creditRows, context);
    candidatePlans.push({
      candidateIndex: index,
      poolId,
      poolSlug: candidatePoolSlug,
      poolBalance,
      ...plan,
    });
  }

  const semanticCandidates = candidatePlans.filter((candidate) => candidate.eligibleCredits.length > 0);
  if (!semanticCandidates.length) {
    return {
      mode: "legacy",
      candidatePlans,
      selectedPlan: null,
    };
  }

  const fullyFunded = semanticCandidates.find((candidate) => candidate.remainingAmount <= 0);
  if (fullyFunded) {
    return {
      mode: "semantic",
      candidatePlans,
      selectedPlan: fullyFunded,
    };
  }

  const selectedPlan = [...semanticCandidates].sort((a, b) => {
    if (a.fundedAmount !== b.fundedAmount) return b.fundedAmount - a.fundedAmount;
    return a.candidateIndex - b.candidateIndex;
  })[0];

  return {
    mode: "semantic",
    candidatePlans,
    selectedPlan,
  };
}

export function apportionMinutesAcrossAllocations(totalMinutes, allocations = []) {
  const normalizedMinutes = Number.isInteger(Number(totalMinutes)) && Number(totalMinutes) >= 0
    ? Number(totalMinutes)
    : null;
  if (normalizedMinutes == null) {
    return allocations.map(() => null);
  }

  const totalCredits = allocations.reduce((sum, allocation) => sum + Math.max(0, toNumber(allocation.amountIc)), 0);
  if (totalCredits <= 0) return allocations.map(() => 0);

  let assigned = 0;
  return allocations.map((allocation, index) => {
    if (index === allocations.length - 1) {
      return Math.max(0, normalizedMinutes - assigned);
    }
    const share = Math.round((normalizedMinutes * Math.max(0, toNumber(allocation.amountIc))) / totalCredits);
    assigned += share;
    return share;
  });
}

async function upsertAggregatePoolDebit({
  client,
  poolId,
  eventId = null,
  walletTxId,
  fundedAmount,
  aggregateDonationId = null,
}) {
  const { rows: [row] = [] } = await client.query(
    `
      INSERT INTO public.pool_transactions
        (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
      VALUES ($1, 'debit', $2, 'shift_out', $3, $4, $5)
      ON CONFLICT (wallet_tx_id) WHERE (reason = 'shift_out' AND direction = 'debit')
      DO UPDATE SET
        amount_credits = GREATEST(public.pool_transactions.amount_credits, EXCLUDED.amount_credits),
        donation_id = CASE
          WHEN public.pool_transactions.amount_credits <= EXCLUDED.amount_credits THEN EXCLUDED.donation_id
          ELSE public.pool_transactions.donation_id
        END
      RETURNING id, amount_credits, donation_id
    `,
    [poolId, fundedAmount, aggregateDonationId, eventId || null, walletTxId],
  );
  return row || null;
}

async function upsertAggregateDonorReceipt({
  client,
  aggregateDonationId = null,
  eventId,
  volunteerUserId,
  walletTxId,
  fundedAmount,
  minutesVerified = null,
}) {
  const { rows: [row] = [] } = await client.query(
    `
      INSERT INTO public.donor_receipts
        (donation_id, event_id, volunteer_user_id, wallet_tx_id, credits_funded, minutes_verified)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (wallet_tx_id)
      DO UPDATE SET
        donation_id = CASE
          WHEN public.donor_receipts.credits_funded <= EXCLUDED.credits_funded THEN EXCLUDED.donation_id
          ELSE public.donor_receipts.donation_id
        END,
        credits_funded = GREATEST(public.donor_receipts.credits_funded, EXCLUDED.credits_funded),
        minutes_verified = COALESCE(public.donor_receipts.minutes_verified, EXCLUDED.minutes_verified)
      RETURNING id, donation_id, credits_funded
    `,
    [aggregateDonationId, eventId, volunteerUserId, walletTxId, fundedAmount, minutesVerified],
  );
  return row || null;
}

export async function applySemanticFundingPlan({
  client,
  selectedPlan,
  walletTxId,
  eventId = null,
  organizationId = null,
  volunteerUserId,
  minutesVerified = null,
} = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("client with query() is required");
  }
  if (!selectedPlan || !Array.isArray(selectedPlan.allocations) || selectedPlan.allocations.length === 0) {
    return {
      fundedAmount: 0,
      aggregateDonationId: null,
      poolId: selectedPlan?.poolId || null,
      poolSlug: selectedPlan?.poolSlug || null,
      allocationsApplied: 0,
    };
  }

  const fundedAmount = selectedPlan.allocations.reduce((sum, allocation) => sum + Math.max(0, toNumber(allocation.amountIc)), 0);
  const donationIds = [...new Set(
    selectedPlan.allocations
      .map((allocation) => toPositiveInteger(allocation.donationId))
      .filter(Boolean),
  )];
  const aggregateDonationId = donationIds.length === 1 ? donationIds[0] : null;
  const poolTx = await upsertAggregatePoolDebit({
    client,
    poolId: selectedPlan.poolId,
    eventId,
    walletTxId,
    fundedAmount,
    aggregateDonationId,
  });
  const donorReceipt = await upsertAggregateDonorReceipt({
    client,
    aggregateDonationId,
    eventId,
    volunteerUserId,
    walletTxId,
    fundedAmount,
    minutesVerified,
  });
  const apportionedMinutes = apportionMinutesAcrossAllocations(minutesVerified, selectedPlan.allocations);

  for (let index = 0; index < selectedPlan.allocations.length; index += 1) {
    const allocation = selectedPlan.allocations[index];
    const metadata = {
      source_type: allocation.sourceType,
      scope_type: allocation.scopeType,
      donation_id: allocation.donationId,
      stage: "stage4_semantic_allocator",
    };

    await client.query(
      `
        UPDATE public.funding_credits
        SET remaining_ic = GREATEST(remaining_ic - $2, 0),
            allocation_status = CASE
              WHEN GREATEST(remaining_ic - $2, 0) = 0 THEN 'spent'
              WHEN GREATEST(remaining_ic - $2, 0) < amount_ic THEN 'partially_spent'
              ELSE allocation_status
            END,
            updated_at = NOW()
        WHERE id = $1
      `,
      [allocation.fundingCreditId, allocation.amountIc],
    );

    await client.query(
      `
        INSERT INTO public.funding_allocations (
          funding_credit_id,
          pool_transaction_id,
          wallet_tx_id,
          donor_receipt_id,
          event_id,
          organization_id,
          volunteer_user_id,
          amount_ic,
          minutes_funded,
          allocation_rank,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      `,
      [
        allocation.fundingCreditId,
        poolTx?.id || null,
        walletTxId,
        donorReceipt?.id || null,
        eventId || null,
        toPositiveInteger(organizationId),
        volunteerUserId,
        allocation.amountIc,
        apportionedMinutes[index],
        allocation.allocationRank || index + 1,
        JSON.stringify({
          ...metadata,
          ...allocation.metadata,
        }),
      ],
    );
  }

  return {
    fundedAmount,
    aggregateDonationId,
    poolId: selectedPlan.poolId,
    poolSlug: selectedPlan.poolSlug,
    allocationsApplied: selectedPlan.allocations.length,
  };
}
