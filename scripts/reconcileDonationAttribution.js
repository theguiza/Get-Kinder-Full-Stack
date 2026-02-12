// Usage: node scripts/reconcileDonationAttribution.js --limit=200 --dry-run
import pool from "../Backend/db/pg.js";
import { resolvePoolId, findNextDonationWithRemaining } from "../services/donationAttributionService.js";

function parseArgs() {
  const argMap = new Map();
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.split("=");
    if (k && v != null) argMap.set(k.replace(/^--/, ""), v);
    if (k === "--dry-run" || k === "dry-run") argMap.set("dry-run", "true");
  }
  const limitRaw = argMap.get("limit");
  const limit = Number.isInteger(Number(limitRaw)) && Number(limitRaw) > 0 ? Math.min(Number(limitRaw), 1000) : 200;
  const dryRun = argMap.get("dry-run") === "true";
  return { limit, dryRun };
}

async function fetchCandidateReceipts(limit) {
  const { rows } = await pool.query(
    `
      SELECT id, wallet_tx_id
        FROM donor_receipts
       WHERE donation_id IS NULL OR credits_funded = 0
       ORDER BY created_at ASC
       LIMIT $1
    `,
    [limit]
  );
  return rows || [];
}

const advisoryLock = async (client, walletTxId) => {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [walletTxId]);
};

async function processReceipt({ client, receiptId, walletTxId, poolId, dryRun }) {
  await advisoryLock(client, String(walletTxId));

  const { rows: [receipt] = [] } = await client.query(
    `
      SELECT
        dr.id,
        dr.wallet_tx_id,
        dr.donation_id,
        dr.credits_funded,
        dr.minutes_verified,
        dr.event_id,
        dr.volunteer_user_id,
        wt.kind_amount AS wallet_amount
      FROM donor_receipts dr
      JOIN wallet_transactions wt ON wt.id = dr.wallet_tx_id
     WHERE dr.id = $1
     FOR UPDATE
    `,
    [receiptId]
  );

  if (!receipt) {
    return { status: "skipped_missing" };
  }

  if (receipt.donation_id || (Number(receipt.credits_funded) || 0) > 0) {
    return { status: "skipped_existing" };
  }

  const creditAmount = Number(receipt.wallet_amount) || 0;
  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    return { status: "skipped_zero" };
  }

  const donationCandidate = await findNextDonationWithRemaining({ client, poolId, poolSlug: "general" });
  const donationRemaining = donationCandidate?.donationRemainingCredits || 0;
  const amountToAttribute =
    donationCandidate?.donationId && donationRemaining > 0 ? Math.min(creditAmount, donationRemaining) : 0;

  if (amountToAttribute <= 0) {
    return { status: "no_donation_available" };
  }

  if (dryRun) {
    console.log(
      JSON.stringify({
        receipt_id: receipt.id,
        wallet_tx_id: receipt.wallet_tx_id,
        donation_id: donationCandidate.donationId,
        credits_funded: amountToAttribute,
        dry_run: true,
      })
    );
    return {
      status: "would_update",
      receipt_id: receipt.id,
      wallet_tx_id: receipt.wallet_tx_id,
      donation_id: donationCandidate.donationId,
      credits_funded: amountToAttribute,
    };
  }

  await client.query(
    `
      INSERT INTO pool_transactions
        (pool_id, direction, amount_credits, reason, donation_id, event_id, wallet_tx_id)
      VALUES ($1, 'debit', $2, 'shift_out', $3, $4, $5)
      ON CONFLICT (wallet_tx_id) WHERE (reason = 'shift_out' AND direction = 'debit')
      DO UPDATE SET donation_id = EXCLUDED.donation_id, amount_credits = EXCLUDED.amount_credits
        WHERE (pool_transactions.donation_id IS NULL OR pool_transactions.amount_credits = 0)
    `,
    [poolId, amountToAttribute, donationCandidate.donationId, receipt.event_id, receipt.wallet_tx_id]
  );

  const { rowCount: updatedReceipts } = await client.query(
    `
      UPDATE donor_receipts
         SET donation_id = $1,
             credits_funded = $2
       WHERE id = $3
         AND donation_id IS NULL
    `,
    [donationCandidate.donationId, amountToAttribute, receipt.id]
  );

  if (updatedReceipts > 0) {
    console.log(
      JSON.stringify({
        receipt_id: receipt.id,
        wallet_tx_id: receipt.wallet_tx_id,
        donation_id: donationCandidate.donationId,
        credits_funded: amountToAttribute,
      })
    );
  }

  return { status: updatedReceipts > 0 ? "updated" : "skipped_existing" };
}

async function run() {
  const { limit, dryRun } = parseArgs();
  const candidates = await fetchCandidateReceipts(limit);
  const summary = {
    scanned: candidates.length,
    updated: 0,
    skipped: 0,
    no_donation_available: 0,
    dry_run: dryRun,
  };

  const client = await pool.connect();
  try {
    const poolId = await resolvePoolId({ client, poolSlug: "general" });

    for (const candidate of candidates) {
      await client.query("BEGIN");
      try {
        const result = await processReceipt({
          client,
          receiptId: candidate.id,
          poolId,
          walletTxId: candidate.wallet_tx_id,
          dryRun,
        });

        if (!dryRun && result.status === "updated") summary.updated += 1;
        else if (dryRun && result.status === "would_update") summary.updated += 1;
        else if (result.status === "no_donation_available") summary.no_donation_available += 1;
        else if (result.status?.startsWith("skipped")) summary.skipped += 1;

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        summary.skipped += 1;
        console.error("Reconcile attribution error", { receipt_id: candidate.id, error: err.message });
      }
    }
  } finally {
    client.release();
  }

  console.log(
    JSON.stringify({
      summary,
    })
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reconcile donation attribution failed", err);
    process.exit(1);
  });
