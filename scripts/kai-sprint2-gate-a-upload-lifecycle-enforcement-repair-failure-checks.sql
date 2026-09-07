WITH checks AS (
  SELECT 'FUNCTION_PRESENT' AS check_name,
         'kai.enforce_gate_a_p0_upload_lifecycle()' AS object_name,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'kai'
              AND p.proname = 'enforce_gate_a_p0_upload_lifecycle'
              AND pg_get_function_identity_arguments(p.oid) = ''
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'detects absent Gate A enforcement function' AS detail
  UNION ALL
  SELECT 'FUNCTION_RETURNS_TRIGGER', 'kai.enforce_gate_a_p0_upload_lifecycle()',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'kai'
              AND p.proname = 'enforce_gate_a_p0_upload_lifecycle'
              AND pg_get_function_identity_arguments(p.oid) = ''
              AND pg_get_function_result(p.oid) = 'trigger'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'detects wrong return type'
  UNION ALL
  SELECT 'TRIGGER_PRESENT_ON_INTAKE_FILES', 'trg_gate_a_p0_upload_lifecycle',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_trigger
            WHERE tgname = 'trg_gate_a_p0_upload_lifecycle'
              AND tgrelid = 'kai.intake_files'::regclass
              AND NOT tgisinternal
         ) THEN 'PASS' ELSE 'FAIL' END,
         'detects absent trigger or trigger bound to wrong table'
  UNION ALL
  SELECT 'TRIGGER_BOUND_TO_FUNCTION', 'trg_gate_a_p0_upload_lifecycle',
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
         ) THEN 'PASS' ELSE 'FAIL' END,
         'detects trigger bound to wrong function'
  UNION ALL
  SELECT 'TRIGGER_BEFORE_INSERT', 'trg_gate_a_p0_upload_lifecycle',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_trigger
            WHERE tgname = 'trg_gate_a_p0_upload_lifecycle'
              AND tgrelid = 'kai.intake_files'::regclass
              AND NOT tgisinternal
              AND (tgtype & 2) = 2
              AND (tgtype & 4) = 4
         ) THEN 'PASS' ELSE 'FAIL' END,
         'detects missing BEFORE INSERT firing'
  UNION ALL
  SELECT 'TRIGGER_BEFORE_UPDATE', 'trg_gate_a_p0_upload_lifecycle',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_trigger
            WHERE tgname = 'trg_gate_a_p0_upload_lifecycle'
              AND tgrelid = 'kai.intake_files'::regclass
              AND NOT tgisinternal
              AND (tgtype & 2) = 2
              AND (tgtype & 16) = 16
         ) THEN 'PASS' ELSE 'FAIL' END,
         'detects missing BEFORE UPDATE firing'
  UNION ALL
  SELECT 'TRIGGER_ENABLED', 'trg_gate_a_p0_upload_lifecycle',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_trigger
            WHERE tgname = 'trg_gate_a_p0_upload_lifecycle'
              AND tgrelid = 'kai.intake_files'::regclass
              AND NOT tgisinternal
              AND tgenabled = 'O'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'detects disabled trigger'
  UNION ALL
  SELECT 'REQUIRED_FUNCTION_COLUMNS_PRESENT', 'kai.intake_files',
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
         ) THEN 'PASS' ELSE 'FAIL' END,
         'detects required function column absence or incompatible shape'
  UNION ALL
  SELECT 'GATE_C1_TRIGGER_UNCHANGED', 'trg_gate_c1_gcs_generation_binding',
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
         ) THEN 'PASS' ELSE 'FAIL' END,
         'detects absent or unexpectedly changed Gate C-1 trigger'
)
SELECT 'GATE_A_UPLOAD_LIFECYCLE_ENFORCEMENT_REPAIR_FAILURE_CHECKS' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
