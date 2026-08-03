BEGIN;

CREATE SCHEMA IF NOT EXISTS kai;

DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before Gate A P0 lifecycle migration';
  END IF;
END $$;

ALTER TABLE kai.intake_files
  ADD COLUMN IF NOT EXISTS upload_state text,
  ADD COLUMN IF NOT EXISTS upload_state_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS object_version_id text,
  ADD COLUMN IF NOT EXISTS verified_checksum text,
  ADD COLUMN IF NOT EXISTS verified_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

UPDATE kai.intake_files
   SET upload_state = COALESCE(upload_state, 'reserved'),
       upload_state_changed_at = COALESCE(upload_state_changed_at, created_at, now()),
       upload_expires_at = COALESCE(upload_expires_at, COALESCE(created_at, now()) + interval '24 hours')
 WHERE upload_state IS NULL
    OR upload_state_changed_at IS NULL
    OR upload_expires_at IS NULL;

ALTER TABLE kai.intake_files
  ALTER COLUMN upload_state SET DEFAULT 'reserved',
  ALTER COLUMN upload_state SET NOT NULL,
  ALTER COLUMN upload_state_changed_at SET DEFAULT now(),
  ALTER COLUMN upload_state_changed_at SET NOT NULL,
  ALTER COLUMN upload_expires_at SET DEFAULT (now() + interval '24 hours'),
  ALTER COLUMN upload_expires_at SET NOT NULL;

ALTER TABLE kai.intake_files
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_upload_state_check,
  ADD CONSTRAINT intake_files_gate_a_upload_state_check
    CHECK (upload_state IN (
      'reserved',
      'upload_started',
      'uploaded_unconfirmed',
      'confirmed',
      'policy_blocked',
      'abandoned',
      'expired'
    )),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_declared_checksum_check,
  ADD CONSTRAINT intake_files_gate_a_declared_checksum_check
    CHECK (checksum ~ '^[a-f0-9]{64}$'),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_hash_algorithm_check,
  ADD CONSTRAINT intake_files_gate_a_hash_algorithm_check
    CHECK (hash_algorithm = 'sha256'),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_object_version_check,
  ADD CONSTRAINT intake_files_gate_a_object_version_check
    CHECK (object_version_id IS NULL OR (length(object_version_id) BETWEEN 1 AND 256 AND object_version_id ~ '^[!-~]+$')),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_verified_checksum_check,
  ADD CONSTRAINT intake_files_gate_a_verified_checksum_check
    CHECK (verified_checksum IS NULL OR verified_checksum ~ '^[a-f0-9]{64}$'),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_verified_size_check,
  ADD CONSTRAINT intake_files_gate_a_verified_size_check
    CHECK (verified_size_bytes IS NULL OR verified_size_bytes >= 1),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_state_fact_consistency_check,
  ADD CONSTRAINT intake_files_gate_a_state_fact_consistency_check
    CHECK (
      (
        upload_state IN ('reserved', 'upload_started')
        AND object_version_id IS NULL
        AND verified_checksum IS NULL
        AND verified_size_bytes IS NULL
        AND verified_at IS NULL
      )
      OR (
        upload_state = 'uploaded_unconfirmed'
        AND object_version_id IS NOT NULL
        AND verified_checksum IS NULL
        AND verified_size_bytes IS NULL
        AND verified_at IS NULL
      )
      OR (
        upload_state = 'confirmed'
        AND object_version_id IS NOT NULL
        AND verified_checksum IS NOT NULL
        AND verified_size_bytes IS NOT NULL
        AND verified_at IS NOT NULL
      )
      OR upload_state IN ('policy_blocked', 'abandoned', 'expired')
    );

CREATE UNIQUE INDEX IF NOT EXISTS ux_intake_files_gate_a_tenant_file
  ON kai.intake_files (organization_id, intake_file_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_intake_files_gate_a_org_declared_checksum
  ON kai.intake_files (organization_id, checksum)
  WHERE force_new_version = false;

CREATE INDEX IF NOT EXISTS ix_intake_files_gate_a_tenant_upload_state
  ON kai.intake_files (organization_id, intake_batch_id, upload_state, upload_expires_at);

CREATE INDEX IF NOT EXISTS ix_intake_files_gate_a_object_version
  ON kai.intake_files (organization_id, intake_file_id, object_version_id)
  WHERE object_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kai.upload_lifecycle_audit (
  upload_lifecycle_audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  operation text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
    CHECK (operation IN ('reserve_upload', 'start_upload', 'complete_object_version', 'confirm_upload', 'block_upload', 'abandon_upload', 'expire_upload')),
  CONSTRAINT upload_lifecycle_audit_gate_a_outcome_check
    CHECK (outcome IN ('success', 'same_fact_replay', 'changed_fact_conflict', 'checksum_mismatch_zero_transition', 'transition_denied')),
  CONSTRAINT upload_lifecycle_audit_gate_a_state_check
    CHECK (
      (from_state IS NULL OR from_state IN ('reserved', 'upload_started', 'uploaded_unconfirmed', 'confirmed', 'policy_blocked', 'abandoned', 'expired'))
      AND to_state IN ('reserved', 'upload_started', 'uploaded_unconfirmed', 'confirmed', 'policy_blocked', 'abandoned', 'expired')
    ),
  CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS ix_upload_lifecycle_audit_gate_a_tenant_file
  ON kai.upload_lifecycle_audit (organization_id, intake_file_id, created_at);

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
