BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.client_followup_items') IS NULL THEN
    RAISE EXCEPTION 'kai.client_followup_items is required before P2-11 client-followup-completion migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-11 client-followup-completion migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-11 client-followup-completion migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-11 client-followup-completion migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p2_04_client_followup_contract_check'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items_p2_04_client_followup_contract_check is required before P2-11 client-followup-completion migration';
  END IF;
END $$;

-- P2-11 owner policy: an authorized organization-scoped `client_reviewer` may
-- resolve a CURRENT `client_followup` workflow by recording that the fixed
-- follow-up question was reviewed and NO ADDITIONAL CLIENT INFORMATION is
-- being supplied for this internal workflow. This is a workflow disposition,
-- never a client answer: it never mutates kai.client_followup_items,
-- kai.gap_log_items, or the P2-02 assessment_status those rows describe. The
-- ONLY row this package ever writes is the linked kai.review_queue_items row's
-- own queue_status/review_status/updated_at (plus the required same-
-- transaction metadata-only audit).
--
-- P2-04's own review_queue_items_p2_04_client_followup_contract_check pinned
-- every client_followup row to exactly queue_status='waiting_on_client' AND
-- review_status='proposed' at creation - the fresh, unresolved state. This
-- widening adds exactly one additional admitted branch for the resolved
-- disposition (queue_status='resolved', review_status='resolved'), leaving
-- every other client_followup field (target_object_type, priority, summary,
-- required_action, assigned_to, due_at) pinned exactly as P2-04 left them, and
-- leaving the original fresh branch completely untouched so every existing
-- P2-04 write is still admitted unchanged.
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p2_04_client_followup_contract_check,
  ADD CONSTRAINT review_queue_items_p2_04_client_followup_contract_check
    CHECK (
      queue_type <> 'client_followup'
      OR (
        target_object_type = 'client_followup_item'
        AND priority = 'medium'
        AND summary = 'Client clarification is required for an unresolved claim gap.'
        AND assigned_to IS NULL
        AND due_at IS NULL
        AND required_action IN (
          'Confirm the business meaning of the unresolved field or measure.',
          'Confirm the denominator and how it is calculated.',
          'Confirm the reporting period represented by this source.',
          'Confirm the entity level represented by the unresolved field or measure.'
        )
        AND (
          (queue_status = 'waiting_on_client' AND review_status = 'proposed')
          OR (queue_status = 'resolved' AND review_status = 'resolved')
        )
      )
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
      'claim_review_completed_internal_approval',
      'coverage_review_decision_accepted_internal_with_limitation',
      'client_followup_completed'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check
    CHECK (
      operation <> 'client_followup_completed'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'claim_id'
        AND metadata ? 'client_followup_item_id'
        AND metadata ? 'gap_log_item_id'
        AND metadata ? 'dimension_key'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'decided_by_role'
        AND metadata ? 'disposition'
        AND metadata ? 'replayed'
        AND metadata ? 'validator_key'
        AND metadata ->> 'disposition' = 'no_additional_client_information'
        AND NOT metadata ? 'answer'
        AND NOT metadata ? 'client_answer'
        AND NOT metadata ? 'question_text'
        AND NOT metadata ? 'safe_summary'
        AND NOT metadata ? 'raw_value'
      )
    );

COMMIT;
