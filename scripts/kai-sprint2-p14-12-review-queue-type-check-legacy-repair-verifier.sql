DROP TABLE IF EXISTS p14_12_results;
CREATE TEMP TABLE p14_12_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_12_results
SELECT 'legacy_queue_type_allowlist_constraint_removed',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_queue_type_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the obsolete pre-P1-06 review_queue_items_queue_type_check fixed allowlist no longer exists on kai.review_queue_items';

INSERT INTO p14_12_results
SELECT 'canonical_queue_type_constraint_present_and_validated',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_p1_06_queue_type_check'
                 AND convalidated
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'review_queue_items_p1_06_queue_type_check exists and is validated';

INSERT INTO p14_12_results
SELECT 'canonical_queue_type_constraint_admits_board_reporting_candidate_review',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_p1_06_queue_type_check'
                 AND pg_get_constraintdef(oid) LIKE '%board_reporting_candidate_review%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'review_queue_items_p1_06_queue_type_check admits board_reporting_candidate_review';

INSERT INTO p14_12_results
SELECT 'br_03b_lifecycle_contract_check_still_present_and_validated',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND contype = 'c'
                 AND convalidated
                 AND pg_get_constraintdef(oid) LIKE '%board_reporting_candidate_review%'
                 AND pg_get_constraintdef(oid) LIKE '%target_object_type = ''board_reporting_candidate''%'
                 AND pg_get_constraintdef(oid) LIKE '%queue_status = ''open''%'
                 AND pg_get_constraintdef(oid) LIKE '%queue_status = ''in_progress''%'
                 AND pg_get_constraintdef(oid) LIKE '%queue_status = ''resolved''%'
                 AND pg_get_constraintdef(oid) LIKE '%review_status = ''resolved''%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the BR-03B Board review lifecycle contract check remains present and validated, unmodified by this migration';

INSERT INTO p14_12_results
SELECT 'pre_existing_non_board_queue_types_still_admitted',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_p1_06_queue_type_check'
                 AND pg_get_constraintdef(oid) LIKE '%''intake_file_review''%'
                 AND pg_get_constraintdef(oid) LIKE '%''sensitivity_review''%'
                 AND pg_get_constraintdef(oid) LIKE '%''source_candidate_review''%'
                 AND pg_get_constraintdef(oid) LIKE '%''data_dictionary_review''%'
                 AND pg_get_constraintdef(oid) LIKE '%''evidence_review''%'
                 AND pg_get_constraintdef(oid) LIKE '%''claim_review''%'
                 AND pg_get_constraintdef(oid) LIKE '%''client_followup''%'
                 AND pg_get_constraintdef(oid) LIKE '%''conflict_resolution''%'
                 AND pg_get_constraintdef(oid) LIKE '%''generated_content_review''%'
                 AND pg_get_constraintdef(oid) LIKE '%''export_review''%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'every pre-existing non-Board queue_type literal remains admitted; vocabulary was not widened beyond the already-authorized set';

INSERT INTO p14_12_results
SELECT 'board_reporting_candidate_review_row_no_longer_rejected_by_queue_type_check',
       CASE WHEN (
              SELECT bool_and(
                pg_get_constraintdef(c.oid) IS NULL
                OR c.conname <> 'review_queue_items_queue_type_check'
              )
              FROM pg_constraint c
              WHERE c.conrelid = 'kai.review_queue_items'::regclass AND c.contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no remaining CHECK constraint named review_queue_items_queue_type_check could reject a board_reporting_candidate_review row';

SELECT * FROM p14_12_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_12_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-12 review-queue queue_type legacy-constraint repair verifier failed';
  END IF;
END $$;
