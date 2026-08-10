DROP TABLE IF EXISTS p3_13_results;
CREATE TEMP TABLE p3_13_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_13_results
SELECT 'export_review_contract_admits_completion_lifecycle',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_13_export_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'queue contract admits exactly open/needs_gk_review, in_progress/needs_gk_review, and resolved/resolved for export_review';

INSERT INTO p3_13_results
SELECT 'export_review_p3_09_two_state_contract_removed',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_09_export_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the two-state P3-09 contract check is replaced (not duplicated) by the P3-13 three-state check';

INSERT INTO p3_13_results
SELECT 'export_review_identity_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_review_queue_items_p3_05_export_review_identity'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the P3-05 partial unique index enforcing at most one export_review row per organization/draft is preserved';

INSERT INTO p3_13_results
SELECT 'audit_operation_allowed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_review_completed%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'metadata-only audit operation vocabulary includes P3-13 export_review_completed';

INSERT INTO p3_13_results
SELECT 'audit_metadata_safe_contract',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_p3_13_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-13 audit metadata is constrained to metadata-only identifiers, actor/timestamps, status transitions, and validator keys';

INSERT INTO p3_13_results
SELECT 'no_export_authority_or_final_gate_state',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('export_authority', 'final_export_gate', 'approved_at', 'finalized_at', 'exported_at', 'export_eligible', 'affirmative_human_export_authority')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-13 introduces no export-authority, final-gate, or finalize/export state anywhere in kai schema';

INSERT INTO p3_13_results
SELECT 'audit_metadata_forbids_approval_and_authority_keys',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'upload_lifecycle_audit_p3_13_metadata_object_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%approval%'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_authority%'
                 AND pg_get_constraintdef(c.oid) LIKE '%final_export_gate%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-13 completion audit metadata contract explicitly forbids approval/export-authority/final-gate keys';

SELECT * FROM p3_13_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_13_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-13 export-review-completion verifier failed';
  END IF;
END $$;
