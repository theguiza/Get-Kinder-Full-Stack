BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before P2-09 human-review migration';
  END IF;
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before P2-09 human-review migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-09 human-review migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-09 human-review migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-09 human-review migration';
  END IF;
END $$;

-- P2-09 owner decision: the only P2-01/P2-03 constraints that block the human
-- evidence-review / claim-review-internal-approval transition from persisting
-- are the two single-value CHECK constraints below, which pin
-- evidence_items.support_strength and claims.claim_strength to the literal
-- 'unassessed' forever. P2-06's own eligibility evaluator
-- (Backend/kai/dictionary/postgresClaimTraceabilityRepository.js) raises its
-- 'support_strength_unassessed' blocker exactly when either column still reads
-- 'unassessed' - so this is the exact, and only, schema widening this package
-- requires. 'reviewed_supported' is the single new value this package adds to
-- each column: the human reviewer's positive support-strength finding, applied
-- once per evidence item / once per claim, by the review completion below.
--
-- Deliberately NOT touched: evidence_items.evidence_review_status and
-- claims.claim_review_status/claim_status. P2-06's own
-- 'evidence_review_unresolved'/'claim_review_unresolved' blockers are driven
-- entirely by the linked kai.review_queue_items row's own `review_status`
-- column (already 'resolved'-capable per the existing P1-06
-- review_queue_items_p1_06_review_status_check), never by these claims/
-- evidence_items columns. Widening them here would additionally require
-- reopening P2-05's own claimContractOk check
-- (Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js), which
-- requires claim_status = 'proposed' AND claim_review_status =
-- 'needs_gk_review' for its own conflict-candidate detection - a P2-05
-- foundation this package must not disturb. Leaving these two columns pinned
-- keeps this migration's blast radius to exactly the one blocker it is
-- authorized to clear.
ALTER TABLE kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_support_strength_check,
  ADD CONSTRAINT evidence_items_p2_01_support_strength_check
    CHECK (support_strength IN ('unassessed', 'reviewed_supported'));

ALTER TABLE kai.claims
  DROP CONSTRAINT IF EXISTS claims_p2_03_claim_strength_check,
  ADD CONSTRAINT claims_p2_03_claim_strength_check
    CHECK (claim_strength IN ('unassessed', 'reviewed_supported'));

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

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check
    CHECK (
      operation <> 'evidence_review_completed'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'evidence_item_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'previous_support_strength'
        AND metadata ? 'resulting_support_strength'
        AND metadata ? 'validator_key'
      )
    );

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_claim_review_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p2_09_claim_review_metadata_object_check
    CHECK (
      operation <> 'claim_review_completed_internal_approval'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'claim_id'
        AND metadata ? 'evidence_item_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'previous_claim_strength'
        AND metadata ? 'resulting_claim_strength'
        AND metadata ? 'validator_key'
      )
    );

COMMIT;
