DROP TABLE IF EXISTS p14_03_smoke_results;
CREATE TEMP TABLE p14_03_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_03_smoke_results
SELECT 'exactly_one_candidate_row_for_the_seeded_triple',
       CASE WHEN (
              SELECT count(*) FROM kai.grant_response_packet_export_candidates
               WHERE organization_id = '00000000-0000-4000-8000-000000000001'
                 AND grant_response_packet_export_identity_id = '14030000-0000-4000-8000-000000000201'
                 AND canonical_fingerprint = repeat('b', 64)
            ) = 1
            THEN 'PASS' ELSE 'FAIL' END,
       'exactly one candidate row exists for the (organization, identity, fingerprint) triple after two seed attempts';

INSERT INTO p14_03_smoke_results
SELECT 'replay_converged_to_first_minted_candidate',
       CASE WHEN EXISTS (
              SELECT 1 FROM kai.grant_response_packet_export_candidates
               WHERE grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the first-minted candidate id (...501) survived; the replay attempt (...502) was a no-op';

INSERT INTO p14_03_smoke_results
SELECT 'second_seed_attempt_did_not_create_a_candidate_row',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM kai.grant_response_packet_export_candidates
               WHERE grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000502'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the replay-seed candidate row (...502) was never inserted';

INSERT INTO p14_03_smoke_results
SELECT 'exactly_one_member_row_for_the_candidate',
       CASE WHEN (
              SELECT count(*) FROM kai.grant_response_packet_export_candidate_members
               WHERE grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501'
            ) = 1
            THEN 'PASS' ELSE 'FAIL' END,
       'exactly one member snapshot row exists for the seeded candidate';

SELECT * FROM p14_03_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_03_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-03 grant-response-packet-export-candidate-foundation smoke verifier failed';
  END IF;
END $$;
