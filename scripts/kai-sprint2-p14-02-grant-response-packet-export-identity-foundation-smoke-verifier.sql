DROP TABLE IF EXISTS p14_02_smoke_results;
CREATE TEMP TABLE p14_02_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_02_smoke_results
SELECT 'exactly_one_row_for_the_seeded_triple',
       CASE WHEN (
              SELECT count(*) FROM kai.grant_response_packet_export_identities
               WHERE organization_id = '00000000-0000-4000-8000-000000000001'
                 AND engagement_id = '14020000-0000-4000-8000-000000000001'
                 AND packet_audience = 'funder'
            ) = 1
            THEN 'PASS' ELSE 'FAIL' END,
       'exactly one durable identity row exists for the (organization, engagement, funder) triple after two seed attempts';

INSERT INTO p14_02_smoke_results
SELECT 'replay_converged_to_first_minted_identity',
       CASE WHEN EXISTS (
              SELECT 1 FROM kai.grant_response_packet_export_identities
               WHERE grant_response_packet_export_identity_id = '14020000-0000-4000-8000-000000000301'
                 AND organization_id = '00000000-0000-4000-8000-000000000001'
                 AND engagement_id = '14020000-0000-4000-8000-000000000001'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the first-minted identity id (...301) survived; the replay attempt (...302) was a no-op, never a second row';

INSERT INTO p14_02_smoke_results
SELECT 'second_seed_attempt_did_not_create_a_row',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM kai.grant_response_packet_export_identities
               WHERE grant_response_packet_export_identity_id = '14020000-0000-4000-8000-000000000302'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the replay-seed row (...302) was never inserted; ON CONFLICT DO NOTHING converged on the existing identity';

SELECT * FROM p14_02_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_02_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-02 grant-response-packet-export-identity-foundation smoke verifier failed';
  END IF;
END $$;
