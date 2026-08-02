BEGIN;

CREATE SCHEMA IF NOT EXISTS kai;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'kai'
      AND table_name = 'intake_files'
  ) THEN
    RAISE EXCEPTION 'kai.intake_files is required before Gate A lifecycle migration';
  END IF;
END $$;

ALTER TABLE kai.intake_files
  ADD COLUMN IF NOT EXISTS upload_state text,
  ADD COLUMN IF NOT EXISTS upload_state_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS object_version_id text,
  ADD COLUMN IF NOT EXISTS verified_checksum text,
  ADD COLUMN IF NOT EXISTS verified_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS policy_decision_replay jsonb;

UPDATE kai.intake_files
   SET upload_state = COALESCE(upload_state, 'reserved'),
       upload_state_changed_at = COALESCE(upload_state_changed_at, created_at, now()),
       upload_expires_at = COALESCE(upload_expires_at, COALESCE(created_at, now()) + interval '24 hours'),
       policy_decision_replay = NULLIF(policy_decision_replay, 'null'::jsonb)
 WHERE upload_state IS NULL
    OR upload_state_changed_at IS NULL
    OR upload_expires_at IS NULL
    OR policy_decision_replay = 'null'::jsonb;

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
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_object_version_check,
  ADD CONSTRAINT intake_files_gate_a_object_version_check
    CHECK (object_version_id IS NULL OR object_version_id ~ '^ov_[a-f0-9]{32}$'),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_verified_checksum_check,
  ADD CONSTRAINT intake_files_gate_a_verified_checksum_check
    CHECK (verified_checksum IS NULL OR verified_checksum ~ '^[a-f0-9]{64}$'),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_verified_size_check,
  ADD CONSTRAINT intake_files_gate_a_verified_size_check
    CHECK (verified_size_bytes IS NULL OR verified_size_bytes >= 1),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_hash_algorithm_check,
  ADD CONSTRAINT intake_files_gate_a_hash_algorithm_check
    CHECK (hash_algorithm IS NULL OR hash_algorithm = 'sha256'),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_state_fact_consistency_check,
  ADD CONSTRAINT intake_files_gate_a_state_fact_consistency_check
    CHECK (
      (upload_state = 'reserved' AND object_version_id IS NULL AND verified_checksum IS NULL AND verified_size_bytes IS NULL AND verified_at IS NULL)
      OR (upload_state = 'upload_started' AND object_version_id IS NULL AND verified_checksum IS NULL AND verified_size_bytes IS NULL AND verified_at IS NULL)
      OR (upload_state = 'uploaded_unconfirmed' AND object_version_id IS NOT NULL AND verified_checksum IS NULL AND verified_size_bytes IS NULL AND verified_at IS NULL)
      OR (upload_state = 'confirmed' AND object_version_id IS NOT NULL AND verified_checksum IS NOT NULL AND verified_size_bytes IS NOT NULL AND verified_at IS NOT NULL)
      OR (upload_state = 'policy_blocked')
      OR (upload_state = 'abandoned')
      OR (upload_state = 'expired')
    ),
  DROP CONSTRAINT IF EXISTS intake_files_gate_a_policy_replay_check,
  ADD CONSTRAINT intake_files_gate_a_policy_replay_check
    CHECK (
      policy_decision_replay IS NULL
      OR (
        jsonb_typeof(policy_decision_replay) = 'object'
        AND policy_decision_replay ? 'organization_id'
        AND policy_decision_replay ? 'intake_file_id'
        AND policy_decision_replay ? 'object_version_id'
        AND policy_decision_replay ? 'verified_checksum'
        AND policy_decision_replay ? 'verified_size_bytes'
        AND policy_decision_replay ? 'file_policy_status'
        AND policy_decision_replay ? 'sanitized_result'
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS ux_intake_files_gate_a_tenant_file
  ON kai.intake_files (organization_id, intake_file_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_intake_files_gate_a_org_checksum_default
  ON kai.intake_files (organization_id, checksum)
  WHERE force_new_version = false AND checksum IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_intake_files_gate_a_tenant_upload_state
  ON kai.intake_files (organization_id, intake_batch_id, upload_state, upload_expires_at);

CREATE INDEX IF NOT EXISTS ix_intake_files_gate_a_object_version
  ON kai.intake_files (organization_id, intake_file_id, object_version_id)
  WHERE object_version_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kai.security_assessment_enqueue (
  security_assessment_enqueue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  object_version_id text NOT NULL,
  verified_checksum text NOT NULL,
  verified_size_bytes bigint NOT NULL,
  declared_mime text NOT NULL,
  extension text NOT NULL,
  enqueue_state text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_assessment_enqueue_gate_a_object_version_check
    CHECK (object_version_id ~ '^ov_[a-f0-9]{32}$'),
  CONSTRAINT security_assessment_enqueue_gate_a_checksum_check
    CHECK (verified_checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT security_assessment_enqueue_gate_a_size_check
    CHECK (verified_size_bytes >= 1),
  CONSTRAINT security_assessment_enqueue_gate_a_state_check
    CHECK (enqueue_state IN ('queued', 'selected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_security_assessment_enqueue_gate_a_identity
  ON kai.security_assessment_enqueue (
    organization_id,
    intake_file_id,
    object_version_id,
    verified_checksum
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'kai'
      AND table_name = 'intake_files'
      AND constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      AND constraint_name = 'intake_files_pkey'
  ) THEN
    ALTER TABLE kai.security_assessment_enqueue
      DROP CONSTRAINT IF EXISTS security_assessment_enqueue_gate_a_intake_file_fk;
    ALTER TABLE kai.security_assessment_enqueue
      ADD CONSTRAINT security_assessment_enqueue_gate_a_intake_file_fk
      FOREIGN KEY (intake_file_id) REFERENCES kai.intake_files (intake_file_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION kai.enforce_gate_a_intake_file_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  edge text;
  active_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.upload_state IS NULL THEN
      NEW.upload_state := 'reserved';
    END IF;
    IF NEW.upload_state_changed_at IS NULL THEN
      NEW.upload_state_changed_at := now();
    END IF;
    IF NEW.upload_expires_at IS NULL THEN
      NEW.upload_expires_at := NEW.upload_state_changed_at + interval '24 hours';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'Gate A lifecycle tenant identity is immutable';
    END IF;
    IF OLD.intake_file_id IS DISTINCT FROM NEW.intake_file_id THEN
      RAISE EXCEPTION 'Gate A lifecycle file identity is immutable';
    END IF;
    IF OLD.object_version_id IS NOT NULL AND OLD.object_version_id IS DISTINCT FROM NEW.object_version_id THEN
      RAISE EXCEPTION 'Gate A object-version identity is immutable';
    END IF;
    IF OLD.verified_checksum IS NOT NULL AND OLD.verified_checksum IS DISTINCT FROM NEW.verified_checksum THEN
      RAISE EXCEPTION 'Gate A verified checksum is immutable';
    END IF;
    IF OLD.verified_size_bytes IS NOT NULL AND OLD.verified_size_bytes IS DISTINCT FROM NEW.verified_size_bytes THEN
      RAISE EXCEPTION 'Gate A verified size is immutable';
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
        RAISE EXCEPTION 'Gate A lifecycle transition denied: %', edge;
      END IF;

      IF OLD.upload_state IN ('reserved', 'upload_started', 'uploaded_unconfirmed') THEN
        IF NEW.upload_state = 'expired' AND NEW.upload_state_changed_at < OLD.upload_expires_at THEN
          RAISE EXCEPTION 'Gate A lifecycle cannot expire before upload_expires_at';
        END IF;
        IF NEW.upload_state <> 'expired' AND NEW.upload_state_changed_at >= OLD.upload_expires_at THEN
          RAISE EXCEPTION 'Gate A lifecycle transition denied after expiry';
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
      RAISE EXCEPTION 'Gate A 25-file concurrent upload limit exceeded';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gate_a_intake_file_lifecycle ON kai.intake_files;
CREATE TRIGGER trg_gate_a_intake_file_lifecycle
BEFORE INSERT OR UPDATE ON kai.intake_files
FOR EACH ROW
EXECUTE FUNCTION kai.enforce_gate_a_intake_file_lifecycle();

COMMIT;
