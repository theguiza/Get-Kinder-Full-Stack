BEGIN;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation = 'generated_content_review_completed';

UPDATE kai.review_queue_items
   SET queue_status = 'open',
       review_status = 'needs_gk_review'
 WHERE queue_type = 'generated_content_review'
   AND (queue_status, review_status) <> ('open', 'needs_gk_review');

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_04_metadata_object_check;

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
      'generated_content_draft_created'
    ));

ALTER TABLE IF EXISTS kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_04_generated_content_review_contract_check,
  ADD CONSTRAINT review_queue_items_p3_01_generated_content_review_contract_check
    CHECK (
      queue_type <> 'generated_content_review'
      OR (
        target_object_type = 'generated_content_draft'
        AND queue_status = 'open'
        AND review_status = 'needs_gk_review'
        AND priority = 'medium'
        AND summary = 'Generated draft requires human review.'
        AND required_action = 'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.'
        AND assigned_to IS NULL
        AND due_at IS NULL
        AND created_by_type = 'system'
      )
    );

COMMIT;
