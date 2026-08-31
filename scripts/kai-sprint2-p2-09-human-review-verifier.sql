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

-- KAI P2-12 (Problem A1) superseded this assertion: evidence_review_status is
-- now widened to also admit 'reviewed' (see
-- kai_sprint2_p2_12_human_review_decision_ledger.sql), because "queue
-- resolved alone" is no longer sufficient proof of review - a decision-
-- ledger row is now also required. This script's own migration list includes
-- p2_12, so the constraint is asserted in its POST-p2_12 shape here.
INSERT INTO p2_09_results
SELECT 'evidence_review_status_widened_by_p2_12',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'evidence_items'
                 AND c.conname = 'evidence_items_p2_01_review_status_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%needs_gk_review%'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'evidence_items.evidence_review_status admits needs_gk_review and reviewed (widened by P2-12) - P2-06 additionally requires a decision-ledger head, not this column alone';

-- KAI P2-12 superseded the claim_review_status half of this assertion (now
-- widened to admit 'reviewed'); claim_status stays deliberately pinned to
-- 'proposed' - P2-05 conflict-candidate detection still depends on it.
INSERT INTO p2_09_results
SELECT 'claim_status_unchanged_claim_review_status_widened_by_p2_12',
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
                 AND pg_get_constraintdef(c.oid) LIKE '%needs_gk_review%'
                 AND pg_get_constraintdef(c.oid) LIKE '%reviewed%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'claims.claim_status is deliberately left pinned (P2-05 depends on it); claim_review_status is widened by P2-12';

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

-- KAI P2-12 superseded this assertion: it deliberately DOES add a decision
-- table (kai.evidence_review_decisions/kai.claim_review_decisions) - the
-- repaired contract this package originally warned was missing.
INSERT INTO p2_09_results
SELECT 'p2_12_decision_ledger_tables_present',
       CASE WHEN to_regclass('kai.evidence_review_decisions') IS NOT NULL
                AND to_regclass('kai.claim_review_decisions') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'P2-12 introduces kai.evidence_review_decisions/kai.claim_review_decisions - the append-only decision ledger';

SELECT * FROM p2_09_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p2_09_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P2-09 human-review verifier failed';
  END IF;
END $$;
