import pool from "../Backend/db/pg.js";
import { resolvePoolId, findNextDonationWithRemaining } from "./donationAttributionService.js";
import {
  applySemanticFundingPlan,
  buildFundingPolicyProfile,
  resolveSemanticFundingPlan,
} from "./fundingAllocationService.js";
import { buildFundingPoolCandidates, pickBestFundingPool } from "./poolRoutingService.js";
import { computeVolunteerReward } from "./volunteerRewardService.js";

const clampMinutes = (value) => {
  if (!Number.isFinite(Number(value))) return null;
  const n = Number(value);
  return Math.min(480, Math.max(15, n));
};

const computeDurationMinutes = (startAt, endAt) => {
  if (!startAt || !endAt) return null;
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diff = Math.round((end.getTime() - start.getTime()) / 60000);
  return diff > 0 ? diff : null;
};

async function fetchVerifiedRsvp(client, eventId, attendeeUserId) {
  const { rows } = await client.query(
    `
      SELECT
        r.event_id,
        r.attendee_user_id,
        r.attended_minutes,
        r.role_id,
        r.verification_status,
        e.reward_pool_kind,
        e.impact_credits_base,
        e.capacity,
        e.funding_pool_slug,
        e.funding_class_override,
        e.subsidy_eligible_override,
        e.subsidy_cap_percent_override,
        e.creator_user_id,
        e.start_at,
        e.end_at,
        COALESCE(er.tier, NULL) AS role_tier,
        COALESCE(primary_org.id, rep_org.id) AS host_org_id,
        COALESCE(primary_org.status, rep_org.status) AS host_org_status,
        COALESCE(primary_org.funding_class, rep_org.funding_class, 'mixed') AS host_org_funding_class,
        COALESCE(primary_org.subsidy_eligible, rep_org.subsidy_eligible, false) AS host_org_subsidy_eligible,
        COALESCE(primary_org.manual_override_only, rep_org.manual_override_only, false) AS host_org_manual_override_only
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
      LEFT JOIN event_roles er ON er.id = r.role_id
      LEFT JOIN userdata host ON host.id = e.creator_user_id
      LEFT JOIN organizations primary_org ON primary_org.id = host.org_id
      LEFT JOIN organizations rep_org ON rep_org.rep_user_id = e.creator_user_id
     WHERE r.event_id = $1
       AND r.attendee_user_id = $2
     LIMIT 1
    `,
    [eventId, attendeeUserId]
  );
  return rows?.[0] || null;
}

async function findExistingEarnShiftWalletTx(client, attendeeUserId, eventId) {
  const { rows: existing } = await client.query(
    `
      SELECT id, kind_amount
        FROM wallet_transactions
       WHERE user_id = $1
         AND event_id = $2
         AND direction = 'credit'
         AND reason = 'earn_shift'
       ORDER BY created_at DESC
       LIMIT 1
    `,
    [attendeeUserId, eventId]
  );
  if (!existing?.[0]) return null;
  return {
    walletTxId: existing[0].id,
    amount: Number(existing[0].kind_amount) || 0,
  };
}

async function findOrInsertWalletTx(client, attendeeUserId, eventId, amount) {
  const existing = await findExistingEarnShiftWalletTx(client, attendeeUserId, eventId);
  if (existing) {
    return { walletTxId: existing.walletTxId, amount: existing.amount || Number(amount) || 0, inserted: false };
  }
  try {
    const { rows } = await client.query(
      `
        INSERT INTO wallet_transactions (user_id, kind_amount, direction, reason, event_id, note)
        VALUES ($1, $2, 'credit', 'earn_shift', $3, 'verify')
        RETURNING id, kind_amount
      `,
      [attendeeUserId, amount, eventId]
    );
    return { walletTxId: rows?.[0]?.id, amount: Number(rows?.[0]?.kind_amount) || Number(amount) || 0, inserted: true };
  } catch (err) {
    err.stage = "wallet_insert";
    err.context = { event_id: eventId, user_id: attendeeUserId };
    console.error(
      "wallet_transactions insert failed",
      JSON.stringify({ event_id: eventId, user_id: attendeeUserId, stage: "wallet_insert", error: err.message })
    );
    throw err;
  }
}

async function findPendingCreditRequest(client, eventId, attendeeUserId) {
  const { rows: [row] = [] } = await client.query(
    `
      SELECT id, amount, status, created_at
        FROM pending_credit_requests
       WHERE event_id = $1
         AND volunteer_user_id = $2
         AND status = 'pending'
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `,
    [eventId, attendeeUserId]
  );
  return row || null;
}

async function findApprovedCreditRequest(client, eventId, attendeeUserId) {
  const { rows: [row] = [] } = await client.query(
    `
      SELECT id, amount, status, reviewed_at
        FROM pending_credit_requests
       WHERE event_id = $1
         AND volunteer_user_id = $2
         AND status = 'approved'
       ORDER BY reviewed_at DESC NULLS LAST, id DESC
       LIMIT 1
    `,
    [eventId, attendeeUserId]
  );
  return row || null;
}

async function insertPendingCreditRequest(client, rsvp, amount) {
  const existingPending = await findPendingCreditRequest(client, rsvp.event_id, rsvp.attendee_user_id);
  if (existingPending) {
    return {
      requestId: existingPending.id,
      amount: Number(existingPending.amount) || Number(amount) || 0,
      inserted: false,
      status: existingPending.status || "pending",
    };
  }

  const existingApproved = await findApprovedCreditRequest(client, rsvp.event_id, rsvp.attendee_user_id);
  if (existingApproved) {
    return {
      requestId: existingApproved.id,
      amount: Number(existingApproved.amount) || Number(amount) || 0,
      inserted: false,
      status: existingApproved.status || "approved",
    };
  }

  const { rows: [inserted] = [] } = await client.query(
    `
      INSERT INTO pending_credit_requests
        (event_id, volunteer_user_id, org_id, requested_by, amount, reason, status)
      VALUES
        ($1, $2, $3, $4, $5, 'earn_shift', 'pending')
      RETURNING id, amount, status
    `,
    [
      rsvp.event_id,
      rsvp.attendee_user_id,
      rsvp.host_org_id || null,
      rsvp.creator_user_id || null,
      Number(amount) || 0,
    ]
  );

  return {
    requestId: inserted?.id || null,
    amount: Number(inserted?.amount) || Number(amount) || 0,
    inserted: true,
    status: inserted?.status || "pending",
  };
}

async function getPoolBalance(client, poolId) {
  const { rows: [row] = [] } = await client.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_credits ELSE 0 END), 0) AS credits_in,
        COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_credits ELSE 0 END), 0) AS credits_out
      FROM pool_transactions
     WHERE pool_id = $1
    `,
    [poolId]
  );
  const creditsIn = Number(row?.credits_in) || 0;
  const creditsOut = Number(row?.credits_out) || 0;
  return creditsIn - creditsOut;
}

async function resolveFundingPoolSelection(client, { ownerUserId, poolSlug, creditsToFund }) {
  const candidatePoolSlugs = buildFundingPoolCandidates({ ownerUserId, poolSlug });
  const candidates = [];

  for (const candidatePoolSlug of candidatePoolSlugs) {
    const poolId = await resolvePoolId({ client, poolSlug: candidatePoolSlug });
    const poolBalance = await getPoolBalance(client, poolId);
    candidates.push({
      poolId,
      poolSlug: candidatePoolSlug,
      poolBalance,
    });
  }

  return pickBestFundingPool(candidates, creditsToFund);
}

const advisoryLock = async (client, userId, eventId) => {
  const key = `${userId}:${eventId}`;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
};

async function fetchExistingFunding(client, walletTxId) {
  const { rows: [poolTx] = [] } = await client.query(
    `
      SELECT id, donation_id, amount_credits
        FROM pool_transactions
       WHERE wallet_tx_id = $1
         AND reason = 'shift_out'
         AND direction = 'debit'
       LIMIT 1
    `,
    [walletTxId]
  );

  const { rows: [receipt] = [] } = await client.query(
    `
      SELECT id, donation_id, credits_funded, minutes_verified
        FROM donor_receipts
       WHERE wallet_tx_id = $1
       LIMIT 1
    `,
    [walletTxId]
  );

  return { poolTx: poolTx || null, receipt: receipt || null };
}

async function applyEarnShiftCreditAward(client, rsvp, creditAmount) {
  const minutes = clampMinutes(
    rsvp.attended_minutes != null ? rsvp.attended_minutes : computeDurationMinutes(rsvp.start_at, rsvp.end_at)
  );

  const { walletTxId, amount, inserted } = await findOrInsertWalletTx(
    client,
    rsvp.attendee_user_id,
    rsvp.event_id,
    creditAmount
  );
  if (!walletTxId) {
    return { skipped: true, reason: "wallet_insert_failed" };
  }

  const existingFunding = await fetchExistingFunding(client, walletTxId);
  const policyProfile = buildFundingPolicyProfile({
    funding_class_override: rsvp.funding_class_override,
    subsidy_eligible_override: rsvp.subsidy_eligible_override,
    subsidy_cap_percent_override: rsvp.subsidy_cap_percent_override,
    organization_status: rsvp.host_org_status,
    org_funding_class: rsvp.host_org_funding_class,
    org_subsidy_eligible: rsvp.host_org_subsidy_eligible,
    org_manual_override_only: rsvp.host_org_manual_override_only,
  });
  const semanticResolution = await resolveSemanticFundingPlan({
    client,
    ownerUserId: rsvp.creator_user_id,
    poolSlug: rsvp.funding_pool_slug,
    eventId: rsvp.event_id,
    organizationId: rsvp.host_org_id,
    creditsToFund: amount,
    policyProfile,
  });

  if (semanticResolution.mode === "semantic" && semanticResolution.selectedPlan?.allocations?.length) {
    const applied = await applySemanticFundingPlan({
      client,
      selectedPlan: semanticResolution.selectedPlan,
      walletTxId,
      eventId: rsvp.event_id,
      organizationId: rsvp.host_org_id,
      volunteerUserId: rsvp.attendee_user_id,
      minutesVerified: minutes,
    });

    const funded = Number(applied.fundedAmount) || 0;
    const deficit = Math.max(0, amount - funded);
    const donationDebited = semanticResolution.selectedPlan.allocations
      .filter((allocation) => allocation.donationId)
      .reduce((sum, allocation) => sum + (Number(allocation.amountIc) || 0), 0);

    if (deficit > 0) {
      console.warn(
        JSON.stringify({
          type: "POOL_DEFICIT",
          event_id: rsvp.event_id,
          user_id: rsvp.attendee_user_id,
          pool_slug: semanticResolution.selectedPlan.poolSlug || null,
          deficit,
          funded,
          allocation_mode: "semantic",
        })
      );
    }

    return {
      skipped: false,
      walletTxId,
      amount,
      funded,
      donationDebited,
      deficit,
      alreadyFunded: Boolean(existingFunding.receipt?.donation_id) || (existingFunding.receipt?.credits_funded || 0) > 0,
      inserted,
      donationId: applied.aggregateDonationId,
      poolSlug: semanticResolution.selectedPlan.poolSlug || null,
      allocationMode: "semantic",
    };
  }

  const selectedPool = await resolveFundingPoolSelection(client, {
    ownerUserId: rsvp.creator_user_id,
    poolSlug: rsvp.funding_pool_slug,
    creditsToFund: amount,
  });
  const poolId = selectedPool?.poolId;
  const poolBalance = selectedPool?.poolBalance || 0;
  const poolDebited = Math.min(amount, Math.max(0, poolBalance));

  const donationCandidate = await findNextDonationWithRemaining({
    client,
    poolId,
    poolSlug: selectedPool?.poolSlug,
  });
  const donationDebited =
    donationCandidate?.donationId && donationCandidate.donationRemainingCredits > 0
      ? Math.min(poolDebited, donationCandidate.donationRemainingCredits)
      : 0;
  const donationIdForRecord = donationDebited > 0 ? donationCandidate?.donationId : null;
  let deficit = Math.max(0, amount - poolDebited);
  const minutesValue = minutes ?? null;
  const alreadyFunded =
    Boolean(existingFunding.receipt?.donation_id) || (existingFunding.receipt?.credits_funded || 0) > 0;

  try {
    await client.query(
      `
        INSERT INTO pool_transactions
          (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
        VALUES ($1, 'debit', $2, 'shift_out', $3, $4, $5)
        ON CONFLICT (wallet_tx_id) WHERE (reason = 'shift_out' AND direction = 'debit')
        DO UPDATE SET donation_id = EXCLUDED.donation_id, amount_credits = EXCLUDED.amount_credits
          WHERE (pool_transactions.donation_id IS NULL OR pool_transactions.amount_credits = 0)
      `,
      [poolId, poolDebited, donationIdForRecord, rsvp.event_id, walletTxId]
    );
  } catch (err) {
    err.stage = "pool_debit";
    err.context = { event_id: rsvp.event_id, user_id: rsvp.attendee_user_id, wallet_tx_id: walletTxId };
    console.error(
      "pool_transactions insert/update failed",
      JSON.stringify({ event_id: rsvp.event_id, user_id: rsvp.attendee_user_id, wallet_tx_id: walletTxId, stage: "pool_debit", error: err.message })
    );
    throw err;
  }

  try {
    await client.query(
      `
        INSERT INTO donor_receipts
          (donation_id, event_id, volunteer_user_id, wallet_tx_id, credits_funded, minutes_verified)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (wallet_tx_id)
        DO UPDATE SET
          donation_id = COALESCE(donor_receipts.donation_id, EXCLUDED.donation_id),
          credits_funded = CASE
            WHEN donor_receipts.donation_id IS NULL AND donor_receipts.credits_funded = 0 THEN EXCLUDED.credits_funded
            ELSE donor_receipts.credits_funded
          END,
          minutes_verified = COALESCE(donor_receipts.minutes_verified, EXCLUDED.minutes_verified)
        WHERE donor_receipts.donation_id IS NULL AND donor_receipts.credits_funded = 0
      `,
      [donationIdForRecord, rsvp.event_id, rsvp.attendee_user_id, walletTxId, poolDebited, minutesValue]
    );
  } catch (err) {
    err.stage = "donor_receipt";
    err.context = { event_id: rsvp.event_id, user_id: rsvp.attendee_user_id, wallet_tx_id: walletTxId };
    console.error(
      "donor_receipts insert/update failed",
      JSON.stringify({ event_id: rsvp.event_id, user_id: rsvp.attendee_user_id, wallet_tx_id: walletTxId, stage: "donor_receipt", error: err.message })
    );
    throw err;
  }

  const { rows: [finalReceipt] = [] } = await client.query(
    `
      SELECT donation_id, credits_funded
        FROM donor_receipts
       WHERE wallet_tx_id = $1
       LIMIT 1
    `,
    [walletTxId]
  );

  const funded = Number(finalReceipt?.credits_funded) || 0;
  const resolvedDonationId = finalReceipt?.donation_id || null;
  deficit = Math.max(0, amount - funded);

  if (deficit > 0) {
    console.warn(
      JSON.stringify({
        type: "POOL_DEFICIT",
        event_id: rsvp.event_id,
        user_id: rsvp.attendee_user_id,
        pool_slug: selectedPool?.poolSlug || null,
        deficit,
        funded,
      })
    );
  }

  return {
    skipped: false,
    walletTxId,
    amount,
    funded,
    donationDebited,
    deficit,
    alreadyFunded,
    inserted,
    donationId: resolvedDonationId,
    poolSlug: selectedPool?.poolSlug || null,
  };
}

async function fetchPendingRequestForUpdate(client, requestId) {
  const { rows: [row] = [] } = await client.query(
    `
      SELECT
        id,
        event_id,
        volunteer_user_id,
        org_id,
        requested_by,
        amount,
        reason,
        status,
        created_at,
        reviewed_at,
        reviewed_by
      FROM pending_credit_requests
      WHERE id = $1
      FOR UPDATE
    `,
    [requestId]
  );
  return row || null;
}

export async function processVerifiedEarnShift({ client, attendeeUserId, eventId }) {
  const runner = client || (await pool.connect());
  const releaseNeeded = !client;
  try {
    await advisoryLock(runner, attendeeUserId, eventId);

    const rsvp = await fetchVerifiedRsvp(runner, eventId, attendeeUserId);
    if (!rsvp || rsvp.verification_status !== "verified") {
      return { skipped: true, reason: "not_verified" };
    }

    const reward = computeVolunteerReward({
      roleTier: rsvp.role_tier,
      impactCreditsBase: rsvp.impact_credits_base,
      attendedMinutes: rsvp.attended_minutes,
      startAt: rsvp.start_at,
      endAt: rsvp.end_at,
    });
    const creditAmount = reward.impact_credits_award;
    if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
      return { skipped: true, reason: "zero_credit" };
    }

    const existingAward = await findExistingEarnShiftWalletTx(runner, rsvp.attendee_user_id, rsvp.event_id);
    if (existingAward?.walletTxId) {
      return {
        skipped: false,
        pending: false,
        already_awarded: true,
        inserted: false,
        walletTxId: existingAward.walletTxId,
        amount: existingAward.amount || creditAmount,
      };
    }

    const request = await insertPendingCreditRequest(runner, rsvp, creditAmount);

    return {
      skipped: false,
      pending: request.status === "pending",
      already_awarded: request.status === "approved",
      inserted: request.inserted,
      requestId: request.requestId,
      amount: request.amount,
      status: request.status,
      reward_tier: reward.reward_tier,
      impact_credits_rate: reward.impact_credits_rate,
    };
  } finally {
    if (releaseNeeded) {
      runner.release();
    }
  }
}

export async function approvePendingCreditRequest({ client, requestId, reviewedBy }) {
  const normalizedRequestId = Number.parseInt(String(requestId || ""), 10);
  if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
    return { ok: false, status: 400, error: "invalid_request" };
  }

  const runner = client || (await pool.connect());
  const releaseNeeded = !client;

  try {
    const request = await fetchPendingRequestForUpdate(runner, normalizedRequestId);
    if (!request) {
      return { ok: false, status: 404, error: "not_found" };
    }

    if (request.status !== "pending") {
      return {
        ok: false,
        status: 409,
        error: "already_reviewed",
        request,
      };
    }

    await advisoryLock(runner, request.volunteer_user_id, request.event_id);

    const rsvp = await fetchVerifiedRsvp(runner, request.event_id, request.volunteer_user_id);
    if (!rsvp) {
      return { ok: false, status: 404, error: "rsvp_not_found" };
    }
    if (rsvp.verification_status !== "verified") {
      return { ok: false, status: 409, error: "not_verified" };
    }

    const amount = Number(request.amount) || 0;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, status: 400, error: "invalid_amount" };
    }

    const funding = await applyEarnShiftCreditAward(runner, rsvp, amount);

    const { rows: [updatedRequest] = [] } = await runner.query(
      `
        UPDATE pending_credit_requests
           SET status = 'approved',
               reviewed_at = NOW(),
               reviewed_by = $2
         WHERE id = $1
         RETURNING *
      `,
      [normalizedRequestId, reviewedBy || null]
    );

    return {
      ok: true,
      request: updatedRequest,
      funding,
    };
  } finally {
    if (releaseNeeded) {
      runner.release();
    }
  }
}

export async function rejectPendingCreditRequest({ client, requestId, reviewedBy, reason = null }) {
  const normalizedRequestId = Number.parseInt(String(requestId || ""), 10);
  if (!Number.isInteger(normalizedRequestId) || normalizedRequestId <= 0) {
    return { ok: false, status: 400, error: "invalid_request" };
  }

  const runner = client || (await pool.connect());
  const releaseNeeded = !client;

  try {
    const request = await fetchPendingRequestForUpdate(runner, normalizedRequestId);
    if (!request) {
      return { ok: false, status: 404, error: "not_found" };
    }

    if (request.status !== "pending") {
      return {
        ok: false,
        status: 409,
        error: "already_reviewed",
        request,
      };
    }

    const note = typeof reason === "string" ? reason.trim() : "";
    const mergedReason = note
      ? `${request.reason || "earn_shift"} | rejected: ${note}`.slice(0, 500)
      : (request.reason || "earn_shift");

    const { rows: [updatedRequest] = [] } = await runner.query(
      `
        UPDATE pending_credit_requests
           SET status = 'rejected',
               reviewed_at = NOW(),
               reviewed_by = $2,
               reason = $3
         WHERE id = $1
         RETURNING *
      `,
      [normalizedRequestId, reviewedBy || null, mergedReason]
    );

    return { ok: true, request: updatedRequest };
  } finally {
    if (releaseNeeded) {
      runner.release();
    }
  }
}

export async function finalizeVerifiedShift({ userId, eventId, client }) {
  return processVerifiedEarnShift({ client, attendeeUserId: userId, eventId });
}
