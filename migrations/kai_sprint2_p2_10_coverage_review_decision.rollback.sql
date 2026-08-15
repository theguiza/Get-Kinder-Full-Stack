BEGIN;

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check;

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
      'evidence_review_completed',
      'claim_review_completed_internal_approval'
    ));

DROP TRIGGER IF EXISTS trg_p2_10_coverage_review_decisions_append_only ON kai.coverage_review_decisions;
DROP FUNCTION IF EXISTS kai.p2_10_reject_coverage_decision_mutation();
DROP INDEX IF EXISTS kai.ix_coverage_review_decisions_p2_10_tenant_claim;
DROP TABLE IF EXISTS kai.coverage_review_decisions;

COMMIT;
