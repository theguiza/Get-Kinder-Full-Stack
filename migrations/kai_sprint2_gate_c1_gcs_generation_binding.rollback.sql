BEGIN;

DROP TRIGGER IF EXISTS trg_gate_c1_gcs_generation_binding ON kai.intake_files;
DROP FUNCTION IF EXISTS kai.enforce_gate_c1_gcs_generation_binding();

ALTER TABLE kai.intake_files
  DROP CONSTRAINT IF EXISTS intake_files_gate_c1_generation_requires_object_version_check,
  DROP CONSTRAINT IF EXISTS intake_files_gate_c1_gcs_generation_positive_check;

ALTER TABLE kai.intake_files
  DROP COLUMN IF EXISTS gcs_generation;

COMMIT;
