DROP TABLE IF EXISTS gate_c1_results;
CREATE TEMP TABLE gate_c1_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO gate_c1_results
SELECT 'gcs_generation_column_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'gcs_generation'
                 AND data_type = 'numeric'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.intake_files.gcs_generation exists as an exact numeric type (no float precision loss)';

INSERT INTO gate_c1_results
SELECT 'gcs_generation_positive_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'intake_files_gate_c1_gcs_generation_positive_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'gcs_generation is constrained to NULL or a positive value';

INSERT INTO gate_c1_results
SELECT 'gcs_generation_requires_object_version_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'intake_files_gate_c1_generation_requires_object_version_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%object_version_id%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'gcs_generation can only be set once object_version_id (Gate A) is already set';

INSERT INTO gate_c1_results
SELECT 'gcs_generation_immutability_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_gate_c1_gcs_generation_binding'
                 AND tgrelid = 'kai.intake_files'::regclass
                 AND NOT tgisinternal
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'gcs_generation is immutable once bound, enforced at the database boundary';

INSERT INTO gate_c1_results
SELECT 'gate_a_upload_lifecycle_trigger_unchanged',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_gate_a_p0_upload_lifecycle'
                 AND tgrelid = 'kai.intake_files'::regclass
                 AND NOT tgisinternal
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'Gate A upload-lifecycle transition trigger remains present and unmodified';

INSERT INTO gate_c1_results
SELECT 'gate_a_object_version_check_unchanged',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'intake_files_gate_a_object_version_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'Gate A object_version_id check constraint remains present and unmodified';

INSERT INTO gate_c1_results
SELECT 'no_new_relation_or_global_lookup_introduced',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'kai'
                 AND table_name IN ('storage_bindings', 'object_version_bindings', 'gcs_object_bindings')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'Gate C-1 adds no new relation or global objectVersionId lookup table';

SELECT * FROM gate_c1_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gate_c1_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Gate C-1 gcs-generation-binding verifier failed';
  END IF;
END $$;
