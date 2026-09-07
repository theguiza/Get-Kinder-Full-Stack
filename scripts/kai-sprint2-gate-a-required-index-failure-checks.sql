WITH checks AS (
  SELECT 'REQUIRED_TABLE_PRESENT' AS check_name,
         'kai.intake_files' AS object_name,
         CASE WHEN to_regclass('kai.intake_files') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'detects absent required Gate A table' AS detail
  UNION ALL
  SELECT 'REQUIRED_INDEX_COLUMNS_PRESENT', 'kai.intake_files',
         CASE WHEN NOT EXISTS (
                SELECT 1
                  FROM (VALUES
                    ('organization_id', 'uuid', 'uuid'),
                    ('checksum', 'text', 'text'),
                    ('force_new_version', 'boolean', 'bool'),
                    ('intake_batch_id', 'uuid', 'uuid'),
                    ('upload_state', 'text', 'text'),
                    ('upload_expires_at', 'timestamp with time zone', 'timestamptz'),
                    ('intake_file_id', 'uuid', 'uuid'),
                    ('object_version_id', 'text', 'text')
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
         'detects absent or incompatible required index column shape'
  UNION ALL
  SELECT 'UNIQUE_DECLARED_CHECKSUM_CONTRACT', 'ux_intake_files_gate_a_org_declared_checksum',
         CASE WHEN EXISTS (
                SELECT 1
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'kai'
                   AND c.relname = 'ux_intake_files_gate_a_org_declared_checksum'
                   AND pg_get_indexdef(c.oid) = 'CREATE UNIQUE INDEX ux_intake_files_gate_a_org_declared_checksum ON kai.intake_files USING btree (organization_id, checksum) WHERE (force_new_version = false)'
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'detects absent or changed declared-checksum unique index contract'
  UNION ALL
  SELECT 'TENANT_UPLOAD_STATE_INDEX_CONTRACT', 'ix_intake_files_gate_a_tenant_upload_state',
         CASE WHEN EXISTS (
                SELECT 1
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'kai'
                   AND c.relname = 'ix_intake_files_gate_a_tenant_upload_state'
                   AND pg_get_indexdef(c.oid) = 'CREATE INDEX ix_intake_files_gate_a_tenant_upload_state ON kai.intake_files USING btree (organization_id, intake_batch_id, upload_state, upload_expires_at)'
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'detects absent or changed tenant upload-state index contract'
  UNION ALL
  SELECT 'OBJECT_VERSION_INDEX_CONTRACT', 'ix_intake_files_gate_a_object_version',
         CASE WHEN EXISTS (
                SELECT 1
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'kai'
                   AND c.relname = 'ix_intake_files_gate_a_object_version'
                   AND pg_get_indexdef(c.oid) = 'CREATE INDEX ix_intake_files_gate_a_object_version ON kai.intake_files USING btree (organization_id, intake_file_id, object_version_id) WHERE (object_version_id IS NOT NULL)'
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'detects absent or changed object-version index contract'
)
SELECT 'GATE_A_REQUIRED_INDEX_FAILURE_CHECKS' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
