BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P14-05 grant-response-packet-export-review-binding migration';
  END IF;
  IF to_regclass('kai.grant_response_packet_export_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.grant_response_packet_export_candidates (P14-03) is required before P14-05 grant-response-packet-export-review-binding migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'review_queue_items_p3_13_export_review_contract_check'
  ) THEN
    RAISE EXCEPTION 'P3-13 export_review contract check is required before P14-05 grant-response-packet-export-review-binding migration';
  END IF;
END $$;

-- P14-05 scope (Grant Response Packet Track, packet-level export-review
-- binding): this migration makes exactly one additive change - it widens the
-- existing kai.review_queue_items 'export_review' CHECK contract
-- (review_queue_items_p3_13_export_review_contract_check, itself the P3-13
-- widening of the P3-05/P3-09 contract) so a review_queue_items row with
-- queue_type = 'export_review' may ALSO legally carry
-- target_object_type = 'grant_response_packet_export_candidate' targeting the
-- existing, immutable P14-03 grant_response_packet_export_candidates row by
-- id - in addition to, never instead of, the existing
-- target_object_type = 'generated_content_draft' single-draft contract, which
-- is preserved verbatim (every static field and the full open/in_progress/
-- resolved lifecycle matrix, byte-for-byte unchanged).
--
-- This does NOT create a new queue_type, a new review_queue_items table, a
-- new lifecycle enum, or a parallel packet review state machine - it reuses
-- the one existing governed 'export_review' queue_type and its one existing
-- lifecycle matrix (open/needs_gk_review, in_progress/needs_gk_review,
-- resolved/resolved) for the packet target exactly as it already applies to
-- the single-draft target. No column is added to review_queue_items, no
-- polymorphic/conditional foreign key is added on target_object_id (per the
-- P1-06 convention already documented on this table: target_object_id
-- deliberately has no table-wide FK because different queue_types point at
-- different target tables) - the application layer transactionally proves,
-- before every insert, that the referenced
-- grant_response_packet_export_candidates row exists and is tenant/
-- engagement-matched, exactly like the existing 'sensitivity_review'
-- convention this table already documents. This migration touches no P14-01/
-- P14-02/P14-03/P14-04 table, no packet fingerprint/membership logic, no
-- packet manifest/final-release table, and no upload_lifecycle_audit
-- constraint (the packet-level export-review audit event uses the existing,
-- already-general kai.audit_events path the P14-03/P14-04 packet-candidate
-- audit already uses, not the single-draft upload_lifecycle_audit table).
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_13_export_review_contract_check,
  DROP CONSTRAINT IF EXISTS review_queue_items_p14_05_export_review_contract_check,
  ADD CONSTRAINT review_queue_items_p14_05_export_review_contract_check
    CHECK (
      queue_type <> 'export_review'
      OR (
        (
          target_object_type = 'generated_content_draft'
          AND (
            (queue_status = 'open' AND review_status = 'needs_gk_review')
            OR (queue_status = 'in_progress' AND review_status = 'needs_gk_review')
            OR (queue_status = 'resolved' AND review_status = 'resolved')
          )
          AND priority = 'medium'
          AND summary = 'Generated draft requires export review.'
          AND required_action = 'Review audience authority, current eligibility, citations, and the final export gate before any export.'
          AND blocked_reason IS NULL
          AND assigned_to IS NULL
          AND due_at IS NULL
          AND queue_metadata = '{}'::jsonb
          AND created_by IS NULL
          AND created_by_type = 'system'
        )
        OR (
          target_object_type = 'grant_response_packet_export_candidate'
          AND (
            (queue_status = 'open' AND review_status = 'needs_gk_review')
            OR (queue_status = 'in_progress' AND review_status = 'needs_gk_review')
            OR (queue_status = 'resolved' AND review_status = 'resolved')
          )
          AND priority = 'medium'
          AND summary = 'Grant Response Packet export candidate requires export review.'
          AND required_action = 'Review packet membership, funder audience, and export authority before any export.'
          AND blocked_reason IS NULL
          AND assigned_to IS NULL
          AND due_at IS NULL
          AND queue_metadata = '{}'::jsonb
          AND created_by IS NULL
          AND created_by_type = 'system'
        )
      )
    );

COMMIT;
