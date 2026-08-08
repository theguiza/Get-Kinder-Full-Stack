BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before Gate C-1 gcs-generation-binding migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'object_version_id'
  ) THEN
    RAISE EXCEPTION 'kai.intake_files.object_version_id (Gate A) is required before Gate C-1 gcs-generation-binding migration';
  END IF;
END $$;

-- Gate C-1 scope: this migration adds exactly one new, additive, private
-- storage-binding fact to the existing Gate A upload-lifecycle row -
-- gcs_generation - the provider-private, immutable native GCS generation
-- number bound to the row's already-existing provider-neutral
-- object_version_id. It changes no existing column, constraint, trigger, or
-- lifecycle-transition semantics established by Gate A, and it does not
-- introduce a new relation, a global objectVersionId lookup, or any wider
-- schema concept. numeric(20,0) (not bigint) is used so the exact digit
-- string round-trips through the pg driver without float precision loss,
-- since a native GCS generation can exceed Number.MAX_SAFE_INTEGER.

ALTER TABLE kai.intake_files
  ADD COLUMN IF NOT EXISTS gcs_generation numeric(20,0);

ALTER TABLE kai.intake_files
  DROP CONSTRAINT IF EXISTS intake_files_gate_c1_gcs_generation_positive_check,
  ADD CONSTRAINT intake_files_gate_c1_gcs_generation_positive_check
    CHECK (gcs_generation IS NULL OR gcs_generation > 0),
  -- gcs_generation binds to an already-assigned object_version_id: it can
  -- never be set while the row is still pre-object-version (reserved /
  -- upload_started), matching the point at which Gate A's own
  -- object_version_id first becomes non-NULL.
  DROP CONSTRAINT IF EXISTS intake_files_gate_c1_generation_requires_object_version_check,
  ADD CONSTRAINT intake_files_gate_c1_generation_requires_object_version_check
    CHECK (gcs_generation IS NULL OR object_version_id IS NOT NULL);

-- Additive immutability enforcement for gcs_generation only. This is a
-- separate trigger/function from Gate A's kai.enforce_gate_a_p0_upload_lifecycle
-- so that existing Gate A transition/immutability semantics are not touched.
CREATE OR REPLACE FUNCTION kai.enforce_gate_c1_gcs_generation_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.gcs_generation IS NOT NULL AND OLD.gcs_generation IS DISTINCT FROM NEW.gcs_generation THEN
      RAISE EXCEPTION 'Gate C-1 gcs_generation binding is immutable once set';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gate_c1_gcs_generation_binding ON kai.intake_files;
CREATE TRIGGER trg_gate_c1_gcs_generation_binding
BEFORE UPDATE ON kai.intake_files
FOR EACH ROW
EXECUTE FUNCTION kai.enforce_gate_c1_gcs_generation_binding();

COMMIT;
