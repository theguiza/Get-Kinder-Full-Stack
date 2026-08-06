BEGIN;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation = 'generated_content_draft_created';

DELETE FROM kai.review_queue_items
 WHERE queue_type = 'generated_content_review';

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_01_metadata_object_check;

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
      'conflict_review_candidate_created'
    ));

DROP INDEX IF EXISTS kai.ux_review_queue_items_p3_01_generated_content_review_identity;

ALTER TABLE IF EXISTS kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_01_generated_content_review_contract_check;

DROP TABLE IF EXISTS kai.generated_content_citations;
DROP TABLE IF EXISTS kai.generated_content_blocks;
DROP TABLE IF EXISTS kai.generated_content_drafts;
DROP TABLE IF EXISTS kai.generation_runs;

COMMIT;
