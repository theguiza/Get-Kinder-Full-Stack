WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name,
         'kai.intake_parser_runs' AS object_name,
         CASE WHEN to_regclass('kai.intake_parser_runs') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P1-02 parser-run lifecycle table' AS detail
  UNION ALL
  SELECT 'TABLE_EXISTS', 'kai.intake_file_profiles',
         CASE WHEN to_regclass('kai.intake_file_profiles') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'P1-02 metadata/redacted-only profile table'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_parser_runs.run_state',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs' AND column_name = 'run_state'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'parser-run lifecycle state'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_file_profiles.profile_canonical_sha256',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_file_profiles' AND column_name = 'profile_canonical_sha256'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'deterministic profile comparison'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_parser_runs_p1_identity_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_parser_runs'
              AND c.conname = 'intake_parser_runs_p1_identity_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'accepted intake_file_id + parser_name + parser_version + checksum identity'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_file_profiles_p1_identity_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_file_profiles'
              AND c.conname = 'intake_file_profiles_p1_identity_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'accepted intake_file_id + parser_name + parser_version + checksum identity'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_parser_runs_p1_state_fact_consistency_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_parser_runs'
              AND c.conname = 'intake_parser_runs_p1_state_fact_consistency_check'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'run_state and completed_at/failure_reason consistency'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_file_profiles_p1_profile_metadata_only_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_file_profiles'
              AND c.conname = 'intake_file_profiles_p1_profile_metadata_only_check'
              AND pg_get_constraintdef(c.oid) LIKE '%gate_a_p0_jsonb_metadata_only%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'redacted-only profile guard reuses existing metadata-only function'
  UNION ALL
  SELECT 'FK_EXISTS', 'intake_parser_runs_p1_file_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_parser_runs'
              AND c.conname = 'intake_parser_runs_p1_file_fk'
              AND c.contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'tenant-scoped parent intake file reference'
  UNION ALL
  SELECT 'FK_EXISTS', 'intake_file_profiles_p1_parser_run_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_file_profiles'
              AND c.conname = 'intake_file_profiles_p1_parser_run_fk'
              AND c.contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'profile bound to the parser run that produced it'
  UNION ALL
  SELECT 'INDEX_EXISTS', 'ix_intake_parser_runs_p1_tenant_file',
         CASE WHEN to_regclass('kai.ix_intake_parser_runs_p1_tenant_file') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'tenant-scoped lookup index'
  UNION ALL
  SELECT 'INDEX_EXISTS', 'ix_intake_file_profiles_p1_tenant_file',
         CASE WHEN to_regclass('kai.ix_intake_file_profiles_p1_tenant_file') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'tenant-scoped lookup index'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'parser_run_recorded',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%parser_run_recorded%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts parser-run lifecycle operation'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'file_profile_persisted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%file_profile_persisted%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts file-profile persistence operation'
)
SELECT 'P1_02_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
