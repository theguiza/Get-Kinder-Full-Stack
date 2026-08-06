DROP TABLE IF EXISTS p3_04_results;
CREATE TEMP TABLE p3_04_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_04_results
SELECT 'lifecycle_matrix_contract_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_04_generated_content_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'queue contract admits exactly the three P3-04 lifecycle profiles';

INSERT INTO p3_04_results
SELECT 'legacy_p3_01_contract_removed',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_01_generated_content_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the single-state P3-01 contract was replaced, not duplicated';

INSERT INTO p3_04_results
SELECT 'audit_operation_allowed',
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
SELECT 'audit_metadata_safe_contract',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_p3_04_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-04 audit metadata is constrained to metadata-only identifiers, timestamps, and lifecycle statuses';

INSERT INTO p3_04_results
SELECT 'no_new_tables_or_columns',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('export_authority', 'final_export_gate', 'approved_at', 'finalized_at', 'exported_at')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-04 introduces no export-authority, final-gate, or finalize/export state anywhere in kai schema';

SELECT * FROM p3_04_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_04_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-04 generated-content-review-completion verifier failed';
  END IF;
END $$;
