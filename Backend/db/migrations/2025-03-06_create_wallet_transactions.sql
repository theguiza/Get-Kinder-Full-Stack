-- 2025-03-06_create_wallet_transactions.sql
-- Minimal ledger table for $KIND wallet summary calculations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     integer NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
  kind_amount bigint NOT NULL CHECK (kind_amount >= 0),
  direction   text NOT NULL CHECK (direction IN ('credit','debit')),
  reason      text NOT NULL CHECK (reason IN ('earn','donate','adjustment')),
  event_id    uuid NULL REFERENCES events(id) ON DELETE SET NULL,
  charity_id  uuid NULL,
  note        text NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created
  ON wallet_transactions (user_id, created_at DESC);

COMMIT;

-- Down -----------------------------------------------------------------------
-- BEGIN;
--   DROP INDEX IF EXISTS idx_wallet_transactions_user_created;
--   DROP TABLE IF EXISTS wallet_transactions;
-- COMMIT;
