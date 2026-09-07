BEGIN;

DO $$
DECLARE
  missing_columns text;
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before Gate A P0 upload-lifecycle enforcement repair';
  END IF;

  WITH required_columns(column_name, data_type, udt_name) AS (
    VALUES
      ('organization_id', 'uuid', 'uuid'),
      ('intake_file_id', 'uuid', 'uuid'),
      ('intake_batch_id', 'uuid', 'uuid'),
      ('checksum', 'text', 'text'),
      ('hash_algorithm', 'text', 'text'),
      ('created_at', 'timestamp with time zone', 'timestamptz'),
      ('upload_state', 'text', 'text'),
      ('upload_state_changed_at', 'timestamp with time zone', 'timestamptz'),
      ('upload_expires_at', 'timestamp with time zone', 'timestamptz'),
      ('object_version_id', 'text', 'text'),
      ('verified_checksum', 'text', 'text'),
      ('verified_size_bytes', 'bigint', 'int8'),
      ('verified_at', 'timestamp with time zone', 'timestamptz')
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
    RAISE EXCEPTION 'kai.intake_files lacks required Gate A P0 upload-lifecycle enforcement column shape: %', missing_columns;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION kai.enforce_gate_a_p0_upload_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  edge text;
  active_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.upload_state := COALESCE(NEW.upload_state, 'reserved');
    NEW.upload_state_changed_at := COALESCE(NEW.upload_state_changed_at, COALESCE(NEW.created_at, now()));
    NEW.upload_expires_at := COALESCE(NEW.upload_expires_at, NEW.upload_state_changed_at + interval '24 hours');
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'Gate A P0 tenant identity is immutable';
    END IF;
    IF OLD.intake_file_id IS DISTINCT FROM NEW.intake_file_id THEN
      RAISE EXCEPTION 'Gate A P0 file identity is immutable';
    END IF;
    IF OLD.checksum IS DISTINCT FROM NEW.checksum THEN
      RAISE EXCEPTION 'Gate A P0 declared checksum is immutable';
    END IF;
    IF OLD.hash_algorithm IS DISTINCT FROM NEW.hash_algorithm THEN
      RAISE EXCEPTION 'Gate A P0 hash algorithm is immutable';
    END IF;
    IF OLD.object_version_id IS NOT NULL AND OLD.object_version_id IS DISTINCT FROM NEW.object_version_id THEN
      RAISE EXCEPTION 'Gate A P0 object-version identity is immutable';
    END IF;
    IF OLD.verified_checksum IS NOT NULL AND OLD.verified_checksum IS DISTINCT FROM NEW.verified_checksum THEN
      RAISE EXCEPTION 'Gate A P0 verified checksum is immutable';
    END IF;
    IF OLD.verified_size_bytes IS NOT NULL AND OLD.verified_size_bytes IS DISTINCT FROM NEW.verified_size_bytes THEN
      RAISE EXCEPTION 'Gate A P0 verified size is immutable';
    END IF;
    IF OLD.verified_at IS NOT NULL AND OLD.verified_at IS DISTINCT FROM NEW.verified_at THEN
      RAISE EXCEPTION 'Gate A P0 verification timestamp is immutable';
    END IF;

    IF OLD.upload_state IS DISTINCT FROM NEW.upload_state THEN
      edge := OLD.upload_state || '->' || NEW.upload_state;
      IF edge NOT IN (
        'reserved->upload_started',
        'reserved->policy_blocked',
        'reserved->abandoned',
        'reserved->expired',
        'upload_started->uploaded_unconfirmed',
        'upload_started->policy_blocked',
        'upload_started->abandoned',
        'upload_started->expired',
        'uploaded_unconfirmed->confirmed',
        'uploaded_unconfirmed->policy_blocked',
        'uploaded_unconfirmed->abandoned',
        'uploaded_unconfirmed->expired',
        'confirmed->policy_blocked'
      ) THEN
        RAISE EXCEPTION 'Gate A P0 lifecycle transition denied';
      END IF;

      IF OLD.upload_state IN ('reserved', 'upload_started', 'uploaded_unconfirmed') THEN
        IF NEW.upload_state = 'expired' AND NEW.upload_state_changed_at < OLD.upload_expires_at THEN
          RAISE EXCEPTION 'Gate A P0 cannot expire before upload_expires_at';
        END IF;
        IF NEW.upload_state <> 'expired' AND NEW.upload_state_changed_at >= OLD.upload_expires_at THEN
          RAISE EXCEPTION 'Gate A P0 lifecycle transition denied after expiry';
        END IF;
      END IF;
    END IF;
  END IF;

  IF NEW.upload_state IN ('reserved', 'upload_started', 'uploaded_unconfirmed') THEN
    SELECT count(*)
      INTO active_count
      FROM kai.intake_files f
     WHERE f.organization_id = NEW.organization_id
       AND f.intake_batch_id = NEW.intake_batch_id
       AND f.upload_state IN ('reserved', 'upload_started', 'uploaded_unconfirmed')
       AND (TG_OP = 'INSERT' OR f.intake_file_id <> NEW.intake_file_id);
    IF active_count >= 25 THEN
      RAISE EXCEPTION 'Gate A P0 active upload limit exceeded';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gate_a_p0_upload_lifecycle ON kai.intake_files;
CREATE TRIGGER trg_gate_a_p0_upload_lifecycle
BEFORE INSERT OR UPDATE ON kai.intake_files
FOR EACH ROW
EXECUTE FUNCTION kai.enforce_gate_a_p0_upload_lifecycle();

COMMIT;
