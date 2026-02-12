-- 2025-03-07_create_event_ratings.sql
-- Event-scoped ratings for hosts/volunteers.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS event_ratings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  rater_user_id integer NOT NULL,
  ratee_user_id integer NOT NULL,
  rater_role    text NOT NULL CHECK (rater_role IN ('volunteer','host')),
  ratee_role    text NOT NULL CHECK (ratee_role IN ('volunteer','host')),
  stars         smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags          text[] NULL,
  note          text NULL,
  revealed_at   timestamptz NULL,
  created_at    timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_ratings_pair
  ON event_ratings (event_id, rater_user_id, ratee_user_id, rater_role);

CREATE INDEX IF NOT EXISTS idx_event_ratings_ratee_created
  ON event_ratings (ratee_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_ratings_event
  ON event_ratings (event_id);

COMMIT;

-- Down -----------------------------------------------------------------------
-- BEGIN;
--   DROP INDEX IF EXISTS idx_event_ratings_event;
--   DROP INDEX IF EXISTS idx_event_ratings_ratee_created;
--   DROP INDEX IF EXISTS uq_event_ratings_pair;
--   DROP TABLE IF EXISTS event_ratings;
-- COMMIT;
