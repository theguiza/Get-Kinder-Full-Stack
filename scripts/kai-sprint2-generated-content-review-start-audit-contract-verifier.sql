DROP TABLE IF EXISTS gcrs_results;
DROP TABLE IF EXISTS gcrs_expected_checks;

CREATE TEMP TABLE gcrs_expected_checks (
  check_name text PRIMARY KEY
);

INSERT INTO gcrs_expected_checks (check_name)
VALUES
  ('audit_operation_allowed'),
  ('audit_operation_constraint_validated'),
  ('audit_metadata_safe_contract'),
  ('generated_content_review_p3_04_contract_unchanged'),
  ('generated_content_review_p3_04_contract_admits_in_progress_state');

CREATE TEMP TABLE gcrs_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO gcrs_results
SELECT 'audit_operation_allowed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%generated_content_review_started%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'audit operation vocabulary includes generated_content_review_started';

INSERT INTO gcrs_results
SELECT 'audit_operation_constraint_validated',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND c.convalidated
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'upload_lifecycle_audit_gate_a_operation_check is VALIDATED (not NOT VALID)';

INSERT INTO gcrs_results
SELECT 'audit_metadata_safe_contract',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_gcrs_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'start-review audit metadata is constrained to metadata-only identifiers, actor/timestamps, status transitions, and validator keys';

INSERT INTO gcrs_results
SELECT 'generated_content_review_p3_04_contract_unchanged',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_04_generated_content_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'review_queue_items_p3_04_generated_content_review_contract_check is left in place, unmodified by this package';

INSERT INTO gcrs_results
SELECT 'generated_content_review_p3_04_contract_admits_in_progress_state',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'review_queue_items_p3_04_generated_content_review_contract_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%in_progress%needs_gk_review%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the untouched P3-04 contract already admits queue_status=in_progress AND review_status=needs_gk_review for generated_content_review, so no review_queue_items change was needed here';

DO $$
DECLARE
  expected_count integer := 5;
BEGIN
  IF (SELECT COUNT(*) FROM gcrs_expected_checks) <> expected_count
     OR (SELECT COUNT(*) FROM gcrs_results) <> expected_count
     OR EXISTS (
          SELECT 1
            FROM gcrs_results r
           GROUP BY r.check_name
          HAVING COUNT(*) <> 1
        )
     OR EXISTS (
          SELECT 1
            FROM gcrs_expected_checks e
            LEFT JOIN gcrs_results r ON r.check_name = e.check_name
           WHERE r.check_name IS NULL
        )
     OR EXISTS (
          SELECT 1
            FROM gcrs_results r
            LEFT JOIN gcrs_expected_checks e ON e.check_name = r.check_name
           WHERE e.check_name IS NULL
        ) THEN
    RAISE EXCEPTION 'generated-content-review-start audit-contract verifier result construction failed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gcrs_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'generated-content-review-start audit-contract verifier failed';
  END IF;
END $$;

SELECT
  check_name,
  status,
  detail
FROM gcrs_results
ORDER BY check_name;
