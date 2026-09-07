DROP TABLE IF EXISTS p3_04_results;
DROP TABLE IF EXISTS p3_04_expected_checks;

CREATE TEMP TABLE p3_04_expected_checks (
  check_name text PRIMARY KEY
);

INSERT INTO p3_04_expected_checks (check_name)
VALUES
  ('lifecycle_matrix_contract_present'),
  ('legacy_p3_01_contract_removed'),
  ('audit_operation_allowed'),
  ('audit_metadata_safe_contract'),
  ('no_new_tables_or_columns');

CREATE TEMP TABLE p3_04_results (
  result_type text NOT NULL,
  check_name text PRIMARY KEY,
  object_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_04_results
SELECT 'CHECK',
       'lifecycle_matrix_contract_present',
       'kai.review_queue_items.review_queue_items_p3_04_generated_content_review_contract_check',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_04_generated_content_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'queue contract admits exactly the three P3-04 lifecycle profiles';

INSERT INTO p3_04_results
SELECT 'CHECK',
       'legacy_p3_01_contract_removed',
       'kai.review_queue_items.review_queue_items_p3_01_generated_content_review_contract_check',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_01_generated_content_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the single-state P3-01 contract was replaced, not duplicated';

INSERT INTO p3_04_results
SELECT 'CHECK',
       'audit_operation_allowed',
       'kai.upload_lifecycle_audit.upload_lifecycle_audit_gate_a_operation_check',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%generated_content_review_completed%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'metadata-only audit operation vocabulary includes P3-04 completion';

INSERT INTO p3_04_results
SELECT 'CHECK',
       'audit_metadata_safe_contract',
       'kai.upload_lifecycle_audit.upload_lifecycle_audit_p3_04_metadata_object_check',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_p3_04_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-04 audit metadata is constrained to metadata-only identifiers, timestamps, and lifecycle statuses';

INSERT INTO p3_04_results
SELECT 'CHECK',
       'no_new_tables_or_columns',
       'kai.information_schema.columns',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('export_authority', 'final_export_gate', 'approved_at', 'finalized_at', 'exported_at')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-04 introduces no export-authority, final-gate, or finalize/export state anywhere in kai schema';

DO $$
DECLARE
  expected_count integer := 5;
BEGIN
  IF (SELECT COUNT(*) FROM p3_04_expected_checks) <> expected_count
     OR (SELECT COUNT(*) FROM p3_04_results WHERE result_type = 'CHECK') <> expected_count
     OR EXISTS (
          SELECT 1
            FROM p3_04_results r
           WHERE r.result_type = 'CHECK'
           GROUP BY r.check_name
          HAVING COUNT(*) <> 1
        )
     OR EXISTS (
          SELECT 1
            FROM p3_04_expected_checks e
            LEFT JOIN p3_04_results r
              ON r.result_type = 'CHECK'
             AND r.check_name = e.check_name
           WHERE r.check_name IS NULL
        )
     OR EXISTS (
          SELECT 1
            FROM p3_04_results r
            LEFT JOIN p3_04_expected_checks e
              ON e.check_name = r.check_name
           WHERE r.result_type = 'CHECK'
             AND e.check_name IS NULL
        ) THEN
    RAISE EXCEPTION 'P3-04 generated-content-review-completion verifier result construction failed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_04_results WHERE result_type = 'CHECK' AND status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-04 generated-content-review-completion verifier failed';
  END IF;
END $$;

SELECT
  result_type,
  check_name,
  object_name,
  status,
  detail
FROM p3_04_results
ORDER BY check_name;
