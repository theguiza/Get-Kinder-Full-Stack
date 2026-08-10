WITH checks AS (
  SELECT 'POSTGRES_VERSION_16' AS check_name,
         'server' AS object_name,
         CASE WHEN current_setting('server_version_num')::integer >= 160000
                AND current_setting('server_version_num')::integer < 170000
              THEN 'PASS' ELSE 'FAIL' END AS status,
         current_setting('server_version') AS detail
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_files.upload_state',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'upload_state'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'dedicated lifecycle state'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_files.object_version_id',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'object_version_id'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'provider-neutral immutable object version'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_files.verified_checksum',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'verified_checksum'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'independently verified checksum'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_files_gate_a_upload_state_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_files'
              AND c.conname = 'intake_files_gate_a_upload_state_check'
              AND pg_get_constraintdef(c.oid) LIKE '%uploaded_unconfirmed%'
              AND pg_get_constraintdef(c.oid) LIKE '%policy_blocked%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'allowed lifecycle vocabulary'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_files_gate_a_state_fact_consistency_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_files'
              AND c.conname = 'intake_files_gate_a_state_fact_consistency_check'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'state and immutable fact consistency'
  UNION ALL
  SELECT 'INDEX_EXISTS', 'ux_intake_files_gate_a_tenant_file',
         CASE WHEN to_regclass('kai.ux_intake_files_gate_a_tenant_file') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'tenant-scoped reservation identity'
  UNION ALL
  SELECT 'INDEX_EXISTS', 'ux_intake_files_gate_a_org_declared_checksum',
         CASE WHEN to_regclass('kai.ux_intake_files_gate_a_org_declared_checksum') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'same tenant declared checksum replay/conflict surface'
  UNION ALL
  SELECT 'TRIGGER_EXISTS', 'trg_gate_a_p0_upload_lifecycle',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_trigger WHERE tgname = 'trg_gate_a_p0_upload_lifecycle' AND NOT tgisinternal
         ) THEN 'PASS' ELSE 'FAIL' END,
         'immutability, transition, expiry, and active-limit enforcement'
  UNION ALL
  SELECT 'AUDIT_TABLE_EXISTS', 'kai.upload_lifecycle_audit',
         CASE WHEN to_regclass('kai.upload_lifecycle_audit') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'metadata-only lifecycle audit substrate'
  UNION ALL
  SELECT 'POLICY_REPLAY_TABLE_EXISTS', 'kai.upload_policy_decision_replay',
         CASE WHEN to_regclass('kai.upload_policy_decision_replay') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'durable policy decision replay authority'
  UNION ALL
  SELECT 'POLICY_REPLAY_COLUMN_EXISTS', 'kai.upload_policy_decision_replay.sanitized_result_canonical_sha256',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'upload_policy_decision_replay' AND column_name = 'sanitized_result_canonical_sha256'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'deterministic sanitized result comparison'
  UNION ALL
  SELECT 'POLICY_REPLAY_CONSTRAINT_EXISTS', 'upload_policy_decision_replay_gate_a_policy_status_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_policy_decision_replay'
              AND c.conname = 'upload_policy_decision_replay_gate_a_policy_status_check'
              AND pg_get_constraintdef(c.oid) LIKE '%passed%'
              AND pg_get_constraintdef(c.oid) LIKE '%blocked%'
              AND pg_get_constraintdef(c.oid) LIKE '%failed%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'policy outcome vocabulary'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'policy_decision_compare_and_set',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%policy_decision_compare_and_set%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts policy-decision CAS operation'
)
SELECT 'GATE_A_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
