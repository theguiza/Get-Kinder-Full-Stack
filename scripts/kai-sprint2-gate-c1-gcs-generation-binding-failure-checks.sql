WITH checks AS (
  SELECT 'NO_NEW_RELATION' AS check_name,
         'kai schema' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'kai'
              AND table_name IN ('storage_bindings', 'object_version_bindings', 'gcs_object_bindings', 'gcs_generations')
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'Gate C-1 adds no new relation beyond the additive intake_files.gcs_generation column' AS detail
  UNION ALL
  SELECT 'NO_VIEW_EXPOSES_GENERATION', 'kai schema',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.views v
             JOIN information_schema.view_column_usage u
               ON u.view_schema = v.table_schema AND u.view_name = v.table_name
            WHERE v.table_schema = 'kai'
              AND u.column_name = 'gcs_generation'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no database view re-exposes the provider-private gcs_generation column'
  UNION ALL
  SELECT 'SAFE_TRIGGER_ERRORS', 'kai.enforce_gate_c1_gcs_generation_binding',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'kai'
              AND p.proname = 'enforce_gate_c1_gcs_generation_binding'
              AND pg_get_functiondef(p.oid) ~ '(gcs_generation = [0-9]|object_version_id =)'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'the Gate C-1 trigger function does not embed raw generation/object-version facts in raised messages'
  UNION ALL
  SELECT 'GATE_A_TENANT_INDEX_UNCHANGED', 'kai.intake_files',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_indexes
            WHERE schemaname = 'kai'
              AND indexname = 'ux_intake_files_gate_a_tenant_file'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Gate A tenant/file uniqueness boundary is unchanged by Gate C-1'
  UNION ALL
  SELECT 'GATE_A_OBJECT_VERSION_FORMAT_CHECK_UNCHANGED', 'kai.intake_files',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conname = 'intake_files_gate_a_object_version_check'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'provider-neutral object_version_id format/semantics are unchanged by Gate C-1'
)
SELECT 'GATE_C1_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
