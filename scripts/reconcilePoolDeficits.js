// Usage:
//   node scripts/reconcilePoolDeficits.js --limit=200 --dry-run
import pool from "../Backend/db/pg.js";
import { findNextDonationWithRemaining, resolvePoolId } from "../services/donationAttributionService.js";

const DEFAULT_POOL_SLUG = "general";
const POOL_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function normalizePoolSlug(value) {
  const slug = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!slug) return DEFAULT_POOL_SLUG;
  return POOL_SLUG_RE.test(slug) ? slug : DEFAULT_POOL_SLUG;
}

function parseArgs() {
  const argMap = new Map();
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.split("=");
    if (k && v !== undefined) argMap.set(k.replace(/^--/, ""), v);
    if (k === "--dry-run") argMap.set("dry-run", "true");
  }
  const limitRaw = argMap.get("limit");
  const limit = Number.isInteger(Number(limitRaw)) && Number(limitRaw) > 0 ? Number(limitRaw) : 200;
  const dryRun = argMap.has("dry-run");
  return { limit, dryRun };
}

async function fetchDeficitCandidates(limit) {
  const { rows } = await pool.query(
    `
      SELECT
        wt.id AS wallet_tx_id,
        wt.user_id,
        wt.event_id,
        wt.kind_amount AS wallet_amount,
        wt.created_at AS wallet_created_at,
        pt.id AS pool_tx_id,
        pt.pool_id,
        pt.donation_id AS pool_donation_id,
        pt.amount_credits AS pool_funded,
        dr.id AS receipt_id,
        dr.donation_id AS receipt_donation_id,
        dr.credits_funded AS receipt_funded,
        dr.minutes_verified AS receipt_minutes,
        e.funding_pool_slug
      FROM wallet_transactions wt
      LEFT JOIN LATERAL (
        SELECT id, pool_id, donation_id, amount_credits
          FROM pool_transactions
         WHERE wallet_tx_id = wt.id
           AND reason = 'shift_out'
           AND direction = 'debit'
         ORDER BY created_at DESC, id DESC
         LIMIT 1
      ) pt ON TRUE
      LEFT JOIN donor_receipts dr
        ON dr.wallet_tx_id = wt.id
      LEFT JOIN events e ON e.id = wt.event_id
     WHERE wt.reason = 'earn_shift'
       AND wt.direction = 'credit'
       AND COALESCE(dr.credits_funded, pt.amount_credits, 0) < wt.kind_amount
     ORDER BY wt.created_at ASC, wt.id ASC
     LIMIT $1
    `,
    [limit]
  );
  return rows || [];
}

async function tryLock(client, walletTxId) {
  const { rows: [row] = [] } = await client.query(
    `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`,
    [String(walletTxId)]
  );
  return Boolean(row?.locked);
}

async function getDonationRemaining({ client, donationId }) {
  if (!donationId) return 0;
  const { rows: [row] = [] } = await client.query(
    `
      SELECT
        COALESCE(SUM(CASE WHEN direction = 'credit' AND reason = 'donation_in' THEN amount_credits ELSE 0 END), 0) AS credits_in,
        COALESCE(SUM(CASE WHEN direction = 'debit'  AND reason = 'shift_out'   THEN amount_credits ELSE 0 END), 0) AS credits_out
      FROM pool_transactions
     WHERE donation_id = $1
    `,
    [donationId]
  );
  return Math.max(0, Number(row?.credits_in || 0) - Number(row?.credits_out || 0));
}

async function updatePoolTx({ client, poolId, walletTxId, eventId, donationId, fundAmount, walletAmount }) {
  const { rows: [row] = [] } = await client.query(
    `
      INSERT INTO pool_transactions
        (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
      VALUES ($1, 'debit', $2, 'shift_out', $3, $4, $5)
      ON CONFLICT (wallet_tx_id) WHERE (reason = 'shift_out' AND direction = 'debit')
      DO UPDATE SET
        donation_id = EXCLUDED.donation_id,
        amount_credits = LEAST($6, pool_transactions.amount_credits + EXCLUDED.amount_credits)
      RETURNING amount_credits, donation_id
    `,
    [poolId, fundAmount, donationId, eventId, walletTxId, walletAmount]
  );
  return { amountCredits: Number(row?.amount_credits) || 0, donationId: row?.donation_id || donationId };
}

async function updateReceipt({ client, walletTxId, eventId, volunteerUserId, donationId, fundAmount, minutesVerified, walletAmount }) {
  const { rows: [row] = [] } = await client.query(
    `
      INSERT INTO donor_receipts
        (donation_id, event_id, volunteer_user_id, wallet_tx_id, credits_funded, minutes_verified)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (wallet_tx_id)
      DO UPDATE SET
        donation_id = EXCLUDED.donation_id,
        credits_funded = LEAST($7, donor_receipts.credits_funded + EXCLUDED.credits_funded),
        minutes_verified = COALESCE(donor_receipts.minutes_verified, EXCLUDED.minutes_verified)
      RETURNING credits_funded, donation_id
    `,
    [donationId, eventId, volunteerUserId, walletTxId, fundAmount, minutesVerified, walletAmount]
  );
  return { creditsFunded: Number(row?.credits_funded) || 0, donationId: row?.donation_id || donationId };
}

async function processCandidate({ client, candidate, poolId, dryRun }) {
  const funded = Math.max(Number(candidate.receipt_funded) || 0, Number(candidate.pool_funded) || 0);
  const walletAmount = Number(candidate.wallet_amount) || 0;
  const deficit = Math.max(0, walletAmount - funded);
  if (deficit <= 0) {
    return { skipped: true, reason: "no_deficit" };
  }

  let donationPick = candidate.pool_donation_id || candidate.receipt_donation_id || null;
  let donationRemaining = donationPick ? await getDonationRemaining({ client, donationId: donationPick }) : 0;

  if (!donationPick || donationRemaining <= 0) {
    const donationCandidate = await findNextDonationWithRemaining({ client, poolId });
    donationPick = donationCandidate?.donationId || null;
    donationRemaining = donationCandidate?.donationRemainingCredits || 0;
  }

  if (!donationPick || donationRemaining <= 0) {
    return { skipped: true, reason: "insufficient_donations", deficit };
  }

  const allocation = Math.min(deficit, donationRemaining);
  if (allocation <= 0) {
    return { skipped: true, reason: "insufficient_donations", deficit };
  }

  if (dryRun) {
    return {
      skipped: false,
      dryRun: true,
      allocation,
      donationId: donationPick,
      newlyFunded: allocation,
      previouslyFunded: funded,
      remainingDeficit: deficit - allocation,
    };
  }

  const poolResult = await updatePoolTx({
    client,
    poolId,
    walletTxId: candidate.wallet_tx_id,
    eventId: candidate.event_id,
    donationId: donationPick,
    fundAmount: allocation,
    walletAmount,
  });

  const receiptResult = await updateReceipt({
    client,
    walletTxId: candidate.wallet_tx_id,
    eventId: candidate.event_id,
    volunteerUserId: candidate.user_id,
    donationId: poolResult.donationId || donationPick,
    fundAmount: allocation,
    minutesVerified: candidate.receipt_minutes || null,
    walletAmount,
  });

  const newFunded = Math.max(poolResult.amountCredits, receiptResult.creditsFunded);
  const newlyFunded = Math.max(0, newFunded - funded);
  const remainingDeficit = Math.max(0, walletAmount - newFunded);

  return {
    skipped: false,
    dryRun: false,
    allocation,
    donationId: receiptResult.donationId || poolResult.donationId || donationPick,
    newlyFunded,
    previouslyFunded: funded,
    remainingDeficit,
    poolUpdated: poolResult.amountCredits !== funded,
    receiptUpdated: receiptResult.creditsFunded !== funded,
  };
}

async function run() {
  const { limit, dryRun } = parseArgs();
  const candidates = await fetchDeficitCandidates(limit);
  const summary = {
    scanned: candidates.length,
    eligible: 0,
    processed: 0,
    updated_pool: 0,
    updated_receipts: 0,
    skipped_no_deficit: 0,
    skipped_locked: 0,
    insufficient_donations: 0,
    dry_run: dryRun,
  };

  const client = await pool.connect();
  try {
    const poolIdBySlug = new Map();
    for (const c of candidates) {
      await client.query("BEGIN");
      try {
        const locked = await tryLock(client, c.wallet_tx_id);
        if (!locked) {
          summary.skipped_locked += 1;
          await client.query("ROLLBACK");
          continue;
        }

        const poolSlug = normalizePoolSlug(c.funding_pool_slug);
        const existingPoolId = Number(c.pool_id);
        const poolId = Number.isFinite(existingPoolId) && existingPoolId > 0
          ? existingPoolId
          : poolIdBySlug.has(poolSlug)
            ? poolIdBySlug.get(poolSlug)
            : await resolvePoolId({ client, poolSlug });
        if (!poolIdBySlug.has(poolSlug)) poolIdBySlug.set(poolSlug, poolId);

        const result = await processCandidate({ client, candidate: c, poolId, dryRun });
        if (result.skipped && result.reason === "no_deficit") {
          summary.skipped_no_deficit += 1;
          await client.query("ROLLBACK");
          continue;
        }
        summary.eligible += 1;

        if (result.skipped && result.reason === "insufficient_donations") {
          summary.insufficient_donations += 1;
          await client.query("ROLLBACK");
        } else {
          if (!dryRun) {
            await client.query("COMMIT");
          } else {
            await client.query("ROLLBACK");
          }
          summary.processed += 1;
          if (!result.dryRun && result.poolUpdated) summary.updated_pool += 1;
          if (!result.dryRun && result.receiptUpdated) summary.updated_receipts += 1;
        }

        const logPayload = {
          event_id: c.event_id,
          user_id: c.user_id,
          wallet_tx_id: c.wallet_tx_id,
          credit_amount: Number(c.wallet_amount) || 0,
          previously_funded: Math.max(Number(c.receipt_funded) || 0, Number(c.pool_funded) || 0),
          newly_funded: result.skipped ? 0 : result.newlyFunded || 0,
          remaining_deficit: result.skipped ? result.deficit || 0 : result.remainingDeficit || 0,
          donation_ids: result.donationId ? [result.donationId] : [],
          dry_run: dryRun,
          status: result.skipped ? result.reason : "ok",
        };
        console.log(JSON.stringify(logPayload));
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(
          "Deficit reconciliation failed",
          JSON.stringify({
            event_id: c.event_id,
            user_id: c.user_id,
            wallet_tx_id: c.wallet_tx_id,
            error: err.message,
          })
        );
      }
    }
  } finally {
    client.release();
  }

  console.log(JSON.stringify({ summary }));
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("reconcilePoolDeficits failed", err);
    process.exit(1);
  });
