BEGIN;

DROP TRIGGER IF EXISTS trg_gate_a_p0_upload_lifecycle ON kai.intake_files;
DROP FUNCTION IF EXISTS kai.enforce_gate_a_p0_upload_lifecycle();

DROP INDEX IF EXISTS kai.ix_upload_lifecycle_audit_gate_a_tenant_file;
DROP TABLE IF EXISTS kai.upload_lifecycle_audit;

DROP INDEX IF EXISTS kai.ix_intake_files_gate_a_object_version;
DROP INDEX IF EXISTS kai.ix_intake_files_gate_a_tenant_upload_state;
DROP INDEX IF EXISTS kai.ux_intake_files_gate_a_org_declared_checksum;
DROP INDEX IF EXISTS kai.ux_intake_files_gate_a_tenant_file;

ALTER TABLE IF EXISTS kai.intake_files
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_state_fact_consistency_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_verified_size_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_verified_checksum_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_object_version_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_hash_algorithm_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_declared_checksum_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_upload_state_check,
  ALTER COLUMN upload_expires_at DROP DEFAULT,
  ALTER COLUMN upload_state_changed_at DROP DEFAULT,
  ALTER COLUMN upload_state DROP DEFAULT,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS verified_size_bytes,
  DROP COLUMN IF EXISTS verified_checksum,
  DROP COLUMN IF EXISTS object_version_id,
  DROP COLUMN IF EXISTS upload_expires_at,
  DROP COLUMN IF EXISTS upload_state_changed_at,
  DROP COLUMN IF EXISTS upload_state;

COMMIT;
