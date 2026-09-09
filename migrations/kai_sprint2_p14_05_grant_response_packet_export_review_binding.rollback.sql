BEGIN;

-- Restores the exact P3-13 'export_review' contract (single-draft target
-- only), undoing only the P14-05 widening above. No table, column, trigger,
-- or unrelated constraint is touched.
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p14_05_export_review_contract_check,
  ADD CONSTRAINT review_queue_items_p3_13_export_review_contract_check
    CHECK (
      queue_type <> 'export_review'
      OR (
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
    );

COMMIT;
