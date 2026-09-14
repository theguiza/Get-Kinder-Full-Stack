-- Reproduction-only fixture for the local-Postgres regression
-- (scripts/kai-sprint2-p14-12-review-queue-type-check-legacy-repair-local-postgres.js).
-- This is NOT a migration and must never run against a real database: it
-- exists solely to transform an otherwise-normal, fully-migrated (through
-- BR-03B) local test schema into the exact USER_CONFIRMED production-drift
-- condition - the obsolete pre-P1-06 review_queue_items_queue_type_check
-- fixed allowlist left in place alongside the canonical, validated
-- review_queue_items_p1_06_queue_type_check (already widened by BR-03A to
-- admit board_reporting_candidate_review) and the validated BR-03B Board
-- review lifecycle contract.
--
-- Unlike P14-10's target_object_type sibling, this allowlist's exact original
-- vocabulary IS known: it is reproduced verbatim from the USER_CONFIRMED
-- production capture recorded in
-- scripts/kai-sprint2-legacy-cutover-legacy-shape-seed.sql.
BEGIN;

ALTER TABLE kai.review_queue_items
  ADD CONSTRAINT review_queue_items_queue_type_check
  CHECK (queue_type = ANY (ARRAY[
    'intake_file_review','source_candidate_review','sensitivity_review',
    'data_dictionary_review','evidence_review','claim_review',
    'client_followup','conflict_resolution','generated_content_review',
    'export_review'
  ]));

COMMIT;
