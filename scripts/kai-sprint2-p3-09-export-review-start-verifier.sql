DROP TABLE IF EXISTS p3_09_results;
DROP TABLE IF EXISTS p3_09_expected_checks;

CREATE TEMP TABLE p3_09_expected_checks (
  check_name text PRIMARY KEY
);

INSERT INTO p3_09_expected_checks (check_name)
VALUES
  ('export_review_contract_admits_start_lifecycle'),
  ('export_review_p3_05_single_state_contract_removed'),
  ('export_review_identity_unique_index_present'),
  ('audit_operation_allowed'),
  ('audit_metadata_safe_contract'),
  ('no_export_authority_or_final_gate_state'),
  ('no_resolved_export_review_state_admitted');

CREATE TEMP TABLE p3_09_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_09_results
SELECT 'export_review_contract_admits_start_lifecycle',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_09_export_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'queue contract admits exactly open/needs_gk_review and in_progress/needs_gk_review for export_review';

INSERT INTO p3_09_results
SELECT 'export_review_p3_05_single_state_contract_removed',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_05_export_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the single-state P3-05 contract check is replaced (not duplicated) by the P3-09 two-state check';

INSERT INTO p3_09_results
SELECT 'export_review_identity_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_review_queue_items_p3_05_export_review_identity'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the P3-05 partial unique index enforcing at most one export_review row per organization/draft is preserved';

INSERT INTO p3_09_results
SELECT 'audit_operation_allowed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND c.convalidated
                 AND pg_get_constraintdef(c.oid) LIKE '%export_review_started%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'metadata-only audit operation vocabulary includes P3-09 export_review_started';

INSERT INTO p3_09_results
SELECT 'audit_metadata_safe_contract',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_p3_09_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-09 audit metadata is constrained to metadata-only identifiers, actor/timestamps, status transitions, and validator keys';

INSERT INTO p3_09_results
SELECT 'no_export_authority_or_final_gate_state',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('export_authority', 'final_export_gate', 'approved_at', 'finalized_at', 'exported_at')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-09 introduces no export-authority, final-gate, or finalize/export state anywhere in kai schema';

INSERT INTO p3_09_results
SELECT 'no_resolved_export_review_state_admitted',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'review_queue_items_p3_09_export_review_contract_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%resolved%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-09 does not admit a resolved/resolved (or any other) export_review lifecycle state';

DO $$
DECLARE
  expected_count integer := 7;
BEGIN
  IF (SELECT COUNT(*) FROM p3_09_expected_checks) <> expected_count
     OR (SELECT COUNT(*) FROM p3_09_results) <> expected_count
     OR EXISTS (
          SELECT 1
            FROM p3_09_results r
           GROUP BY r.check_name
          HAVING COUNT(*) <> 1
        )
     OR EXISTS (
          SELECT 1
            FROM p3_09_expected_checks e
            LEFT JOIN p3_09_results r ON r.check_name = e.check_name
           WHERE r.check_name IS NULL
        )
     OR EXISTS (
          SELECT 1
            FROM p3_09_results r
            LEFT JOIN p3_09_expected_checks e ON e.check_name = r.check_name
           WHERE e.check_name IS NULL
        ) THEN
    RAISE EXCEPTION 'P3-09 export-review-start verifier result construction failed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_09_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-09 export-review-start verifier failed';
  END IF;
END $$;

SELECT
  check_name,
  status,
  detail
FROM p3_09_results
ORDER BY check_name;
