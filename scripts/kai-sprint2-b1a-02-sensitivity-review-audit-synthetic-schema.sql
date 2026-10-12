-- Minimal synthetic mirror of the existing required-audit target used by
-- scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'kai'
       AND t.typname = 'object_type_enum'
  ) THEN
    CREATE TYPE kai.object_type_enum AS ENUM ('other');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.audit_events (
  audit_event_id bigserial PRIMARY KEY,
  organization_id uuid,
  actor_user_id uuid,
  actor_type text NOT NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type kai.object_type_enum NOT NULL,
  reason_code text,
  reason_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
