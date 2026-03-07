ALTER TABLE pool_transactions
  ADD COLUMN IF NOT EXISTS notes TEXT;
