// Usage: node scripts/reconcileEarnShiftCredits.js --limit=200
import pool from "../Backend/db/pg.js";
import { processVerifiedEarnShift } from "../services/earnShiftFundingService.js";

function parseArgs() {
  const argMap = new Map();
  for (const arg of process.argv.slice(2)) {
    const [k, v] = arg.split("=");
    if (k && v) argMap.set(k.replace(/^--/, ""), v);
  }
  const limitRaw = argMap.get("limit");
  const limit = Number.isInteger(Number(limitRaw)) && Number(limitRaw) > 0 ? Number(limitRaw) : 200;
  return { limit };
}

async function fetchCandidates(limit) {
  const { rows } = await pool.query(
    `
      SELECT
        r.event_id,
        r.attendee_user_id
      FROM event_rsvps r
     WHERE r.verification_status = 'verified'
     ORDER BY r.verified_at NULLS LAST, r.created_at ASC
     LIMIT $1
    `,
    [limit]
  );
  return rows || [];
}

async function run() {
  const { limit } = parseArgs();
  const candidates = await fetchCandidates(limit);
  const summary = {
    scanned: candidates.length,
    processed: 0,
    walletInserted: 0,
    insertedPoolDebits: 0,
    insertedReceipts: 0,
    skipped: 0,
    poolDeficit: 0,
    alreadyFunded: 0,
  };

  const client = await pool.connect();
  try {
    for (const row of candidates) {
      await client.query("BEGIN");
      try {
        const result = await processVerifiedEarnShift({
          client,
          attendeeUserId: row.attendee_user_id,
          eventId: row.event_id,
        });
        if (result.skipped) {
          summary.skipped += 1;
          await client.query("ROLLBACK");
          continue;
        }
        await client.query("COMMIT");
        summary.processed += 1;
        if (result.inserted) summary.walletInserted += 1;
        if (result.alreadyFunded) summary.alreadyFunded += 1;
        if (!result.alreadyFunded) {
          if (result.funded > 0) summary.insertedPoolDebits += 1;
          summary.insertedReceipts += 1;
        }
        summary.poolDeficit += result.deficit || 0;
        console.log(
          JSON.stringify({
            event_id: row.event_id,
            user_id: row.attendee_user_id,
            credit_amount: result.amount,
            wallet_tx_id: result.walletTxId,
            funded_credits: result.funded,
            deficit: result.deficit || 0,
            already_funded: result.alreadyFunded || false,
          })
        );
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(
          "Error processing candidate",
          {
            event_id: row.event_id,
            user_id: row.attendee_user_id,
            wallet_tx_id: err?.context?.wallet_tx_id || null,
            stage: err?.stage || null,
            error: err.message,
          }
        );
      }
    }
  } finally {
    client.release();
  }

  console.log(
    JSON.stringify({
      summary: {
        scanned: summary.scanned,
        processed: summary.processed,
        wallet_inserted: summary.walletInserted,
        inserted_pool_debits: summary.insertedPoolDebits,
        inserted_receipts: summary.insertedReceipts,
        already_funded: summary.alreadyFunded,
        skipped: summary.skipped,
        pool_deficit_total: summary.poolDeficit,
      },
    })
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reconciliation failed", err);
    process.exit(1);
  });
