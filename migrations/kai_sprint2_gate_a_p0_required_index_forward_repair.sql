BEGIN;

DO $$
DECLARE
  missing_columns text;
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before Gate A P0 required-index forward repair';
  END IF;

  WITH required_columns(column_name, data_type, udt_name) AS (
    VALUES
      ('organization_id', 'uuid', 'uuid'),
      ('checksum', 'text', 'text'),
      ('force_new_version', 'boolean', 'bool'),
      ('intake_batch_id', 'uuid', 'uuid'),
      ('upload_state', 'text', 'text'),
      ('upload_expires_at', 'timestamp with time zone', 'timestamptz'),
      ('intake_file_id', 'uuid', 'uuid'),
      ('object_version_id', 'text', 'text')
  )
  SELECT string_agg(required_columns.column_name, ', ' ORDER BY required_columns.column_name)
    INTO missing_columns
    FROM required_columns
   WHERE NOT EXISTS (
         SELECT 1
           FROM information_schema.columns c
          WHERE c.table_schema = 'kai'
            AND c.table_name = 'intake_files'
            AND c.column_name = required_columns.column_name
            AND c.data_type = required_columns.data_type
            AND c.udt_name = required_columns.udt_name
       );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'kai.intake_files lacks required Gate A P0 required-index column shape: %', missing_columns;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_intake_files_gate_a_org_declared_checksum
  ON kai.intake_files (organization_id, checksum)
  WHERE force_new_version = false;

CREATE INDEX IF NOT EXISTS ix_intake_files_gate_a_tenant_upload_state
  ON kai.intake_files (organization_id, intake_batch_id, upload_state, upload_expires_at);

CREATE INDEX IF NOT EXISTS ix_intake_files_gate_a_object_version
  ON kai.intake_files (organization_id, intake_file_id, object_version_id)
  WHERE object_version_id IS NOT NULL;

COMMIT;
