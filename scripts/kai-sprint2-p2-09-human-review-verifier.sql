DROP TABLE IF EXISTS p2_09_results;
CREATE TEMP TABLE p2_09_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p2_09_results
SELECT 'evidence_support_strength_widened',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'evidence_items'
                 AND c.conname = 'evidence_items_p2_01_support_strength_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed_supported%'
                 AND pg_get_constraintdef(c.oid) LIKE '%unassessed%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_items.support_strength admits unassessed and reviewed_supported only';

INSERT INTO p2_09_results
SELECT 'claim_strength_widened',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'claims'
                 AND c.conname = 'claims_p2_03_claim_strength_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed_supported%'
                 AND pg_get_constraintdef(c.oid) LIKE '%unassessed%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claims.claim_strength admits unassessed and reviewed_supported only';

INSERT INTO p2_09_results
SELECT 'evidence_review_status_unchanged',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'evidence_items'
                 AND c.conname = 'evidence_items_p2_01_review_status_check'
                 AND pg_get_constraintdef(c.oid) = 'CHECK ((evidence_review_status = ''needs_gk_review''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_items.evidence_review_status is deliberately left pinned - P2-06 reads the review_queue_items row instead';

INSERT INTO p2_09_results
SELECT 'claim_status_and_claim_review_status_unchanged',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'claims'
                 AND c.conname = 'claims_p2_03_claim_status_check'
                 AND pg_get_constraintdef(c.oid) = 'CHECK ((claim_status = ''proposed''::text))'
            )
            AND EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'claims'
                 AND c.conname = 'claims_p2_03_claim_review_status_check'
                 AND pg_get_constraintdef(c.oid) = 'CHECK ((claim_review_status = ''needs_gk_review''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claims.claim_status/claim_review_status are deliberately left pinned - P2-05 conflict-candidate detection depends on them';

INSERT INTO p2_09_results
SELECT 'audit_operations_allowed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%evidence_review_completed%'
                 AND pg_get_constraintdef(c.oid) LIKE '%claim_review_completed_internal_approval%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'upload_lifecycle_audit accepts both new P2-09 operations';

INSERT INTO p2_09_results
SELECT 'evidence_review_metadata_contract_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_review_completed audit rows are constrained to metadata-only keys';

INSERT INTO p2_09_results
SELECT 'claim_review_metadata_contract_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claim_review_completed_internal_approval audit rows are constrained to metadata-only keys';

INSERT INTO p2_09_results
SELECT 'no_funder_public_export_state_introduced',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('approved_funder', 'approved_public', 'export_ready_internal', 'export_authority', 'final_export_gate')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P2-09 introduces no funder/public/export-authority column anywhere in kai schema';

INSERT INTO p2_09_results
SELECT 'no_new_tables',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.tables
               WHERE table_schema = 'kai'
                 AND table_name IN ('evidence_review_decisions', 'claim_review_decisions', 'human_review_decisions')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P2-09 reuses kai.evidence_items/kai.claims/kai.review_queue_items - no new decision table';

SELECT * FROM p2_09_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p2_09_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P2-09 human-review verifier failed';
  END IF;
END $$;
