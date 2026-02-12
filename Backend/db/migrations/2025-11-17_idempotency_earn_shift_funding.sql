-- Ensure idempotent funding artifacts for earn_shift credits

BEGIN;

-- donor_receipts: one receipt per wallet_tx_id
CREATE UNIQUE INDEX IF NOT EXISTS donor_receipts_wallet_tx_id_uniq
  ON donor_receipts (wallet_tx_id);

-- pool_transactions: only one shift_out debit per wallet_tx_id
CREATE UNIQUE INDEX IF NOT EXISTS pool_transactions_shift_out_wallet_tx_uniq
  ON pool_transactions (wallet_tx_id)
  WHERE reason = 'shift_out' AND direction = 'debit';

COMMIT;
