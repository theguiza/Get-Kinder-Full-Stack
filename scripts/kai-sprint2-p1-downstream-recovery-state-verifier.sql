-- Catalog verifier for migrations/kai_sprint2_p1_downstream_recovery_state.sql.
-- Read-only. Every row must report PASS.
WITH target AS (
  SELECT c.oid AS relid
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'kai' AND c.relname = 'intake_p1_downstream_attempts'
),
constraint_defs AS (
  SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS def, array_length(c.conkey, 1) AS key_count
    FROM pg_constraint c
    JOIN target t ON t.relid = c.conrelid
),
expected_columns(column_name, data_type, is_nullable) AS (
  VALUES
    ('organization_id', 'uuid', 'NO'),
    ('intake_file_id', 'uuid', 'NO'),
    ('file_profile_id', 'uuid', 'NO'),
    ('parser_name', 'text', 'NO'),
    ('parser_version', 'text', 'NO'),
    ('checksum', 'text', 'NO'),
    ('stage', 'text', 'NO'),
    ('recovery_state', 'text', 'NO'),
    ('attempt_count', 'integer', 'NO'),
    ('claim_token', 'uuid', 'YES'),
    ('claim_expires_at', 'timestamp with time zone', 'YES'),
    ('last_attempt_at', 'timestamp with time zone', 'YES'),
    ('next_eligible_at', 'timestamp with time zone', 'YES'),
    ('last_error_code', 'text', 'YES'),
    ('created_at', 'timestamp with time zone', 'NO'),
    ('updated_at', 'timestamp with time zone', 'NO')
),
checks AS (
  SELECT 'TABLE_EXISTS' AS check_name,
         'kai.intake_p1_downstream_attempts' AS object_name,
         CASE WHEN EXISTS (SELECT 1 FROM target) THEN 'PASS' ELSE 'FAIL' END AS status,
         'P1 downstream recovery-state table' AS detail
  UNION ALL
  SELECT 'COLUMN_SHAPE', e.column_name,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'kai' AND c.table_name = 'intake_p1_downstream_attempts'
              AND c.column_name = e.column_name AND c.data_type = e.data_type AND c.is_nullable = e.is_nullable
         ) THEN 'PASS' ELSE 'FAIL' END,
         e.data_type || ' nullable=' || e.is_nullable
    FROM expected_columns e
  UNION ALL
  SELECT 'NO_UNEXPECTED_COLUMNS', 'kai.intake_p1_downstream_attempts',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'kai' AND c.table_name = 'intake_p1_downstream_attempts'
              AND c.column_name NOT IN (SELECT column_name FROM expected_columns)
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no content, message, storage, review, or approval column'
  UNION ALL
  SELECT 'PRIMARY_KEY', 'intake_p1_downstream_attempts_pkey',
         CASE WHEN EXISTS (
           SELECT 1 FROM constraint_defs WHERE conname = 'intake_p1_downstream_attempts_pkey' AND contype = 'p'
             AND def = 'PRIMARY KEY (organization_id, file_profile_id, stage)'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'one recovery row per organization, exact file profile, and stage'
  UNION ALL
  SELECT 'FK_EXISTS', 'intake_p1_downstream_attempts_profile_fk',
         CASE WHEN EXISTS (
           SELECT 1 FROM constraint_defs WHERE conname = 'intake_p1_downstream_attempts_profile_fk' AND contype = 'f'
             AND key_count = 6 AND def LIKE '%REFERENCES kai.intake_file_profiles(file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum)%'
             AND def LIKE '%ON DELETE RESTRICT%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'bound by composite lineage to the exact committed profile identity and checksum'
  UNION ALL
  SELECT 'CHECK_EXISTS', expected.conname,
         CASE WHEN EXISTS (
           SELECT 1 FROM constraint_defs d WHERE d.conname = expected.conname AND d.contype = 'c' AND d.def LIKE expected.pattern
         ) THEN 'PASS' ELSE 'FAIL' END,
         expected.detail
    FROM (VALUES
      ('intake_p1_downstream_attempts_stage_check', '%p1_04_data_dictionary%p1_05_sensitivity_profile%', 'only the P1-04 and P1-05 stages'),
      ('intake_p1_downstream_attempts_state_check', '%in_progress%retry_scheduled%succeeded%exhausted%operator_attention%', 'closed recovery-state vocabulary'),
      ('intake_p1_downstream_attempts_attempt_count_check', '%attempt_count >= 0%attempt_count <= 3%', 'at most three automatic attempts'),
      ('intake_p1_downstream_attempts_checksum_check', '%[a-f0-9]{64}%', 'sha256 checksum'),
      ('intake_p1_downstream_attempts_error_code_check', '%[a-z0-9_]{1,64}%', 'safe error token only'),
      ('intake_p1_downstream_attempts_state_fact_consistency_check', '%claim_token IS NOT NULL%attempt_count = 3%', 'state/fact consistency')
    ) AS expected(conname, pattern, detail)
  UNION ALL
  SELECT 'INDEX_EXISTS', 'ix_intake_p1_downstream_attempts_tenant_file',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_indexes WHERE schemaname = 'kai' AND indexname = 'ix_intake_p1_downstream_attempts_tenant_file'
             AND indexdef LIKE '%(organization_id, intake_file_id, checksum)%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'sweep exclusion and operator read by tenant, file, and checksum'
  UNION ALL
  SELECT 'NO_TRIGGER', 'kai.intake_p1_downstream_attempts',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN target t ON t.relid = tg.tgrelid WHERE NOT tg.tgisinternal)
              THEN 'PASS' ELSE 'FAIL' END,
         'no trigger side effects'
  UNION ALL
  SELECT 'EXISTING_PARSER_STATUS_UNCHANGED', 'intake_parser_runs_p1_parser_status_check',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'intake_parser_runs' AND c.conname = 'intake_parser_runs_p1_parser_status_check'
              AND pg_get_constraintdef(c.oid) LIKE '%queued%running%completed%failed%cancelled%'
              AND pg_get_constraintdef(c.oid) NOT LIKE '%lease%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'parser status vocabulary is not extended'
  UNION ALL
  SELECT 'EXISTING_PARSER_RETRY_CAP_UNCHANGED', 'intake_parser_runs_p1_retry_count_check',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'intake_parser_runs' AND c.conname = 'intake_parser_runs_p1_retry_count_check'
              AND pg_get_constraintdef(c.oid) LIKE '%retry_count >= 0%retry_count <= 3%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'parser retry cap stays at three'
  UNION ALL
  SELECT 'EXISTING_AUDIT_OPERATIONS_UNCHANGED', 'upload_lifecycle_audit_gate_a_operation_check',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'upload_lifecycle_audit' AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_persisted%'
              AND pg_get_constraintdef(c.oid) NOT LIKE '%downstream%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no lifecycle-audit operation added'
  UNION ALL
  SELECT 'NO_COLUMN_ADDED_TO_EXISTING_TABLES', 'kai.intake_files/intake_parser_runs/intake_file_profiles/data_dictionaries/intake_sensitivity_profiles',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name IN ('intake_files', 'intake_parser_runs', 'intake_file_profiles', 'data_dictionaries', 'intake_sensitivity_profiles')
              AND column_name IN ('recovery_state', 'attempt_count', 'claim_token', 'claim_expires_at', 'next_eligible_at', 'lease_expires_at')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'additive migration: existing tables untouched'
)
SELECT 'P1_DOWNSTREAM_RECOVERY_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
