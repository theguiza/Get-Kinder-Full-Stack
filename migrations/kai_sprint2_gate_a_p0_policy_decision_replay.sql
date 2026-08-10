BEGIN;

CREATE OR REPLACE FUNCTION kai.gate_a_p0_jsonb_metadata_only(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT value::text !~* '(raw_bytes|raw_text|raw_content|prompt|signed_url|credential|secret|token|password|private_path|pii|email|phone|address|-----BEGIN|postgres://|postgresql://|mysql://|mongodb://|https?://|/Users/|/private/|/var/|/tmp/|AKIA[0-9A-Z]{16}|[A-Za-z0-9+/]{80,}={0,2})';
$$;

CREATE TABLE IF NOT EXISTS kai.upload_policy_decision_replay (
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  object_version_id text NOT NULL,
  verified_checksum text NOT NULL,
  verified_size_bytes bigint NOT NULL,
  declared_mime text NOT NULL,
  extension text NOT NULL,
  file_policy_status text NOT NULL,
  sanitized_result jsonb NOT NULL,
  sanitized_result_canonical_sha256 text NOT NULL,
  replay_contract_version text NOT NULL DEFAULT 'in_memory_policy_replay_v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, intake_file_id),
  CONSTRAINT upload_policy_decision_replay_gate_a_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT upload_policy_decision_replay_gate_a_object_version_check
    CHECK (length(object_version_id) BETWEEN 1 AND 256 AND object_version_id ~ '^[!-~]+$'),
  CONSTRAINT upload_policy_decision_replay_gate_a_verified_checksum_check
    CHECK (verified_checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT upload_policy_decision_replay_gate_a_verified_size_check
    CHECK (verified_size_bytes >= 1),
  CONSTRAINT upload_policy_decision_replay_gate_a_declared_mime_check
    CHECK (length(declared_mime) BETWEEN 1 AND 255 AND declared_mime = lower(btrim(declared_mime))),
  CONSTRAINT upload_policy_decision_replay_gate_a_extension_check
    CHECK (length(extension) BETWEEN 2 AND 32 AND extension = lower(extension) AND extension LIKE '.%'),
  CONSTRAINT upload_policy_decision_replay_gate_a_policy_status_check
    CHECK (file_policy_status IN ('passed', 'blocked', 'failed')),
  CONSTRAINT upload_policy_decision_replay_gate_a_sanitized_result_object_check
    CHECK (jsonb_typeof(sanitized_result) = 'object'),
  CONSTRAINT upload_policy_decision_replay_gate_a_sanitized_result_metadata_only_check
    CHECK (kai.gate_a_p0_jsonb_metadata_only(sanitized_result)),
  CONSTRAINT upload_policy_decision_replay_gate_a_canonical_sha_check
    CHECK (sanitized_result_canonical_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT upload_policy_decision_replay_gate_a_contract_version_check
    CHECK (replay_contract_version = 'in_memory_policy_replay_v1')
);

CREATE INDEX IF NOT EXISTS ix_upload_policy_decision_replay_gate_a_object_facts
  ON kai.upload_policy_decision_replay (
    organization_id,
    intake_file_id,
    object_version_id,
    verified_checksum,
    verified_size_bytes
  );

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
      'policy_decision_compare_and_set'
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
    );

COMMIT;
