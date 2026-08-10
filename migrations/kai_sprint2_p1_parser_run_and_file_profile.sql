BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before P1-02 parser-run/file-profile migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-02 parser-run/file-profile migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-02 parser-run/file-profile migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.intake_parser_runs (
  parser_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  checksum text NOT NULL,
  parser_status text NOT NULL DEFAULT 'queued',
  retry_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message_safe text,
  output_profile_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_parser_runs_p1_identity_unique
    UNIQUE (organization_id, intake_file_id, parser_name, parser_version, checksum),
  CONSTRAINT intake_parser_runs_p1_run_identity_unique
    UNIQUE (parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum),
  CONSTRAINT intake_parser_runs_p1_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_parser_runs_p1_parser_name_check
    CHECK (length(parser_name) BETWEEN 1 AND 128 AND parser_name = lower(btrim(parser_name)) AND parser_name ~ '^[a-z0-9_]+$'),
  CONSTRAINT intake_parser_runs_p1_parser_version_check
    CHECK (length(parser_version) BETWEEN 1 AND 64 AND parser_version = lower(btrim(parser_version)) AND parser_version ~ '^[a-z0-9._-]+$'),
  CONSTRAINT intake_parser_runs_p1_checksum_check
    CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT intake_parser_runs_p1_parser_status_check
    CHECK (parser_status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT intake_parser_runs_p1_retry_count_check
    CHECK (retry_count BETWEEN 0 AND 3),
  CONSTRAINT intake_parser_runs_p1_error_code_check
    CHECK (error_code IS NULL OR (length(error_code) BETWEEN 1 AND 64 AND error_code = lower(btrim(error_code)) AND error_code ~ '^[a-z0-9_]+$')),
  CONSTRAINT intake_parser_runs_p1_error_message_safe_check
    CHECK (
      error_message_safe IS NULL
      OR (
        length(error_message_safe) BETWEEN 1 AND 500
        AND error_message_safe !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|  at [A-Za-z])'
      )
    ),
  CONSTRAINT intake_parser_runs_p1_state_fact_consistency_check
    CHECK (
      (parser_status = 'queued' AND completed_at IS NULL AND output_profile_id IS NULL AND error_code IS NULL AND error_message_safe IS NULL)
      OR (parser_status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL AND output_profile_id IS NULL AND error_code IS NULL AND error_message_safe IS NULL)
      OR (parser_status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND output_profile_id IS NOT NULL AND error_code IS NULL AND error_message_safe IS NULL)
      OR (parser_status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NOT NULL AND error_message_safe IS NOT NULL AND output_profile_id IS NULL)
      OR (parser_status = 'cancelled' AND completed_at IS NOT NULL AND output_profile_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_intake_parser_runs_p1_tenant_file
  ON kai.intake_parser_runs (organization_id, intake_file_id);

CREATE TABLE IF NOT EXISTS kai.intake_file_profiles (
  file_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  parser_run_id uuid NOT NULL,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  checksum text NOT NULL,
  profile jsonb NOT NULL,
  profile_canonical_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_file_profiles_p1_identity_unique
    UNIQUE (organization_id, intake_file_id, parser_name, parser_version, checksum),
  CONSTRAINT intake_file_profiles_p1_run_identity_unique
    UNIQUE (file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum),
  CONSTRAINT intake_file_profiles_p1_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_file_profiles_p1_parser_run_fk
    FOREIGN KEY (parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
    REFERENCES kai.intake_parser_runs (parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
    ON DELETE RESTRICT,
  CONSTRAINT intake_file_profiles_p1_parser_name_check
    CHECK (length(parser_name) BETWEEN 1 AND 128 AND parser_name = lower(btrim(parser_name)) AND parser_name ~ '^[a-z0-9_]+$'),
  CONSTRAINT intake_file_profiles_p1_parser_version_check
    CHECK (length(parser_version) BETWEEN 1 AND 64 AND parser_version = lower(btrim(parser_version)) AND parser_version ~ '^[a-z0-9._-]+$'),
  CONSTRAINT intake_file_profiles_p1_checksum_check
    CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT intake_file_profiles_p1_profile_object_check
    CHECK (jsonb_typeof(profile) = 'object'),
  CONSTRAINT intake_file_profiles_p1_profile_metadata_only_check
    CHECK (kai.gate_a_p0_jsonb_metadata_only(profile)),
  CONSTRAINT intake_file_profiles_p1_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS ix_intake_file_profiles_p1_tenant_file
  ON kai.intake_file_profiles (organization_id, intake_file_id);

CREATE INDEX IF NOT EXISTS ix_intake_file_profiles_p1_parser_run
  ON kai.intake_file_profiles (parser_run_id);

ALTER TABLE kai.intake_parser_runs
  ADD CONSTRAINT intake_parser_runs_p1_output_profile_fk
  FOREIGN KEY (output_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
  REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
  ON DELETE RESTRICT;

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_operation_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
    CHECK (operation IN (
      'reserve_upload',
      'start_upload',
      'complete_object_version',
      'confirm_upload',
      'block_upload',
      'abandon_upload',
      'expire_upload',
      'policy_decision_compare_and_set',
      'parser_run_recorded',
      'file_profile_persisted'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND kai.gate_a_p0_jsonb_metadata_only(metadata)
      AND (
        operation <> 'policy_decision_compare_and_set'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_policy_status'
          AND metadata ? 'policy_decision_outcome'
          AND metadata ? 'object_version_bound'
          AND metadata ? 'verified_checksum_bound'
          AND metadata ? 'verified_size_bytes_bound'
          AND metadata ? 'declared_mime'
          AND metadata ? 'extension'
          AND metadata ? 'replay_contract_version'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'sanitized_result'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_policy_status',
            'policy_decision_outcome',
            'object_version_bound',
            'verified_checksum_bound',
            'verified_size_bytes_bound',
            'declared_mime',
            'extension',
            'replay_contract_version',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'parser_run_recorded'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'parser_name'
          AND metadata ? 'parser_version'
          AND metadata ? 'checksum_bound'
          AND metadata ? 'parser_status'
          AND metadata ? 'retry_count'
          AND metadata ? 'error_code'
          AND metadata ? 'error_message_safe'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'parser_name',
            'parser_version',
            'checksum_bound',
            'parser_status',
            'retry_count',
            'error_code',
            'error_message_safe',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'file_profile_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'parser_name'
          AND metadata ? 'parser_version'
          AND metadata ? 'checksum_bound'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'profile'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'parser_name',
            'parser_version',
            'checksum_bound',
            'profile_canonical_sha256',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
    );

COMMIT;
