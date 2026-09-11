DROP TABLE IF EXISTS p14_10_results;
CREATE TEMP TABLE p14_10_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_10_results
SELECT 'legacy_stale_allowlist_constraint_removed',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_target_object_type_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the obsolete pre-P1-06 review_queue_items_target_object_type_check fixed allowlist no longer exists on kai.review_queue_items';

INSERT INTO p14_10_results
SELECT 'canonical_generic_target_object_type_constraint_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_p1_06_target_object_type_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'review_queue_items_p1_06_target_object_type_check exists';

INSERT INTO p14_10_results
SELECT 'canonical_generic_target_object_type_constraint_definition_exact',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_p1_06_target_object_type_check'
                 AND pg_get_constraintdef(oid) = 'CHECK (((length(target_object_type) >= 1) AND (length(target_object_type) <= 128)))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'review_queue_items_p1_06_target_object_type_check is the exact canonical length(1..128) bound, not a narrower allowlist';

INSERT INTO p14_10_results
SELECT 'p3_04_generated_content_review_contract_untouched',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_p3_04_generated_content_review_contract_chec'
                 AND pg_get_constraintdef(oid) LIKE '%target_object_type = ''generated_content_draft''%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the P3-04 generated-content-specific contract (queue_type=generated_content_review -> target_object_type=generated_content_draft, plus its lifecycle/static fields) is present and unmodified by this migration';

INSERT INTO p14_10_results
SELECT 'queue_type_vocabulary_still_permits_generated_content_review',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conrelid = 'kai.review_queue_items'::regclass
                 AND conname = 'review_queue_items_p1_06_queue_type_check'
                 AND pg_get_constraintdef(oid) LIKE '%''generated_content_review''%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'review_queue_items_p1_06_queue_type_check still permits generated_content_review, unmodified by this migration';

SELECT * FROM p14_10_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_10_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-10 review-queue target_object_type schema-repair verifier failed';
  END IF;
END $$;
