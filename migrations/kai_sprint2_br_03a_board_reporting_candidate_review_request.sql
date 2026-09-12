BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before BR-03A board-reporting-candidate-review migration';
  END IF;
  IF to_regclass('kai.board_reporting_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.board_reporting_candidates is required before BR-03A board-reporting-candidate-review migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.review_queue_items'::regclass
       AND conname = 'review_queue_items_p1_06_queue_type_check'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_type_check is required before BR-03A';
  END IF;
END $$;

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p1_06_queue_type_check,
  ADD CONSTRAINT review_queue_items_p1_06_queue_type_check
    CHECK (queue_type IN (
      'intake_file_review',
      'source_candidate_review',
      'sensitivity_review',
      'data_dictionary_review',
      'evidence_review',
      'claim_review',
      'client_followup',
      'conflict_resolution',
      'generated_content_review',
      'export_review',
      'board_reporting_candidate_review'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_br_03a_board_reporting_candidate_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'board_reporting_candidate_review';

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_br_03a_board_reporting_candidate_review_contract_check,
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
