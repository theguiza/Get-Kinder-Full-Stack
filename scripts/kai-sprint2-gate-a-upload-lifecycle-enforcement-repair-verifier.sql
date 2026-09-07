DROP TABLE IF EXISTS gate_a_enforcement_repair_results;
CREATE TEMP TABLE gate_a_enforcement_repair_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO gate_a_enforcement_repair_results
SELECT 'function_exists',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'kai'
                 AND p.proname = 'enforce_gate_a_p0_upload_lifecycle'
                 AND pg_get_function_identity_arguments(p.oid) = ''
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.enforce_gate_a_p0_upload_lifecycle() exists';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'function_returns_trigger',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'kai'
                 AND p.proname = 'enforce_gate_a_p0_upload_lifecycle'
                 AND pg_get_function_identity_arguments(p.oid) = ''
                 AND pg_get_function_result(p.oid) = 'trigger'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'function return type is trigger';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'trigger_exists_on_intake_files',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_trigger t
               WHERE t.tgname = 'trg_gate_a_p0_upload_lifecycle'
                 AND t.tgrelid = 'kai.intake_files'::regclass
                 AND NOT t.tgisinternal
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'user trigger exists on kai.intake_files';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'trigger_enabled',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_trigger t
               WHERE t.tgname = 'trg_gate_a_p0_upload_lifecycle'
                 AND t.tgrelid = 'kai.intake_files'::regclass
                 AND NOT t.tgisinternal
                 AND t.tgenabled = 'O'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'trigger is enabled normally';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'trigger_fires_before_insert',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_trigger t
               WHERE t.tgname = 'trg_gate_a_p0_upload_lifecycle'
                 AND t.tgrelid = 'kai.intake_files'::regclass
                 AND NOT t.tgisinternal
                 AND (t.tgtype & 2) = 2
                 AND (t.tgtype & 4) = 4
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'trigger fires BEFORE INSERT';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'trigger_fires_before_update',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_trigger t
               WHERE t.tgname = 'trg_gate_a_p0_upload_lifecycle'
                 AND t.tgrelid = 'kai.intake_files'::regclass
                 AND NOT t.tgisinternal
                 AND (t.tgtype & 2) = 2
                 AND (t.tgtype & 16) = 16
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'trigger fires BEFORE UPDATE';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'trigger_invokes_function',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_trigger t
                JOIN pg_proc p ON p.oid = t.tgfoid
                JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE t.tgname = 'trg_gate_a_p0_upload_lifecycle'
                 AND t.tgrelid = 'kai.intake_files'::regclass
                 AND NOT t.tgisinternal
                 AND n.nspname = 'kai'
                 AND p.proname = 'enforce_gate_a_p0_upload_lifecycle'
                 AND pg_get_function_identity_arguments(p.oid) = ''
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'trigger invokes kai.enforce_gate_a_p0_upload_lifecycle()';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'gate_c1_trigger_preserved',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_trigger t
                JOIN pg_proc p ON p.oid = t.tgfoid
                JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE t.tgname = 'trg_gate_c1_gcs_generation_binding'
                 AND t.tgrelid = 'kai.intake_files'::regclass
                 AND NOT t.tgisinternal
                 AND t.tgenabled = 'O'
                 AND (t.tgtype & 2) = 2
                 AND (t.tgtype & 16) = 16
                 AND n.nspname = 'kai'
                 AND p.proname = 'enforce_gate_c1_gcs_generation_binding'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'Gate C-1 gcs-generation trigger remains present and enabled';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'gate_a_required_columns_present',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM (VALUES
                  ('organization_id', 'uuid', 'uuid'),
                  ('intake_file_id', 'uuid', 'uuid'),
                  ('intake_batch_id', 'uuid', 'uuid'),
                  ('checksum', 'text', 'text'),
                  ('hash_algorithm', 'text', 'text'),
                  ('created_at', 'timestamp with time zone', 'timestamptz'),
                  ('upload_state', 'text', 'text'),
                  ('upload_state_changed_at', 'timestamp with time zone', 'timestamptz'),
                  ('upload_expires_at', 'timestamp with time zone', 'timestamptz'),
                  ('object_version_id', 'text', 'text'),
                  ('verified_checksum', 'text', 'text'),
                  ('verified_size_bytes', 'bigint', 'int8'),
                  ('verified_at', 'timestamp with time zone', 'timestamptz')
                ) AS required_columns(column_name, data_type, udt_name)
               WHERE NOT EXISTS (
                     SELECT 1
                       FROM information_schema.columns c
                      WHERE c.table_schema = 'kai'
                        AND c.table_name = 'intake_files'
                        AND c.column_name = required_columns.column_name
                        AND c.data_type = required_columns.data_type
                        AND c.udt_name = required_columns.udt_name
                   )
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'required function-referenced kai.intake_files columns remain present';

INSERT INTO gate_a_enforcement_repair_results
SELECT 'gate_a_constraints_and_indexes_present',
       CASE WHEN to_regclass('kai.ux_intake_files_gate_a_tenant_file') IS NOT NULL
              AND to_regclass('kai.ux_intake_files_gate_a_org_declared_checksum') IS NOT NULL
              AND to_regclass('kai.ix_intake_files_gate_a_tenant_upload_state') IS NOT NULL
              AND to_regclass('kai.ix_intake_files_gate_a_object_version') IS NOT NULL
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'intake_files_gate_a_upload_state_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'intake_files_gate_a_state_fact_consistency_check')
            THEN 'PASS' ELSE 'FAIL' END,
       'surrounding Gate A columns, constraints, and indexes needed by the existing verifier remain present';

SELECT 'GATE_A_UPLOAD_LIFECYCLE_ENFORCEMENT_REPAIR' AS result_type, check_name, status, detail
FROM gate_a_enforcement_repair_results
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gate_a_enforcement_repair_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Gate A upload-lifecycle enforcement repair verifier failed';
  END IF;
END $$;
