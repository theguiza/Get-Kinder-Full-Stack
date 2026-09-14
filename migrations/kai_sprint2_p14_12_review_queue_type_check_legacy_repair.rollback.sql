BEGIN;

-- P14-12 rollback restores the exact obsolete allowlist this migration
-- removed - its complete original vocabulary IS known (unlike P14-10's
-- unrecorded legacy target_object_type allowlist), because it is reproduced
-- verbatim in scripts/kai-sprint2-legacy-cutover-legacy-shape-seed.sql as the
-- USER_CONFIRMED production capture of kai.review_queue_items.
--
-- Restoring it is nonetheless refused whenever it would immediately reject
-- data this repository's supported Board review contract has since written:
-- any row already persisted with queue_type = 'board_reporting_candidate_review'
-- would violate the restored allowlist the instant it is added, because that
-- allowlist never included this value. Refuse rather than corrupt the table
-- into an unenforceable or immediately-violated state.
DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P14-12 rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.review_queue_items
     WHERE queue_type = 'board_reporting_candidate_review'
  ) THEN
    RAISE EXCEPTION 'P14-12 rollback refused: kai.review_queue_items already holds board_reporting_candidate_review rows; restoring the obsolete review_queue_items_queue_type_check allowlist (which never admitted this queue_type) would immediately conflict with data written under the repaired schema. Resolve or explicitly authorize data handling before attempting any reversal.';
  END IF;
END $$;

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_queue_type_check,
  ADD CONSTRAINT review_queue_items_queue_type_check
    CHECK (queue_type = ANY (ARRAY[
      'intake_file_review','source_candidate_review','sensitivity_review',
      'data_dictionary_review','evidence_review','claim_review',
      'client_followup','conflict_resolution','generated_content_review',
      'export_review'
    ]));

COMMIT;
