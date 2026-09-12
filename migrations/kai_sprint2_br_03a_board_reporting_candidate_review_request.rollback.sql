BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before BR-03A rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.review_queue_items
     WHERE queue_type = 'board_reporting_candidate_review'
  ) THEN
    RAISE EXCEPTION 'BR-03A rollback refused: board_reporting_candidate_review rows exist in kai.review_queue_items';
  END IF;
END $$;

DROP INDEX IF EXISTS kai.ux_review_queue_items_br_03a_board_reporting_candidate_review_identity;

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_br_03a_board_reporting_candidate_review_contract_check,
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
      'export_review'
    ));

COMMIT;
