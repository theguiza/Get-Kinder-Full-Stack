DROP TABLE IF EXISTS p2_10_results;
CREATE TEMP TABLE p2_10_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p2_10_results
SELECT 'coverage_review_decisions_table_exists',
       CASE WHEN to_regclass('kai.coverage_review_decisions') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.coverage_review_decisions exists';

-- decision_value_pinned proves the decision CHECK constraint's vocabulary is
-- the EXACT closed two-value set {accepted_internal_with_limitation,
-- accepted_funder_with_limitation} and no other value - not merely that
-- those two substrings appear somewhere in the constraint text (a LIKE-based
-- substring check would silently keep passing even if a third value were
-- ever added to the constraint). It parses the actual
-- pg_get_constraintdef() `= ANY (ARRAY[...])` expression Postgres normalizes
-- an `IN (...)` CHECK into, extracts every literal in that array, and
-- compares the resulting set against the expected two-element set for exact
-- equality in both directions (every expected value present, no unexpected
-- value present).
WITH decision_constraint AS (
  SELECT c.oid, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'coverage_review_decisions'
     AND c.conname = 'coverage_review_decisions_p2_10_decision_check'
),
decision_array_body AS (
  SELECT regexp_replace(def, '^.*=\s*ANY\s*\(ARRAY\[(.*)\]\)\).*$', '\1') AS array_body
    FROM decision_constraint
   WHERE def ~ '=\s*ANY\s*\(ARRAY\['
),
decision_raw_values AS (
  SELECT trim(both '''' from split_part(trim(elem), '::', 1)) AS val
    FROM decision_array_body, unnest(string_to_array(array_body, ',')) AS elem
),
decision_values AS (
  SELECT array_agg(val ORDER BY val) AS vals FROM decision_raw_values
)
INSERT INTO p2_10_results
SELECT 'decision_value_pinned',
       CASE WHEN EXISTS (
              SELECT 1 FROM decision_values
               WHERE vals = ARRAY['accepted_funder_with_limitation', 'accepted_internal_with_limitation']::text[]
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'decision column CHECK vocabulary is the exact closed two-value set {accepted_internal_with_limitation, accepted_funder_with_limitation} - no other value is permitted';

INSERT INTO p2_10_results
SELECT 'decided_by_role_pinned_to_gk_reviewer',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'coverage_review_decisions'
                 AND c.conname = 'coverage_review_decisions_p2_10_decided_by_role_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%gk_reviewer%'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%gk_admin%'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%gk_operator%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'decided_by_role is pinned to gk_reviewer only - never gk_admin/gk_operator';

INSERT INTO p2_10_results
SELECT 'identity_fingerprint_unique',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'coverage_review_decisions'
                 AND c.conname = 'coverage_review_decisions_p2_10_identity_fingerprint_unique'
                 AND c.contype = 'u'
                 AND pg_get_constraintdef(c.oid) LIKE '%organization_id, claim_id, dimension_key, state_fingerprint, decision%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       '(organization_id, claim_id, dimension_key, state_fingerprint, decision) is unique - exact replay is audience/authority-specific';

INSERT INTO p2_10_results
SELECT 'gap_log_item_fk_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'coverage_review_decisions'
                 AND c.conname = 'coverage_review_decisions_p2_10_gap_fk'
                 AND c.contype = 'f'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a coverage decision can only ever bind to a claim/dimension that already has a current P2-04 gap row';

INSERT INTO p2_10_results
SELECT 'append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_trigger t
                JOIN pg_class r ON r.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'coverage_review_decisions'
                 AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.coverage_review_decisions rejects UPDATE/DELETE outright - append-only';

INSERT INTO p2_10_results
SELECT 'audit_operation_allowed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%coverage_review_decision_accepted_internal_with_limitation%'
                 AND pg_get_constraintdef(c.oid) LIKE '%coverage_review_decision_accepted_funder_with_limitation%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'upload_lifecycle_audit accepts both P2-10 internal and funder operations';

INSERT INTO p2_10_results
SELECT 'audit_metadata_contract_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'coverage_review_decision_accepted_internal_with_limitation audit rows are constrained to metadata-only keys';

INSERT INTO p2_10_results
SELECT 'no_raw_content_columns',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name = 'coverage_review_decisions'
                 AND column_name IN ('rationale', 'question_text', 'safe_summary', 'raw_value', 'source_location')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.coverage_review_decisions persists no claim/evidence text, question text, raw values, or storage locations';

INSERT INTO p2_10_results
SELECT 'no_authority_scope_double_encoding',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name = 'coverage_review_decisions'
                 AND column_name IN ('audience', 'requested_audience', 'authority_scope', 'approved_audience')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'coverage authority scope is encoded only by decision value - no contradictory audience/scope column exists';

INSERT INTO p2_10_results
SELECT 'no_funder_public_export_state_introduced',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('approved_funder', 'approved_public', 'export_ready_internal', 'export_authority', 'final_export_gate')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P2-10 introduces no funder/public/export-authority column anywhere in kai schema';

INSERT INTO p2_10_results
SELECT 'p2_02_p2_04_p2_05_untouched',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'gap_log_items'
                 AND c.conname = 'gap_log_items_p2_04_assessment_status_check'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%resolved_risk_flagged%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'gap_log_items assessment_status vocabulary is unchanged (resolved_risk_flagged/unresolved only)';

SELECT * FROM p2_10_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p2_10_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P2-10 coverage-review-decision verifier failed';
  END IF;
END $$;
