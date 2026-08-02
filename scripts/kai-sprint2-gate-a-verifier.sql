WITH checks AS (
  SELECT 'POSTGRES_VERSION' AS check_name,
         'server' AS object_name,
         'PASS' AS status,
         current_setting('server_version') AS detail
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_files.upload_state',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'upload_state'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'durable upload-state column'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_files.object_version_id',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'object_version_id'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'provider-neutral immutable object-version identity'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_files.verified_checksum',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'kai' AND table_name = 'intake_files' AND column_name = 'verified_checksum'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'verified checksum column'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'kai.intake_files upload vocabulary',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_class r ON r.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           WHERE n.nspname = 'kai'
             AND r.relname = 'intake_files'
             AND c.conname = 'intake_files_gate_a_upload_state_check'
             AND pg_get_constraintdef(c.oid) LIKE '%uploaded_unconfirmed%'
             AND pg_get_constraintdef(c.oid) LIKE '%policy_blocked%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'DDL vocabulary for lifecycle states'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'kai.intake_files checksum canonicality',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_class r ON r.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           WHERE n.nspname = 'kai'
             AND r.relname = 'intake_files'
             AND c.conname = 'intake_files_gate_a_verified_checksum_check'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'lowercase SHA-256 checksum constraint'
  UNION ALL
  SELECT 'INDEX_EXISTS', 'ux_intake_files_gate_a_tenant_file',
         CASE WHEN to_regclass('kai.ux_intake_files_gate_a_tenant_file') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'tenant-scoped intake file identity'
  UNION ALL
  SELECT 'INDEX_EXISTS', 'ux_security_assessment_enqueue_gate_a_identity',
         CASE WHEN to_regclass('kai.ux_security_assessment_enqueue_gate_a_identity') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'ON CONFLICT replay identity'
  UNION ALL
  SELECT 'TRIGGER_EXISTS', 'trg_gate_a_intake_file_lifecycle',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_trigger
           WHERE tgname = 'trg_gate_a_intake_file_lifecycle'
             AND NOT tgisinternal
         ) THEN 'PASS' ELSE 'FAIL' END,
         'transition, immutability, expiry, and active-limit trigger'
  UNION ALL
  SELECT 'FOREIGN_KEY_EXISTS', 'security_assessment_enqueue -> intake_files',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'security_assessment_enqueue_gate_a_intake_file_fk'
             AND contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'enqueue rows bind to file rows'
)
SELECT 'GATE_A_VERIFIER' AS result_type,
       check_name,
       object_name,
       status,
       detail
FROM checks
ORDER BY check_name, object_name;
