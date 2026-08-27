-- Regression-only schema extension for the confirm-upload metadata-boundary
-- test. kai.intake_files in production carries the pass2 admin-metadata
-- reservation columns written by Backend/kai/db/kaiIntakeQueries.js
-- (insertIntakeFileMetadata) and read by Backend/kai/db/kaiReadModels.js
-- (getIntakeFileUploadMetadata), but no migration committed to this repo
-- creates them - only the Gate A upload-lifecycle columns are tracked. This
-- file adds exactly the missing columns that getIntakeFileUploadMetadata
-- selects, so the regression can seed and read a realistic row. It is not a
-- product migration and is not applied outside this test's ephemeral
-- database.
BEGIN;

ALTER TABLE kai.intake_files
  ADD COLUMN IF NOT EXISTS engagement_id uuid,
  ADD COLUMN IF NOT EXISTS storage_provider text,
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_object_key text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS file_extension text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS malware_scan_status text NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'proposed',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- kai.audit_events / kai.object_type_enum are externally managed in
-- production (no CREATE TABLE for them exists elsewhere in this repository -
-- see Backend/kai/db/kaiAuditQueries.js), mirroring the same minimal
-- synthetic mirror already used by
-- scripts/kai-sprint2-p2-access-administration-bootstrap-synthetic-schema.sql
-- (USER_CONFIRMED shape: object_type_enum labels
-- organization/user/role/audit_event/other; action is non-null text;
-- metadata is jsonb with a safe default). Required here so
-- Backend/kai/db/kaiIntakeQueries.js#casSecurityAssessmentFilePolicyDecision
-- and Backend/kai/db/kaiReadModels.js#getScopedLatestSecurityAssessmentAuditProjection
-- can be exercised against a real audit_events table.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'kai' AND t.typname = 'object_type_enum'
  ) THEN
    CREATE TYPE kai.object_type_enum AS ENUM ('organization', 'user', 'role', 'audit_event', 'other');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.audit_events (
  audit_event_id  bigserial PRIMARY KEY,
  organization_id uuid,
  actor_user_id   uuid,
  actor_type      text NOT NULL,
  action          text NOT NULL CHECK (length(trim(action)) > 0),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type     kai.object_type_enum NOT NULL,
  reason_code     text,
  reason_text     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMIT;
