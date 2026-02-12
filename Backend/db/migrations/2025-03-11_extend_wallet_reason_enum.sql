-- 2025-03-11_extend_wallet_reason_enum.sql
-- Extend wallet_transactions.reason CHECK constraint to include earn_shift.

BEGIN;

ALTER TABLE wallet_transactions
  DROP CONSTRAINT IF EXISTS wallet_transactions_reason_check;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_reason_check
  CHECK (reason IN ('earn','donate','adjustment','earn_shift'));

COMMIT;
