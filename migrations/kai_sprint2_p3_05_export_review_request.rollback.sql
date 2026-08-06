BEGIN;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation = 'export_review_requested';

DELETE FROM kai.review_queue_items
 WHERE queue_type = 'export_review';

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_05_metadata_object_check;

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
      'generated_content_review_completed'
    ));

ALTER TABLE IF EXISTS kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_05_export_review_contract_check;

DROP INDEX IF EXISTS kai.ux_review_queue_items_p3_05_export_review_identity;

COMMIT;
