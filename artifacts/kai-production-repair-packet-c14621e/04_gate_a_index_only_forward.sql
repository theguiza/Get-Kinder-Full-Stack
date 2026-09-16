BEGIN;

CREATE INDEX IF NOT EXISTS ix_upload_policy_decision_replay_gate_a_object_facts
ON kai.upload_policy_decision_replay (
  organization_id,
  intake_file_id,
  object_version_id,
  verified_checksum,
  verified_size_bytes
);

COMMIT;
