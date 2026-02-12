-- 2025-03-05_create_carousel_items.sql
-- Creates carousel_items table for Kinder Crew Feed content.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Reuse existing updated_at trigger function if present; create if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'set_updated_at' AND n.nspname = 'public'
  ) THEN
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $func$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS carousel_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_key    text UNIQUE,
  type        text NOT NULL CHECK (type IN ('social_post','opportunity','skill')),
  caption     text,
  title       text,
  media_url   text,
  link_url    text,
  author_name text,
  city        text,
  crew_label  text,
  priority    integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carousel_items_status_priority
  ON carousel_items (status, priority DESC, created_at DESC);

CREATE TRIGGER trg_carousel_items_updated_at
BEFORE UPDATE ON carousel_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
