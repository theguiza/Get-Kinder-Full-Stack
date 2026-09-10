DROP TABLE IF EXISTS p14_08a_smoke_results;
CREATE TEMP TABLE p14_08a_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_08a_smoke_results
SELECT 'candidate_a_manifest_bound_to_candidate_a_own_decision',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.grant_response_packet_export_manifests m
               WHERE m.grant_response_packet_export_manifest_id = '14080000-0000-4000-8000-000000000701'
                 AND m.grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501'
                 AND m.effective_authority_decision_id = '14070000-0000-4000-8000-000000000601'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the seeded manifest is bound to exactly candidate A and its own effective decision';

INSERT INTO p14_08a_smoke_results
SELECT 'candidate_b_has_no_manifest',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM kai.grant_response_packet_export_manifests
               WHERE grant_response_packet_export_candidate_id = '14070000-0000-4000-8000-000000000503'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'candidate A''s manifest creates no manifest row for candidate B';

-- Replay: the same effective decision for the same candidate converges to
-- the SAME row via ON CONFLICT DO NOTHING - no second row is ever created.
INSERT INTO kai.grant_response_packet_export_manifests (
  organization_id, grant_response_packet_export_candidate_id,
  effective_authority_decision_id, effective_authority_decision_type,
  fingerprint_contract_version, canonical_fingerprint, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000501',
  '14070000-0000-4000-8000-000000000601',
  'export_authority_granted',
  'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1',
  repeat('d', 64),
  '00000000-0000-4000-8000-000000000901'
)
ON CONFLICT (organization_id, grant_response_packet_export_candidate_id, canonical_fingerprint) DO NOTHING;

INSERT INTO p14_08a_smoke_results
SELECT 'replay_converges_to_exactly_one_row',
       CASE WHEN (
              SELECT COUNT(*) FROM kai.grant_response_packet_export_manifests
               WHERE grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501'
            ) = 1
            THEN 'PASS' ELSE 'FAIL' END,
       'resubmitting the same effective-authority state for the same candidate never creates a second manifest row';

SELECT * FROM p14_08a_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_08a_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-08A grant-response-packet-export-manifest-foundation smoke verifier failed';
  END IF;
END $$;
