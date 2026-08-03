BEGIN;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation = 'policy_decision_compare_and_set';

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_operation_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
    CHECK (operation IN ('reserve_upload', 'start_upload', 'complete_object_version', 'confirm_upload', 'block_upload', 'abandon_upload', 'expire_upload'));

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object');

DROP INDEX IF EXISTS kai.ix_upload_policy_decision_replay_gate_a_object_facts;
DROP TABLE IF EXISTS kai.upload_policy_decision_replay;
DROP FUNCTION IF EXISTS kai.gate_a_p0_jsonb_metadata_only(jsonb);

COMMIT;
