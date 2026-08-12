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
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS malware_scan_status text NOT NULL DEFAULT 'not_configured',
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'proposed',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
