BEGIN;

-- Test-only synthetic mirror of the externally-owned kai.audit_events /
-- kai.object_type_enum required-audit target, applied only by this
-- package's own local-postgres runner - never by any product migration.
-- Byte-for-byte the same minimal shape already established by
-- scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql
-- (the existing precedent for proving a real kai.audit_events insert against
-- a real, ephemeral, runner-owned PostgreSQL instance rather than a test
-- double). Only the columns Backend/kai/db/kaiAuditQueries.js's
-- REQUIRED_AUDIT_INSERT_COLUMNS actually reads/writes are declared, and the
-- enum declares only the single 'other' fallback label - it does NOT
-- declare an 'export_manifest' label, because that would fabricate an
-- assumption about the real production kai.object_type_enum's actual
-- membership (unknown, externally owned, and out of scope to assert here).
-- This lets the real-persisted P3-19 proof exercise the resolver's genuine,
-- documented fallback path (request 'export_manifest', not present, falls
-- back to 'other') with a real INSERT - not a test double.
CREATE SCHEMA IF NOT EXISTS kai;

CREATE TYPE kai.object_type_enum AS ENUM ('other');

CREATE TABLE kai.audit_events (
  audit_event_id    bigserial PRIMARY KEY,
  organization_id   uuid,
  actor_user_id     uuid,
  actor_type        text NOT NULL,
  action            text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type       kai.object_type_enum NOT NULL,
  reason_code       text,
  reason_text       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMIT;
