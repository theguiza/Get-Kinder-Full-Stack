BEGIN;

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_16_export_candidate_metadata_check;

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_16_limitation_snapshot_metadata_check;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation IN ('limitation_snapshot_confirmed', 'export_candidate_created');

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
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
      'file_profile_persisted',
      'data_dictionary_draft_persisted',
      'intake_sensitivity_profile_persisted',
      'sensitivity_review_queue_item_created',
      'intake_source_candidate_persisted',
      'source_promotion_decision_persisted',
      'evidence_lineage_extracted',
      'claim_proposed',
      'claim_gap_and_followup_generated',
      'conflict_review_candidate_created',
      'generated_content_draft_created',
      'generated_content_review_completed',
      'export_review_requested',
      'export_review_started',
      'export_review_completed'
    ));

DROP TABLE IF EXISTS kai.export_candidates;
DROP TRIGGER IF EXISTS trg_p3_16_limitation_snapshot_entries_append_only ON kai.limitation_snapshot_entries;
DROP TABLE IF EXISTS kai.limitation_snapshot_entries;
DROP TRIGGER IF EXISTS trg_p3_16_limitation_snapshots_append_only ON kai.limitation_snapshots;
DROP INDEX IF EXISTS kai.ux_limitation_snapshots_p3_16_single_successor;
DROP INDEX IF EXISTS kai.ux_limitation_snapshots_p3_16_root_per_draft;
DROP TABLE IF EXISTS kai.limitation_snapshots;
DROP FUNCTION IF EXISTS kai.p3_16_reject_authority_mutation();
DROP FUNCTION IF EXISTS kai.p3_16_limitation_codes_valid(text[]);

COMMIT;
