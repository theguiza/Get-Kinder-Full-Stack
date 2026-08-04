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
  SELECT 'COLUMN_EXISTS', 'kai.intake_parser_runs.parser_status',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs' AND column_name = 'parser_status'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'parser-run lifecycle status'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_parser_runs.retry_count',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs' AND column_name = 'retry_count'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'contract-bounded retry counter'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_parser_runs.error_code',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs' AND column_name = 'error_code'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'safe parser error code'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_parser_runs.error_message_safe',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs' AND column_name = 'error_message_safe'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'safe parser error message'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_parser_runs.output_profile_id',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs' AND column_name = 'output_profile_id'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'back-reference to the profile produced by a completed run'
  UNION ALL
  SELECT 'COLUMN_ABSENT', 'kai.intake_parser_runs.run_state',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs' AND column_name = 'run_state'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'invented lifecycle column removed'
  UNION ALL
  SELECT 'COLUMN_ABSENT', 'kai.intake_parser_runs.failure_reason',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_parser_runs' AND column_name = 'failure_reason'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'invented lifecycle column removed'
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
  SELECT 'CONSTRAINT_EXISTS', 'intake_parser_runs_p1_run_identity_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_parser_runs'
              AND c.conname = 'intake_parser_runs_p1_run_identity_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'parser_run_id + tenant/file/parser/version/checksum parent key for composite lineage FKs'
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
  SELECT 'CONSTRAINT_EXISTS', 'intake_file_profiles_p1_run_identity_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_file_profiles'
              AND c.conname = 'intake_file_profiles_p1_run_identity_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'file_profile_id + tenant/file/parser/version/checksum parent key for output-profile back-reference FK'
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
         'parser_status and started_at/completed_at/output_profile_id/error fact consistency'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_parser_runs_p1_retry_count_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_parser_runs'
              AND c.conname = 'intake_parser_runs_p1_retry_count_check'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'retry_count bounded 0 through 3'
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
              AND array_length(c.conkey, 1) = 6
         ) THEN 'PASS' ELSE 'FAIL' END,
         'profile bound by composite lineage to the exact parser run that produced it'
  UNION ALL
  SELECT 'FK_EXISTS', 'intake_parser_runs_p1_output_profile_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_parser_runs'
              AND c.conname = 'intake_parser_runs_p1_output_profile_fk'
              AND c.contype = 'f'
              AND array_length(c.conkey, 1) = 6
         ) THEN 'PASS' ELSE 'FAIL' END,
         'output_profile_id bound by composite lineage to the profile of the same run identity'
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
