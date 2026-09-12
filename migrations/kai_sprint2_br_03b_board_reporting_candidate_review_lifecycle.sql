BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before BR-03B board-reporting-candidate-review-lifecycle migration';
  END IF;
  IF to_regclass('kai.board_reporting_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.board_reporting_candidates is required before BR-03B board-reporting-candidate-review-lifecycle migration';
  END IF;
  IF to_regclass('kai.board_reporting_candidate_members') IS NULL THEN
    RAISE EXCEPTION 'kai.board_reporting_candidate_members is required before BR-03B board-reporting-candidate-review-lifecycle migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.review_queue_items'::regclass
       AND conname = 'review_queue_items_p1_06_queue_type_check'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_type_check is required before BR-03B';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'kai'
       AND tablename = 'review_queue_items'
       AND indexname = 'ux_review_queue_items_br_03a_board_reporting_candidate_review_identity'
  ) THEN
    RAISE EXCEPTION 'BR-03A board-reporting-candidate-review identity index is required before BR-03B';
  END IF;
END $$;

-- Fail closed unless the validated predecessor review_queue_items queue_type
-- contract actually admits 'board_reporting_candidate_review'. This proves
-- the assumption behind the BR-03B lifecycle CHECK below by inspection of
-- the live predicate, rather than by comment - the same discipline P3-05/
-- P3-09/P3-13 established for export_review.
DO $$
DECLARE
  existing_predicate text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'review_queue_items'
     AND c.conname = 'review_queue_items_p1_06_queue_type_check'
     AND c.convalidated;

  IF existing_predicate IS NULL THEN
    RAISE EXCEPTION 'validated kai.review_queue_items_p1_06_queue_type_check is required before BR-03B';
  END IF;

  IF position('''board_reporting_candidate_review''' IN existing_predicate) = 0 THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_type_check does not admit board_reporting_candidate_review; refusing BR-03B';
  END IF;
END $$;

-- Fail closed unless the exact BR-03A REQUEST-only contract check is present
-- and validated, so this migration only ever widens a known predecessor
-- predicate rather than assuming its shape.
DO $$
DECLARE
  existing_predicate text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'review_queue_items'
     AND c.conname = 'review_queue_items_br_03a_board_reporting_candidate_review_contract_check'
     AND c.convalidated;

  IF existing_predicate IS NULL THEN
    RAISE EXCEPTION 'validated kai.review_queue_items_br_03a_board_reporting_candidate_review_contract_check is required before BR-03B';
  END IF;

  IF position('''open''' IN existing_predicate) = 0 OR position('''needs_gk_review''' IN existing_predicate) = 0 THEN
    RAISE EXCEPTION 'BR-03A board-reporting-candidate-review contract check does not admit the expected REQUEST state; refusing BR-03B';
  END IF;
END $$;

-- BR-03B: widen the BR-03A REQUEST-only Board review contract to admit the
-- full REQUEST -> START -> COMPLETE lifecycle matrix
-- (open/needs_gk_review, in_progress/needs_gk_review, resolved/resolved) -
-- the exact vocabulary P3-05/P3-09/P3-13 already established for
-- export_review and P3-01/P3-04 for generated_content_review. Every other
-- static field (target_object_type, priority, summary, required_action,
-- blocked_reason, assigned_to, due_at, queue_metadata, created_by,
-- created_by_type) remains pinned exactly as BR-03A established it. This is
-- a queue_status/review_status transition only: it creates no release
-- authority, final eligibility, manifest, or delivery state anywhere in the
-- kai schema, and this turn only implements the transition into START -
-- no COMPLETE code path exists yet.
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_br_03a_board_reporting_candidate_review_contract_check,
  DROP CONSTRAINT IF EXISTS review_queue_items_br_03b_board_reporting_candidate_review_contract_check,
  ADD CONSTRAINT review_queue_items_br_03b_board_reporting_candidate_review_contract_check
    CHECK (
      queue_type <> 'board_reporting_candidate_review'
      OR (
        target_object_type = 'board_reporting_candidate'
        AND (
          (queue_status = 'open' AND review_status = 'needs_gk_review')
          OR (queue_status = 'in_progress' AND review_status = 'needs_gk_review')
          OR (queue_status = 'resolved' AND review_status = 'resolved')
        )
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
