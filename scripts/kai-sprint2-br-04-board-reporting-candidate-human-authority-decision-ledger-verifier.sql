DROP TABLE IF EXISTS br_04_results;
CREATE TEMP TABLE br_04_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO br_04_results
SELECT 'board_reporting_candidate_human_authority_decisions_table_present',
       CASE WHEN to_regclass('kai.board_reporting_candidate_human_authority_decisions') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.board_reporting_candidate_human_authority_decisions exists';

INSERT INTO br_04_results
SELECT 'id_org_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brchad_br_04_id_org_unique'
                 AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (decision_id, organization_id) is present';

INSERT INTO br_04_results
SELECT 'id_org_candidate_type_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brchad_br_04_id_org_candidate_type_unique'
                 AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (decision_id, organization_id, board_reporting_candidate_id, decision_type) lineage-target key is present';

INSERT INTO br_04_results
SELECT 'candidate_fk_is_tenant_safe_composite_into_br_02_table',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'brchad_br_04_candidate_fk'
                 AND c.conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.board_reporting_candidates'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (board_reporting_candidate_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the candidate FK is a tenant-safe composite FK into kai.board_reporting_candidates (BR-02), never kai.export_candidates or kai.grant_response_packet_export_candidates';

INSERT INTO br_04_results
SELECT 'supersedes_fk_pins_org_candidate_and_type',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'brchad_br_04_supersedes_fk'
                 AND c.conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (supersedes_decision_id, organization_id, board_reporting_candidate_id, decision_type)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the supersession lineage FK pins organization/candidate/decision-type together - lineage can never fork across candidates or decision types';

INSERT INTO br_04_results
SELECT 'not_self_superseding_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brchad_br_04_not_self_superseding'
                 AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a decision can never supersede itself';

INSERT INTO br_04_results
SELECT 'decision_type_pinned_to_export_authority_granted',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brchad_br_04_decision_type_check'
                 AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((decision_type = ''export_authority_granted''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no board_approved/board_release/board_finalized vocabulary - only export_authority_granted exists';

INSERT INTO br_04_results
SELECT 'decision_action_vocabulary_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brchad_br_04_decision_action_check'
                 AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'decision_action is checked to grant/revoke';

INSERT INTO br_04_results
SELECT 'role_pinned_to_gk_admin',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brchad_br_04_role_check'
                 AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((decided_by_role = ''gk_admin''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'export_authority_granted is decided by gk_admin only, mirroring the existing P3-17/P14-07B1 role contract';

INSERT INTO br_04_results
SELECT 'root_is_grant_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brchad_br_04_root_is_grant_check'
                 AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a root (no predecessor) decision can never be a revoke';

INSERT INTO br_04_results
SELECT 'created_by_type_pinned_to_human',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'brchad_br_04_created_by_type_check'
                 AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((created_by_type = ''human''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no assistant/system actor can ever create a row here';

INSERT INTO br_04_results
SELECT 'root_per_lineage_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai' AND indexname = 'ux_brchad_br_04_root_per_lineage'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one root decision per (organization, candidate, decision_type) lineage';

INSERT INTO br_04_results
SELECT 'single_successor_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai' AND indexname = 'ux_brchad_br_04_single_successor'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one direct successor per predecessor decision';

INSERT INTO br_04_results
SELECT 'append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_br_04_brchad_append_only'
                 AND tgrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the append-only BEFORE UPDATE OR DELETE trigger is present';

INSERT INTO br_04_results
SELECT 'no_packet_audience_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'board_reporting_candidate_human_authority_decisions'
                 AND column_name IN ('packet_audience', 'requested_audience')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no packet_audience/requested_audience column - a Board Reporting candidate audience is always exactly internal';

INSERT INTO br_04_results
SELECT 'human_authority_decisions_p3_17_unaltered',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'human_authority_decisions_p3_17_candidate_fk'
                 AND conrelid = 'kai.human_authority_decisions'::regclass
                 AND confrelid = 'kai.export_candidates'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the existing P3-17 kai.human_authority_decisions -> kai.export_candidates FK is completely unchanged';

INSERT INTO br_04_results
SELECT 'grant_response_packet_human_authority_decisions_unaltered',
       CASE WHEN to_regclass('kai.grant_response_packet_human_authority_decisions') IS NULL
            THEN 'PASS'
            WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_candidate_fk'
                 AND conrelid = to_regclass('kai.grant_response_packet_human_authority_decisions')
                 AND confrelid = to_regclass('kai.grant_response_packet_export_candidates')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the existing P14-07B1 kai.grant_response_packet_human_authority_decisions -> kai.grant_response_packet_export_candidates FK is completely unchanged if that package happens to be installed in this target (not part of BR-04''s own dependency chain)';

SELECT * FROM br_04_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM br_04_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'BR-04 board-reporting-candidate-human-authority-decision-ledger verifier failed';
  END IF;
END $$;
