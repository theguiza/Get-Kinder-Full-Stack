import pool from "../Backend/db/pg.js";
import { resolvePoolId, findNextDonationWithRemaining } from "./donationAttributionService.js";

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

const computeCreditAmount = (rewardPoolKind, capacity, impactCreditsBase) => {
  const poolValue = Number(rewardPoolKind) || 0;
  const cap = Number.isFinite(Number(capacity)) && Number(capacity) > 0 ? Number(capacity) : 1;
  const pooledCredits = Math.floor(poolValue / Math.max(1, cap));
  if (Number.isFinite(pooledCredits) && pooledCredits > 0) return pooledCredits;
  const baseCredits = Math.floor(Number(impactCreditsBase) || 0);
  return baseCredits > 0 ? baseCredits : 0;
};

const DEFAULT_POOL_SLUG = "general";
const POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const POOL_SCOPE_SEP = "__";

const normalizePoolSlug = (value) => {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return DEFAULT_POOL_SLUG;
  return POOL_SLUG_RE.test(slug) ? slug : DEFAULT_POOL_SLUG;
};

const buildScopedPoolSlug = (ownerUserId, poolSlug) => {
  const owner = String(ownerUserId || "").trim();
  if (!owner) return poolSlug;
  return `u${owner}${POOL_SCOPE_SEP}${poolSlug}`;
};

async function fetchVerifiedRsvp(client, eventId, attendeeUserId) {
  const { rows } = await client.query(
    `
      SELECT
        r.event_id,
        r.attendee_user_id,
        r.attended_minutes,
        r.verification_status,
        e.reward_pool_kind,
        e.impact_credits_base,
        e.capacity,
        e.funding_pool_slug,
        e.creator_user_id,
        e.start_at,
        e.end_at,
        host.org_id AS host_org_id
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
      LEFT JOIN userdata host ON host.id = e.creator_user_id
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

  const poolSlug = normalizePoolSlug(rsvp.funding_pool_slug);
  const scopedPoolSlug = buildScopedPoolSlug(rsvp.creator_user_id, poolSlug);
  const poolId = await resolvePoolId({ client, poolSlug: scopedPoolSlug });
  const poolBalance = await getPoolBalance(client, poolId);
  const poolDebited = Math.min(amount, Math.max(0, poolBalance));

  const donationCandidate = await findNextDonationWithRemaining({ client, poolId, poolSlug: scopedPoolSlug });
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

    const creditAmount = computeCreditAmount(
      rsvp.reward_pool_kind,
      rsvp.capacity,
      rsvp.impact_credits_base
    );
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
