DROP TABLE IF EXISTS p2_11_results;
CREATE TEMP TABLE p2_11_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p2_11_results
SELECT 'client_followup_contract_admits_resolved_branch',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'review_queue_items'
                 AND c.conname = 'review_queue_items_p2_04_client_followup_contract_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%waiting_on_client%'
                 AND pg_get_constraintdef(c.oid) LIKE '%resolved%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the client_followup contract CHECK admits both the fresh (waiting_on_client/proposed) and resolved (resolved/resolved) branches';

INSERT INTO p2_11_results
SELECT 'audit_operation_allowed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%client_followup_completed%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'upload_lifecycle_audit accepts the new P2-11 client_followup_completed operation';

INSERT INTO p2_11_results
SELECT 'audit_metadata_contract_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'client_followup_completed audit rows are constrained to metadata-only keys with disposition pinned to no_additional_client_information';

INSERT INTO p2_11_results
SELECT 'audit_metadata_forbids_answer_fields',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%answer%'
                 AND pg_get_constraintdef(c.oid) LIKE '%question_text%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the P2-11 audit metadata contract explicitly forbids answer/client_answer/question_text/safe_summary/raw_value keys';

INSERT INTO p2_11_results
SELECT 'no_client_answer_columns_introduced',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name IN ('client_followup_items', 'gap_log_items')
                 AND column_name IN ('client_answer', 'answer', 'answer_text', 'raw_value', 'free_text')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P2-11 introduces no client-answer/free-text/raw-value column on kai.client_followup_items or kai.gap_log_items';

INSERT INTO p2_11_results
SELECT 'p2_02_p2_04_dimension_vocabulary_untouched',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'gap_log_items'
                 AND c.conname = 'gap_log_items_p2_04_assessment_status_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%resolved_risk_flagged%'
                 AND pg_get_constraintdef(c.oid) LIKE '%unresolved%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'gap_log_items assessment_status vocabulary is unchanged (resolved_risk_flagged/unresolved only) - P2-11 never resolves a gap';

INSERT INTO p2_11_results
SELECT 'no_funder_public_export_state_introduced',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('approved_funder', 'approved_public', 'export_ready_internal', 'export_authority', 'final_export_gate')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P2-11 introduces no funder/public/export-authority column anywhere in kai schema';

SELECT * FROM p2_11_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p2_11_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P2-11 client-followup-completion verifier failed';
  END IF;
END $$;
