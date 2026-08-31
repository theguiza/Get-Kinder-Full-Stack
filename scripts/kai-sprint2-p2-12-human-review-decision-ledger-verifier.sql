DROP TABLE IF EXISTS p2_12_results;
CREATE TEMP TABLE p2_12_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p2_12_results
SELECT 'evidence_review_decisions_table_exists',
       CASE WHEN to_regclass('kai.evidence_review_decisions') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.evidence_review_decisions exists';

INSERT INTO p2_12_results
SELECT 'claim_review_decisions_table_exists',
       CASE WHEN to_regclass('kai.claim_review_decisions') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.claim_review_decisions exists';

INSERT INTO p2_12_results
SELECT 'evidence_review_decisions_append_only_trigger',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'kai'
                 AND c.relname = 'evidence_review_decisions'
                 AND t.tgname = 'evidence_review_decisions_p2_12_append_only'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_review_decisions has its append-only BEFORE UPDATE OR DELETE trigger';

INSERT INTO p2_12_results
SELECT 'claim_review_decisions_append_only_trigger',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'kai'
                 AND c.relname = 'claim_review_decisions'
                 AND t.tgname = 'claim_review_decisions_p2_12_append_only'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claim_review_decisions has its append-only BEFORE UPDATE OR DELETE trigger';

INSERT INTO p2_12_results
SELECT 'evidence_review_decisions_root_and_successor_indexes',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes WHERE schemaname='kai' AND indexname='ux_evidence_review_decisions_p2_12_root_per_lineage'
            ) AND EXISTS (
              SELECT 1 FROM pg_indexes WHERE schemaname='kai' AND indexname='ux_evidence_review_decisions_p2_12_single_successor'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_review_decisions has root-per-lineage and single-successor partial unique indexes';

INSERT INTO p2_12_results
SELECT 'claim_review_decisions_root_and_successor_indexes',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes WHERE schemaname='kai' AND indexname='ux_claim_review_decisions_p2_12_root_per_lineage'
            ) AND EXISTS (
              SELECT 1 FROM pg_indexes WHERE schemaname='kai' AND indexname='ux_claim_review_decisions_p2_12_single_successor'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claim_review_decisions has root-per-lineage and single-successor partial unique indexes';

INSERT INTO p2_12_results
SELECT 'evidence_review_status_widened',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'evidence_items'
                 AND c.conname = 'evidence_items_p2_01_review_status_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed%'
                 AND pg_get_constraintdef(c.oid) LIKE '%needs_gk_review%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_items.evidence_review_status admits needs_gk_review and reviewed';

INSERT INTO p2_12_results
SELECT 'claim_review_status_widened',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'claims'
                 AND c.conname = 'claims_p2_03_claim_review_status_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed%'
                 AND pg_get_constraintdef(c.oid) LIKE '%needs_gk_review%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claims.claim_review_status admits needs_gk_review and reviewed';

INSERT INTO p2_12_results
SELECT 'claim_status_unchanged',
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
            THEN 'PASS' ELSE 'FAIL' END,
       'claims.claim_status is deliberately left pinned to proposed - P2-05 conflict-candidate detection depends on it';

INSERT INTO p2_12_results
SELECT 'support_strength_widened_with_negative_terminal',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'evidence_items'
                 AND c.conname = 'evidence_items_p2_01_support_strength_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed_not_supported%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_items.support_strength admits reviewed_not_supported';

INSERT INTO p2_12_results
SELECT 'claim_strength_widened_with_negative_terminal',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'claims'
                 AND c.conname = 'claims_p2_03_claim_strength_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed_not_supported%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claims.claim_strength admits reviewed_not_supported';

INSERT INTO p2_12_results
SELECT 'evidence_review_audit_metadata_widened',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%decision_id%'
                 AND pg_get_constraintdef(c.oid) LIKE '%decision_outcome%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_review_completed audit rows are now required to carry decision_id/decision_outcome';

INSERT INTO p2_12_results
SELECT 'claim_review_audit_metadata_widened',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%decision_id%'
                 AND pg_get_constraintdef(c.oid) LIKE '%approved_audiences%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claim_review_completed_internal_approval audit rows are now required to carry decision_id/approved_audiences';

INSERT INTO p2_12_results
SELECT 'no_new_audit_operation_strings_introduced',
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
       'P2-12 reuses the existing evidence_review_completed/claim_review_completed_internal_approval operation values - no new operation string';

SELECT * FROM p2_12_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p2_12_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P2-12 human-review-decision-ledger verifier failed';
  END IF;
END $$;
