const SOURCE_TYPE_SET = new Set([
  "donation",
  "event_package",
  "subscription",
  "admin_grant",
  "pilot_subsidy",
  "org_topup",
  "reserve",
]);

const SCOPE_TYPE_SET = new Set(["event", "org", "unrestricted"]);
const ALLOCATION_STATUS_SET = new Set([
  "available",
  "held_pending_manual_review",
  "held_pending_subscription",
  "allocated",
  "partially_spent",
  "spent",
  "expired",
  "reversed",
]);

function normalizeSourceType(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SOURCE_TYPE_SET.has(normalized) ? normalized : "reserve";
}

function normalizeScopeType(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return SCOPE_TYPE_SET.has(normalized) ? normalized : "unrestricted";
}

function normalizeAllocationStatus(value, fallback = "available") {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (ALLOCATION_STATUS_SET.has(normalized)) return normalized;
  return ALLOCATION_STATUS_SET.has(fallback) ? fallback : "available";
}

function toPositiveInteger(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function toNonNegativeInteger(value, fallback = 0) {
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 ? num : fallback;
}

function parseJsonMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function resolveInitialFundingCreditStatus(sourceType) {
  const normalizedSourceType = normalizeSourceType(sourceType);
  if (normalizedSourceType === "donation") return "held_pending_manual_review";
  return "available";
}

export function buildFundingCreditPayload({
  poolId,
  originPoolTransactionId,
  sourceType,
  scopeType,
  organizationId = null,
  eventId = null,
  donationId = null,
  subscriptionTopupId = null,
  amountIc,
  remainingIc = null,
  allocationStatus = null,
  expiresAt = null,
  createdByUserId = null,
  metadata = {},
} = {}) {
  const normalizedSourceType = normalizeSourceType(sourceType);
  const normalizedScopeType = normalizeScopeType(scopeType);
  const normalizedAmount = toNonNegativeInteger(amountIc, 0);
  const normalizedRemaining = remainingIc == null
    ? normalizedAmount
    : Math.min(normalizedAmount, toNonNegativeInteger(remainingIc, normalizedAmount));

  return {
    poolId: toPositiveInteger(poolId),
    originPoolTransactionId: toPositiveInteger(originPoolTransactionId),
    sourceType: normalizedSourceType,
    scopeType: normalizedScopeType,
    organizationId: toPositiveInteger(organizationId),
    eventId: eventId || null,
    donationId: toPositiveInteger(donationId),
    subscriptionTopupId: toPositiveInteger(subscriptionTopupId),
    amountIc: normalizedAmount,
    remainingIc: normalizedRemaining,
    allocationStatus: normalizeAllocationStatus(
      allocationStatus,
      resolveInitialFundingCreditStatus(normalizedSourceType)
    ),
    expiresAt: expiresAt || null,
    createdByUserId: toPositiveInteger(createdByUserId),
    metadata: parseJsonMetadata(metadata),
  };
}

export async function resolveOrganizationIdForUser(client, userId) {
  const normalizedUserId = toPositiveInteger(userId);
  if (!client || !normalizedUserId) return null;
  const { rows: [row] = [] } = await client.query(
    `
      SELECT id
      FROM public.organizations
      WHERE rep_user_id = $1
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalizedUserId]
  );
  return toPositiveInteger(row?.id);
}

export async function createFundingCredit(client, input = {}) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("client with query() is required");
  }

  const payload = buildFundingCreditPayload(input);
  if (!payload.poolId || !payload.originPoolTransactionId) {
    throw new Error("poolId and originPoolTransactionId are required");
  }

  const insertParams = [
    payload.poolId,
    payload.originPoolTransactionId,
    payload.sourceType,
    payload.scopeType,
    payload.organizationId,
    payload.eventId,
    payload.donationId,
    payload.subscriptionTopupId,
    payload.amountIc,
    payload.remainingIc,
    payload.allocationStatus,
    payload.expiresAt,
    payload.createdByUserId,
    JSON.stringify(payload.metadata),
  ];

  const { rows: [inserted] = [] } = await client.query(
    `
      INSERT INTO public.funding_credits (
        pool_id,
        origin_pool_transaction_id,
        source_type,
        scope_type,
        organization_id,
        event_id,
        donation_id,
        subscription_topup_id,
        amount_ic,
        remaining_ic,
        allocation_status,
        expires_at,
        created_by_user_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
      ON CONFLICT (origin_pool_transaction_id) DO NOTHING
      RETURNING *
    `,
    insertParams
  );

  if (inserted) {
    return { created: true, row: inserted };
  }

  const { rows: [existing] = [] } = await client.query(
    `
      SELECT *
      FROM public.funding_credits
      WHERE origin_pool_transaction_id = $1
      LIMIT 1
    `,
    [payload.originPoolTransactionId]
  );
  return { created: false, row: existing || null };
}

export async function createFundingCreditFromDonation(client, {
  poolId,
  originPoolTransactionId,
  donationId,
  amountIc,
  createdByUserId = null,
  metadata = {},
} = {}) {
  return createFundingCredit(client, {
    poolId,
    originPoolTransactionId,
    sourceType: "donation",
    scopeType: "unrestricted",
    donationId,
    amountIc,
    createdByUserId,
    allocationStatus: "held_pending_manual_review",
    metadata,
  });
}

export async function createFundingCreditFromAdminTopup(client, {
  poolId,
  originPoolTransactionId,
  organizationId = null,
  amountIc,
  createdByUserId = null,
  metadata = {},
} = {}) {
  return createFundingCredit(client, {
    poolId,
    originPoolTransactionId,
    sourceType: "admin_grant",
    scopeType: "org",
    organizationId,
    amountIc,
    createdByUserId,
    allocationStatus: "available",
    metadata,
  });
}

export async function createFundingCreditFromSubscriptionTopup(client, {
  poolId,
  originPoolTransactionId,
  subscriptionTopupId = null,
  ownerUserId = null,
  organizationId = null,
  amountIc,
  metadata = {},
} = {}) {
  const resolvedOrganizationId = toPositiveInteger(organizationId)
    || await resolveOrganizationIdForUser(client, ownerUserId);

  return createFundingCredit(client, {
    poolId,
    originPoolTransactionId,
    sourceType: "subscription",
    scopeType: "org",
    organizationId: resolvedOrganizationId,
    subscriptionTopupId,
    amountIc,
    createdByUserId: ownerUserId,
    allocationStatus: "available",
    metadata: {
      ...parseJsonMetadata(metadata),
      scope_resolution_failed: !resolvedOrganizationId,
    },
  });
}
