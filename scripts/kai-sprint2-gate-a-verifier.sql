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
)
SELECT 'GATE_A_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
