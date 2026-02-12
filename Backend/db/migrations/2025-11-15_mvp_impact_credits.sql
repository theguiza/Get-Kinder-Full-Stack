-- 2025-11-15_mvp_impact_credits.sql
-- MVP schema for Impact Credits: wallet hardening, redemptions, donor receipts.

BEGIN;

-- WALLET: ensure event linkage and idempotent earn_shift uniqueness
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS event_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'events'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_event_id_fkey'
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT wallet_transactions_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wallet_transactions'
  ) AND NOT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'wallet_transactions'
       AND indexdef ILIKE '%reason = ''earn_shift'' AND direction = ''credit''%'
  ) THEN
    CREATE UNIQUE INDEX wallet_transactions_earn_shift_unique_idx
      ON wallet_transactions (user_id, event_id)
      WHERE reason = 'earn_shift' AND direction = 'credit';
  END IF;
END $$;

-- REDEMPTION TABLES ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS redemption_offers (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  title        text NOT NULL,
  description  text NULL,
  cost_credits int NOT NULL CHECK (cost_credits > 0),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS redemptions (
  id           bigserial PRIMARY KEY,
  user_id      int NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  offer_id     bigint NOT NULL REFERENCES redemption_offers(id) ON DELETE RESTRICT,
  cost_credits int NOT NULL CHECK (cost_credits > 0),
  status       text NOT NULL DEFAULT 'requested'
               CHECK (status IN ('requested','fulfilled','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

-- DONOR RECEIPTS TABLES ------------------------------------------------------
CREATE TABLE IF NOT EXISTS donations (
  id                bigserial PRIMARY KEY,
  donor_user_id     int NULL REFERENCES public.userdata(id) ON DELETE SET NULL,
  square_payment_id text NULL UNIQUE,
  amount_cents      int NOT NULL CHECK (amount_cents >= 0),
  currency          text NOT NULL DEFAULT 'CAD',
  status            text NOT NULL DEFAULT 'captured',
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funding_pools (
  id         bigserial PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pool_transactions (
  id             bigserial PRIMARY KEY,
  pool_id        bigint NOT NULL REFERENCES funding_pools(id) ON DELETE CASCADE,
  direction      text NOT NULL CHECK (direction IN ('credit','debit')),
  amount_credits int NOT NULL CHECK (amount_credits >= 0),
  reason         text NOT NULL CHECK (reason IN ('donation_in','shift_out','manual_adjust')),
  donation_id    bigint NULL REFERENCES donations(id) ON DELETE SET NULL,
  event_id       uuid NULL REFERENCES events(id) ON DELETE SET NULL,
  wallet_tx_id   uuid NULL REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS donor_receipts (
  id                bigserial PRIMARY KEY,
  donation_id       bigint NULL REFERENCES donations(id) ON DELETE SET NULL,
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  volunteer_user_id int NOT NULL REFERENCES public.userdata(id) ON DELETE CASCADE,
  wallet_tx_id      uuid NOT NULL REFERENCES wallet_transactions(id) ON DELETE CASCADE,
  credits_funded    int NOT NULL CHECK (credits_funded >= 0),
  minutes_verified  int NULL CHECK (minutes_verified >= 0),
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

-- SEED DATA ------------------------------------------------------------------
INSERT INTO funding_pools (slug, name)
VALUES ('general', 'General Pool')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO redemption_offers (slug, title, cost_credits)
VALUES
  ('coffee', 'Coffee voucher', 25),
  ('transit', 'Transit credit', 50),
  ('meal', 'Meal voucher', 100)
ON CONFLICT (slug) DO NOTHING;

COMMIT;

-- Acceptance checks ----------------------------------------------------------
-- 1) SELECT column_name FROM information_schema.columns WHERE table_name = 'wallet_transactions' AND column_name = 'event_id';
-- 2) SELECT indexdef FROM pg_indexes WHERE tablename = 'wallet_transactions' AND indexdef ILIKE '%reason = ''earn_shift''%' AND indexdef ILIKE '%direction = ''credit''%';
-- 3) SELECT tablename FROM pg_tables WHERE tablename IN ('redemption_offers','redemptions');
-- 4) SELECT tablename FROM pg_tables WHERE tablename IN ('donations','funding_pools','pool_transactions','donor_receipts');
-- 5) SELECT * FROM funding_pools WHERE slug = 'general';
-- 6) SELECT slug, title, cost_credits FROM redemption_offers WHERE slug IN ('coffee','transit','meal');
