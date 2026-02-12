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

const computeCreditAmount = (rewardPoolKind, capacity) => {
  const poolValue = Number(rewardPoolKind) || 0;
  const cap = Number.isFinite(Number(capacity)) && Number(capacity) > 0 ? Number(capacity) : 1;
  return Math.floor(poolValue / Math.max(1, cap));
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
        e.capacity,
        e.start_at,
        e.end_at
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
     WHERE r.event_id = $1
       AND r.attendee_user_id = $2
     LIMIT 1
    `,
    [eventId, attendeeUserId]
  );
  return rows?.[0] || null;
}

async function findOrInsertWalletTx(client, attendeeUserId, eventId, amount) {
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
  if (existing?.[0]) {
    return { walletTxId: existing[0].id, amount: Number(existing[0].kind_amount) || Number(amount) || 0, inserted: false };
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

export async function processVerifiedEarnShift({ client, attendeeUserId, eventId }) {
  const runner = client || (await pool.connect());
  let releaseNeeded = !client;
  try {
    await advisoryLock(runner, attendeeUserId, eventId);

    const rsvp = await fetchVerifiedRsvp(runner, eventId, attendeeUserId);
    if (!rsvp || rsvp.verification_status !== "verified") {
      return { skipped: true, reason: "not_verified" };
    }

    const minutes = clampMinutes(
      rsvp.attended_minutes != null ? rsvp.attended_minutes : computeDurationMinutes(rsvp.start_at, rsvp.end_at)
    );
    const creditAmount = computeCreditAmount(rsvp.reward_pool_kind, rsvp.capacity);
    if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
      return { skipped: true, reason: "zero_credit" };
    }

    const { walletTxId, amount, inserted } = await findOrInsertWalletTx(
      runner,
      rsvp.attendee_user_id,
      rsvp.event_id,
      creditAmount
    );
    if (!walletTxId) {
      return { skipped: true, reason: "wallet_insert_failed" };
    }

    const existingFunding = await fetchExistingFunding(runner, walletTxId);

    const poolId = await resolvePoolId({ client: runner, poolSlug: "general" });
    const poolBalance = await getPoolBalance(runner, poolId);
    const poolDebited = Math.min(amount, Math.max(0, poolBalance));

    const donationCandidate = await findNextDonationWithRemaining({ client: runner, poolId, poolSlug: "general" });
    const donationDebited =
      donationCandidate?.donationId && donationCandidate.donationRemainingCredits > 0
        ? Math.min(poolDebited, donationCandidate.donationRemainingCredits)
        : 0;
    const donationIdForRecord =
      donationDebited > 0 ? donationCandidate?.donationId : existingFunding.poolTx?.donation_id || null;
    let deficit = Math.max(0, amount - donationDebited);
    const minutesValue = minutes ?? null;
    const alreadyFunded =
      Boolean(existingFunding.receipt?.donation_id) || (existingFunding.receipt?.credits_funded || 0) > 0;

    try {
      await runner.query(
        `
          INSERT INTO pool_transactions
            (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
          VALUES ($1, 'debit', $2, 'shift_out', $3, $4, $5)
          ON CONFLICT (wallet_tx_id) WHERE (reason = 'shift_out' AND direction = 'debit')
          DO UPDATE SET donation_id = EXCLUDED.donation_id, amount_credits = EXCLUDED.amount_credits
            WHERE (pool_transactions.donation_id IS NULL OR pool_transactions.amount_credits = 0)
        `,
        [poolId, donationDebited, donationIdForRecord, rsvp.event_id, walletTxId]
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
      await runner.query(
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
        [donationIdForRecord, rsvp.event_id, rsvp.attendee_user_id, walletTxId, donationDebited, minutesValue]
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

    const { rows: [finalReceipt] = [] } = await runner.query(
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
      donationDebited: funded,
      deficit,
      alreadyFunded,
      inserted,
      donationId: resolvedDonationId,
    };
  } finally {
    if (releaseNeeded) {
      runner.release();
    }
  }
}

export async function finalizeVerifiedShift({ userId, eventId, client }) {
  return processVerifiedEarnShift({ client, attendeeUserId: userId, eventId });
}
