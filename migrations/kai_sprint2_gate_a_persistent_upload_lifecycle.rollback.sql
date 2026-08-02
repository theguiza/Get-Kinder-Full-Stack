BEGIN;

DROP TRIGGER IF EXISTS trg_gate_a_intake_file_lifecycle ON kai.intake_files;
DROP FUNCTION IF EXISTS kai.enforce_gate_a_intake_file_lifecycle();

DROP TABLE IF EXISTS kai.security_assessment_enqueue;

DROP INDEX IF EXISTS kai.ix_intake_files_gate_a_object_version;
DROP INDEX IF EXISTS kai.ix_intake_files_gate_a_tenant_upload_state;
DROP INDEX IF EXISTS kai.ux_intake_files_gate_a_org_checksum_default;
DROP INDEX IF EXISTS kai.ux_intake_files_gate_a_tenant_file;

ALTER TABLE IF EXISTS kai.intake_files
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_policy_replay_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_state_fact_consistency_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_hash_algorithm_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_verified_size_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_verified_checksum_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_object_version_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_upload_state_check,
  DROP COLUMN IF EXISTS policy_decision_replay,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS verified_size_bytes,
  DROP COLUMN IF EXISTS verified_checksum,
  DROP COLUMN IF EXISTS object_version_id,
  DROP COLUMN IF EXISTS upload_expires_at,
  DROP COLUMN IF EXISTS upload_state_changed_at,
  DROP COLUMN IF EXISTS upload_state;

COMMIT;
