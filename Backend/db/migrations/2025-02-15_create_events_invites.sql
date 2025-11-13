-- 2025-02-15_create_events_invites.sql
-- Creates core tables for events, invites, and RSVPs plus helper trigger for updated_at.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id   uuid NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
  title             text NOT NULL,
  category          text,
  start_at          timestamptz,
  end_at            timestamptz,
  tz                text NOT NULL DEFAULT 'UTC',
  location_text     text NOT NULL,
  visibility        text NOT NULL DEFAULT 'public'
                    CHECK (visibility IN ('public','fof','private')),
  capacity          integer CHECK (capacity > 0),
  waitlist_enabled  boolean NOT NULL DEFAULT true,
  cover_url         text,
  description       text,
  reward_pool_kind  bigint NOT NULL DEFAULT 0 CHECK (reward_pool_kind >= 0),
  attendance_methods jsonb NOT NULL DEFAULT '[]'::jsonb
                     CHECK (jsonb_typeof(attendance_methods) = 'array'),
  safety_notes      text,
  status            text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','cancelled','completed')),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_events_updated_at
BEFORE UPDATE ON events
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_events_creator_start
  ON events (creator_user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_events_status_start
  ON events (status, start_at);

CREATE TABLE IF NOT EXISTS invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sender_user_id     uuid NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
  recipient_user_id  uuid NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','declined','expired')),
  created_at         timestamptz NOT NULL DEFAULT NOW(),
  responded_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_invites_recipient_created
  ON invites (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_sender_created
  ON invites (sender_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invites_event_recipient
  ON invites (event_id, recipient_user_id);

CREATE TABLE IF NOT EXISTS event_rsvps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  attendee_user_id uuid NOT NULL REFERENCES userdata(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'interested'
                   CHECK (status IN ('interested','accepted','declined','waitlisted','checked_in')),
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_event_rsvps_updated_at
BEFORE UPDATE ON event_rsvps
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_rsvps_attendee
  ON event_rsvps (event_id, attendee_user_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_status
  ON event_rsvps (event_id, status);

COMMIT;

-- Down -----------------------------------------------------------------------

-- To roll back:
-- BEGIN;
--   DROP INDEX IF EXISTS idx_event_rsvps_status;
--   DROP INDEX IF EXISTS uq_event_rsvps_attendee;
--   DROP TRIGGER IF EXISTS trg_event_rsvps_updated_at ON event_rsvps;
--   DROP TABLE IF EXISTS event_rsvps;
--
--   DROP INDEX IF EXISTS uq_invites_event_recipient;
--   DROP INDEX IF EXISTS idx_invites_sender_created;
--   DROP INDEX IF EXISTS idx_invites_recipient_created;
--   DROP TABLE IF EXISTS invites;
--
--   DROP INDEX IF EXISTS idx_events_status_start;
--   DROP INDEX IF EXISTS idx_events_creator_start;
--   DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
--   DROP TABLE IF EXISTS events;
--
--   DROP FUNCTION IF EXISTS set_updated_at();
-- COMMIT;
