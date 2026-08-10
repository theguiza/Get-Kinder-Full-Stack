WITH checks AS (
  SELECT 'NO_P1_TABLES' AS check_name,
         'kai schema' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'kai'
              AND table_name IN (
                'parser_runs',
                'profiles',
                'data_dictionaries',
                'quality_records',
                'sensitivity_records',
                'review_workflow',
                'source_candidates',
                'promotion_decisions',
                'sources',
                'source_versions'
              )
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'P1 durable tables are absent' AS detail
  UNION ALL
  SELECT 'SAFE_TRIGGER_ERRORS', 'kai.enforce_gate_a_p0_upload_lifecycle',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'kai'
              AND p.proname = 'enforce_gate_a_p0_upload_lifecycle'
              AND pg_get_functiondef(p.oid) ~ '(checksum [a-f0-9]{64}|object_version_id =|verified_checksum =)'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'function definition does not embed raw object facts in raised messages'
  UNION ALL
  SELECT 'NO_SOURCE_COLUMNS', 'kai.intake_files',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_files'
              AND column_name IN ('source', 'source_version')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'source and source_version are out of scope'
)
SELECT 'GATE_A_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
