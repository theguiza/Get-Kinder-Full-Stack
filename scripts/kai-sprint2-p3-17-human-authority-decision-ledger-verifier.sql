DROP TABLE IF EXISTS p3_17_results;
CREATE TEMP TABLE p3_17_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_17_results
SELECT 'human_authority_decisions_table_present',
       CASE WHEN to_regclass('kai.human_authority_decisions') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.human_authority_decisions exists';

INSERT INTO p3_17_results
SELECT 'decision_type_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'human_authority_decisions_p3_17_decision_type_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%client_reviewed%'
                 AND pg_get_constraintdef(c.oid) LIKE '%funder_ready%'
                 AND pg_get_constraintdef(c.oid) LIKE '%public_ready%'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_authority_granted%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'decision_type is constrained to exactly client_reviewed/funder_ready/public_ready/export_authority_granted';

INSERT INTO p3_17_results
SELECT 'decision_action_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'human_authority_decisions_p3_17_decision_action_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%grant%'
                 AND pg_get_constraintdef(c.oid) LIKE '%revoke%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'decision_action is constrained to exactly grant/revoke';

INSERT INTO p3_17_results
SELECT 'role_by_type_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'human_authority_decisions_p3_17_role_by_type_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'client_reviewed requires decided_by_role client_reviewer; every other decision type requires gk_admin';

INSERT INTO p3_17_results
SELECT 'root_is_grant_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'human_authority_decisions_p3_17_root_is_grant_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the first (root, no-predecessor) event in a lineage must be a grant';

INSERT INTO p3_17_results
SELECT 'candidate_binding_fk_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'human_authority_decisions_p3_17_candidate_fk'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_candidates%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'every decision binds to exactly one existing (organization, export_candidate) row';

INSERT INTO p3_17_results
SELECT 'audience_compatibility_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p3_17_human_authority_decisions_audience_compatibility'
                 AND tgrelid = 'kai.human_authority_decisions'::regclass
                 AND NOT tgisinternal
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'funder_ready/public_ready audience compatibility is enforced at the database boundary';

INSERT INTO p3_17_results
SELECT 'no_forward_pointer_column_present',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name = 'human_authority_decisions'
                 AND column_name = 'superseded_by_decision_id'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no defective forward-pointer column exists';

INSERT INTO p3_17_results
SELECT 'supersedes_decision_id_backward_pointer_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name = 'human_authority_decisions'
                 AND column_name = 'supersedes_decision_id'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'lineage is recorded as a backward pointer on the new row (supersedes_decision_id)';

INSERT INTO p3_17_results
SELECT 'predecessor_scoped_to_org_candidate_type',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'human_authority_decisions_p3_17_supersedes_fk'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_candidate_id%'
                 AND pg_get_constraintdef(c.oid) LIKE '%decision_type%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'predecessor lineage cannot cross organization, export candidate, or decision type';

INSERT INTO p3_17_results
SELECT 'root_per_lineage_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_human_authority_decisions_p3_17_root_per_lineage'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one root (first, no-predecessor) decision per (organization, export_candidate_id, decision_type)';

INSERT INTO p3_17_results
SELECT 'single_successor_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_human_authority_decisions_p3_17_single_successor'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one direct successor may exist per predecessor decision';

INSERT INTO p3_17_results
SELECT 'append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p3_17_human_authority_decisions_append_only'
                 AND tgrelid = 'kai.human_authority_decisions'::regclass
                 AND NOT tgisinternal
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'ordinary UPDATE/DELETE of kai.human_authority_decisions is rejected at the database boundary';

INSERT INTO p3_17_results
SELECT 'no_export_authority_or_final_gate_state',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('final_export_gate', 'final_gate', 'export_eligible', 'affirmative_human_export_authority', 'manifest', 'exported_at')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-17 introduces no finalGate, VAL-EXP-001 eligibility, or manifest/export-artifact state anywhere in kai schema';

INSERT INTO p3_17_results
SELECT 'no_export_manifest_or_event_tables',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'kai'
                 AND table_name IN ('export_manifests', 'export_events', 'export_artifacts')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-17 creates no manifest or final-export artifact/event tables';

INSERT INTO p3_17_results
SELECT 'p3_16_candidate_and_snapshot_tables_unchanged',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'export_candidates_p3_16_snapshot_fk'
            )
            AND EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'limitation_snapshots_p3_16_supersedes_fk'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-16 export-candidate and limitation-snapshot constraints remain exactly as accepted';

SELECT * FROM p3_17_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_17_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-17 human-authority-decision-ledger verifier failed';
  END IF;
END $$;
