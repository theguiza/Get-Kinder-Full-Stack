DROP TABLE IF EXISTS p14_07b1_results;
CREATE TEMP TABLE p14_07b1_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_07b1_results
SELECT 'grant_response_packet_human_authority_decisions_table_present',
       CASE WHEN to_regclass('kai.grant_response_packet_human_authority_decisions') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.grant_response_packet_human_authority_decisions exists';

INSERT INTO p14_07b1_results
SELECT 'id_org_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_id_org_unique'
                 AND conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (decision_id, organization_id) is present';

INSERT INTO p14_07b1_results
SELECT 'id_org_candidate_type_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_id_org_candidate_type_unique'
                 AND conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND contype = 'u'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type) lineage-target key is present';

INSERT INTO p14_07b1_results
SELECT 'candidate_fk_is_tenant_safe_composite_into_p14_03_table',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grppehad_p14_07b1_candidate_fk'
                 AND c.conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.grant_response_packet_export_candidates'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (grant_response_packet_export_candidate_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the candidate FK is a tenant-safe composite FK into kai.grant_response_packet_export_candidates (P14-03), never kai.export_candidates';

INSERT INTO p14_07b1_results
SELECT 'supersedes_fk_pins_org_candidate_and_type',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'grppehad_p14_07b1_supersedes_fk'
                 AND c.conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (supersedes_decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the supersession lineage FK pins organization/candidate/decision-type together - lineage can never fork across candidates or decision types';

INSERT INTO p14_07b1_results
SELECT 'not_self_superseding_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_not_self_superseding'
                 AND conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a decision can never supersede itself';

INSERT INTO p14_07b1_results
SELECT 'decision_type_pinned_to_export_authority_granted',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_decision_type_check'
                 AND conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((decision_type = ''export_authority_granted''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no packet_approved/packet_funder_ready/packet_finalized vocabulary - only export_authority_granted exists';

INSERT INTO p14_07b1_results
SELECT 'decision_action_vocabulary_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_decision_action_check'
                 AND conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'decision_action is checked to grant/revoke';

INSERT INTO p14_07b1_results
SELECT 'role_pinned_to_gk_admin',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_role_check'
                 AND conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((decided_by_role = ''gk_admin''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'export_authority_granted is decided by gk_admin only, mirroring the existing P3-17 role contract';

INSERT INTO p14_07b1_results
SELECT 'root_is_grant_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_root_is_grant_check'
                 AND conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND contype = 'c'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a root (no predecessor) decision can never be a revoke';

INSERT INTO p14_07b1_results
SELECT 'created_by_type_pinned_to_human',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'grppehad_p14_07b1_created_by_type_check'
                 AND conrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
                 AND contype = 'c'
                 AND pg_get_constraintdef(oid) = 'CHECK ((created_by_type = ''human''::text))'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no assistant/system actor can ever create a row here';

INSERT INTO p14_07b1_results
SELECT 'root_per_lineage_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai' AND indexname = 'ux_grppehad_p14_07b1_root_per_lineage'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one root decision per (organization, candidate, decision_type) lineage';

INSERT INTO p14_07b1_results
SELECT 'single_successor_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai' AND indexname = 'ux_grppehad_p14_07b1_single_successor'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one direct successor per predecessor decision';

INSERT INTO p14_07b1_results
SELECT 'append_only_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p14_07b1_grppehad_append_only'
                 AND tgrelid = 'kai.grant_response_packet_human_authority_decisions'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the append-only BEFORE UPDATE OR DELETE trigger is present';

INSERT INTO p14_07b1_results
SELECT 'no_requested_audience_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'grant_response_packet_human_authority_decisions'
                 AND column_name = 'requested_audience'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no requested_audience column - a Grant Response Packet audience is always exactly funder';

INSERT INTO p14_07b1_results
SELECT 'human_authority_decisions_p3_17_unaltered',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'human_authority_decisions_p3_17_candidate_fk'
                 AND conrelid = 'kai.human_authority_decisions'::regclass
                 AND confrelid = 'kai.export_candidates'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the existing P3-17 kai.human_authority_decisions -> kai.export_candidates FK is completely unchanged';

SELECT * FROM p14_07b1_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_07b1_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-07B1 grant-response-packet-human-authority-decision-ledger verifier failed';
  END IF;
END $$;
