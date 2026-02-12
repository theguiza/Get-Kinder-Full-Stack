-- 2025-03-10_add_volunteering_fields.sql
-- Adds volunteering opportunity metadata, verification tracking, and event-linked rewards fields.

BEGIN;

-- Events: organization + verification metadata
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS org_name text,
  ADD COLUMN IF NOT EXISTS community_tag text,
  ADD COLUMN IF NOT EXISTS cause_tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS requirements text,
  ADD COLUMN IF NOT EXISTS verification_method text DEFAULT 'host_attest',
  ADD COLUMN IF NOT EXISTS impact_credits_base int DEFAULT 25,
  ADD COLUMN IF NOT EXISTS reliability_weight int DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_verification_method_check'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_verification_method_check
      CHECK (verification_method IN ('host_attest','qr_stub','social_proof'));
  END IF;
END $$;

-- Event RSVPs: verification + attendance metadata
ALTER TABLE event_rsvps
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attended_minutes int,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_rsvps_verification_status_check'
  ) THEN
    ALTER TABLE event_rsvps
      ADD CONSTRAINT event_rsvps_verification_status_check
      CHECK (verification_status IN ('pending','verified','rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_rsvps_event_verification
  ON event_rsvps (event_id, verification_status);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_attendee_verification
  ON event_rsvps (attendee_user_id, verification_status);

-- Wallet transactions: ensure linkage + unique constraint if structure present
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS event_id uuid;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_event_id
  ON wallet_transactions (event_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_transactions_user_reason_event_key'
  ) AND EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_name = 'wallet_transactions'
       AND column_name IN ('user_id','reason','event_id')
     GROUP BY table_name
    HAVING COUNT(*) = 3
  ) THEN
    ALTER TABLE wallet_transactions
      ADD CONSTRAINT wallet_transactions_user_reason_event_key
      UNIQUE (user_id, reason, event_id);
  END IF;
END $$;

COMMIT;
