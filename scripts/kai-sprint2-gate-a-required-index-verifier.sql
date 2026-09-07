DROP TABLE IF EXISTS gate_a_required_index_results;
CREATE TEMP TABLE gate_a_required_index_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO gate_a_required_index_results
WITH index_contracts(index_name, expected_indexdef) AS (
  VALUES
    (
      'ux_intake_files_gate_a_org_declared_checksum',
      'CREATE UNIQUE INDEX ux_intake_files_gate_a_org_declared_checksum ON kai.intake_files USING btree (organization_id, checksum) WHERE (force_new_version = false)'
    ),
    (
      'ix_intake_files_gate_a_tenant_upload_state',
      'CREATE INDEX ix_intake_files_gate_a_tenant_upload_state ON kai.intake_files USING btree (organization_id, intake_batch_id, upload_state, upload_expires_at)'
    ),
    (
      'ix_intake_files_gate_a_object_version',
      'CREATE INDEX ix_intake_files_gate_a_object_version ON kai.intake_files USING btree (organization_id, intake_file_id, object_version_id) WHERE (object_version_id IS NOT NULL)'
    )
),
actual AS (
  SELECT c.relname AS index_name,
         pg_get_indexdef(c.oid) AS indexdef
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'kai'
     AND c.relname IN (
       'ux_intake_files_gate_a_org_declared_checksum',
       'ix_intake_files_gate_a_tenant_upload_state',
       'ix_intake_files_gate_a_object_version'
     )
)
SELECT 'exact_index_contract_' || index_contracts.index_name,
       CASE WHEN actual.indexdef = index_contracts.expected_indexdef THEN 'PASS' ELSE 'FAIL' END,
       COALESCE(actual.indexdef, 'missing')
  FROM index_contracts
  LEFT JOIN actual USING (index_name);

INSERT INTO gate_a_required_index_results
SELECT 'required_index_columns_present',
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
       'required index-referenced kai.intake_files columns remain present';

SELECT 'GATE_A_REQUIRED_INDEX_REPAIR' AS result_type, check_name, status, detail
FROM gate_a_required_index_results
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gate_a_required_index_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Gate A required-index repair verifier failed';
  END IF;
END $$;
