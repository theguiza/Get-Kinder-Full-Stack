BEGIN;

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
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

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
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

ALTER TABLE IF EXISTS kai.claims
  DROP CONSTRAINT IF EXISTS claims_p2_03_claim_strength_check,
  ADD CONSTRAINT claims_p2_03_claim_strength_check
    CHECK (claim_strength IN ('unassessed', 'reviewed_supported'));

ALTER TABLE IF EXISTS kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_support_strength_check,
  ADD CONSTRAINT evidence_items_p2_01_support_strength_check
    CHECK (support_strength IN ('unassessed', 'reviewed_supported'));

ALTER TABLE IF EXISTS kai.claims
  DROP CONSTRAINT IF EXISTS claims_p2_03_claim_review_status_check,
  ADD CONSTRAINT claims_p2_03_claim_review_status_check
    CHECK (claim_review_status = 'needs_gk_review');

ALTER TABLE IF EXISTS kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_review_status_check,
  ADD CONSTRAINT evidence_items_p2_01_review_status_check
    CHECK (evidence_review_status = 'needs_gk_review');

DROP TRIGGER IF EXISTS claim_review_decisions_p2_12_append_only ON kai.claim_review_decisions;
DROP FUNCTION IF EXISTS kai.p2_12_reject_claim_review_decision_mutation();

DROP TABLE IF EXISTS kai.claim_review_decisions;

DROP TRIGGER IF EXISTS evidence_review_decisions_p2_12_append_only ON kai.evidence_review_decisions;
DROP FUNCTION IF EXISTS kai.p2_12_reject_evidence_review_decision_mutation();

DROP TABLE IF EXISTS kai.evidence_review_decisions;

DROP FUNCTION IF EXISTS kai.p2_12_all_array_entries_non_blank(text[]);

COMMIT;
