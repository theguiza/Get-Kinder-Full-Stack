DROP TABLE IF EXISTS p14_07b1_smoke_results;
CREATE TEMP TABLE p14_07b1_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_07b1_smoke_results
SELECT 'candidate_a_root_grant_is_current_head',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.grant_response_packet_human_authority_decisions d
               WHERE d.grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501'
                 AND d.decision_id = '14070000-0000-4000-8000-000000000601'
                 AND d.decision_action = 'grant'
                 AND NOT EXISTS (
                       SELECT 1 FROM kai.grant_response_packet_human_authority_decisions s
                        WHERE s.supersedes_decision_id = d.decision_id
                     )
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the seeded root grant on candidate A is the exact current lineage head';

INSERT INTO p14_07b1_smoke_results
SELECT 'candidate_b_has_no_decision',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM kai.grant_response_packet_human_authority_decisions
               WHERE grant_response_packet_export_candidate_id = '14070000-0000-4000-8000-000000000503'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a decision on candidate A creates no decision row on candidate B';

INSERT INTO kai.grant_response_packet_human_authority_decisions (
  organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action,
  decided_by, decided_by_role, supersedes_decision_id
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000501',
  'export_authority_granted',
  'revoke',
  '00000000-0000-4000-8000-000000000901',
  'gk_admin',
  '14070000-0000-4000-8000-000000000601'
);

INSERT INTO p14_07b1_smoke_results
SELECT 'revoke_supersedes_grant_and_becomes_new_head',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.grant_response_packet_human_authority_decisions d
               WHERE d.grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501'
                 AND d.decision_action = 'revoke'
                 AND d.supersedes_decision_id = '14070000-0000-4000-8000-000000000601'
                 AND NOT EXISTS (SELECT 1 FROM kai.grant_response_packet_human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id)
            ) THEN 'PASS' ELSE 'FAIL' END,
       'a revoke recorded as a successor becomes the new current head, and the old grant is no longer the head';

INSERT INTO p14_07b1_smoke_results
SELECT 'old_grant_head_is_no_longer_current',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM kai.grant_response_packet_human_authority_decisions d
               WHERE d.decision_id = '14070000-0000-4000-8000-000000000601'
                 AND NOT EXISTS (SELECT 1 FROM kai.grant_response_packet_human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id)
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the superseded grant row is never mutated, but it is no longer the lineage head';

SELECT * FROM p14_07b1_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_07b1_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-07B1 grant-response-packet-human-authority-decision-ledger smoke verifier failed';
  END IF;
END $$;
