BEGIN;

-- Fail closed if rollback would strand persisted state: any row already in
-- the BR-03B START or COMPLETE state (in_progress/needs_gk_review or
-- resolved/resolved) would immediately violate the restored BR-03A
-- REQUEST-only contract check below. Refuse rather than silently corrupt or
-- delete review-queue rows.
DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before BR-03B rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.review_queue_items
     WHERE queue_type = 'board_reporting_candidate_review'
       AND NOT (queue_status = 'open' AND review_status = 'needs_gk_review')
  ) THEN
    RAISE EXCEPTION 'BR-03B rollback refused: board_reporting_candidate_review rows exist outside the BR-03A REQUEST state (in_progress/needs_gk_review or resolved/resolved)';
  END IF;
END $$;

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_br_03b_board_reporting_candidate_review_contract_check,
  ADD CONSTRAINT review_queue_items_br_03a_board_reporting_candidate_review_contract_check
    CHECK (
      queue_type <> 'board_reporting_candidate_review'
      OR (
        target_object_type = 'board_reporting_candidate'
        AND queue_status = 'open'
        AND review_status = 'needs_gk_review'
        AND priority = 'medium'
        AND summary = 'Board Reporting candidate requires review.'
        AND required_action = 'Review internal Board packet membership and current-use support before release work.'
        AND blocked_reason IS NULL
        AND assigned_to IS NULL
        AND due_at IS NULL
        AND queue_metadata = '{}'::jsonb
        AND created_by IS NULL
        AND created_by_type = 'system'
      )
    );

COMMIT;
