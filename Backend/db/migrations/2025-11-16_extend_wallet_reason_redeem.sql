-- 2025-11-16_extend_wallet_reason_redeem.sql
-- Allow wallet_transactions.reason to include redeem for redemptions.

BEGIN;

ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_reason_check;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_reason_check
  CHECK (reason IN ('earn','donate','adjustment','earn_shift','redeem'));

COMMIT;
