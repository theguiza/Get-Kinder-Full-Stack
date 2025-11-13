-- 2025-02-20_event_rsvps_checkins.sql
-- Adds check-in metadata to event_rsvps so we can record how attendees verified attendance.

BEGIN;

ALTER TABLE event_rsvps
  ADD COLUMN IF NOT EXISTS check_in_method text
  CHECK (check_in_method IN ('host_code','social_proof','geo'));

ALTER TABLE event_rsvps
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_event_rsvps_checked_in
  ON event_rsvps (event_id)
  WHERE status = 'checked_in';

COMMIT;

-- Down -------------------------------------------------------------
-- BEGIN;
--   DROP INDEX IF EXISTS idx_event_rsvps_checked_in;
--   ALTER TABLE event_rsvps DROP COLUMN IF EXISTS checked_in_at;
--   ALTER TABLE event_rsvps DROP COLUMN IF EXISTS check_in_method;
-- COMMIT;
