DROP TABLE IF EXISTS brcem_smoke_results;
CREATE TEMP TABLE brcem_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO brcem_smoke_results
SELECT 'candidate_a_manifest_bound_to_root_grant',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.board_reporting_candidate_export_manifests m
               WHERE m.board_reporting_candidate_export_manifest_id = '15090000-0000-4000-8000-000000000701'
                 AND m.board_reporting_candidate_id = '15030000-0000-4000-8000-000000000323'
                 AND m.effective_authority_decision_id = '15070000-0000-4000-8000-000000000601'
                 AND m.effective_authority_decision_type = 'export_authority_granted'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the seeded candidate-A manifest is bound to the exact effective root grant decision';

INSERT INTO brcem_smoke_results
SELECT 'candidate_b_has_no_manifest',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM kai.board_reporting_candidate_export_manifests
               WHERE board_reporting_candidate_id = '15030000-0000-4000-8000-000000000322'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a manifest for candidate A creates no manifest row on candidate B';

-- Replay: submitting the exact same effective-authority state (same
-- candidate, same canonical_fingerprint) again converges to the existing
-- row instead of minting a second one.
INSERT INTO kai.board_reporting_candidate_export_manifests (
  organization_id, board_reporting_candidate_id, effective_authority_decision_id,
  effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint,
  created_by, created_by_type
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000323',
  '15070000-0000-4000-8000-000000000601',
  'export_authority_granted',
  'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1',
  repeat('e', 64),
  '00000000-0000-4000-8000-000000000901',
  'human'
)
ON CONFLICT (organization_id, board_reporting_candidate_id, canonical_fingerprint) DO NOTHING;

INSERT INTO brcem_smoke_results
SELECT 'replay_converges_to_single_row',
       CASE WHEN (
              SELECT COUNT(*) FROM kai.board_reporting_candidate_export_manifests
               WHERE board_reporting_candidate_id = '15030000-0000-4000-8000-000000000323'
                 AND canonical_fingerprint = repeat('e', 64)
            ) = 1
            THEN 'PASS' ELSE 'FAIL' END,
       'replaying the same effective-authority state for candidate A converges to exactly one manifest row';

SELECT * FROM brcem_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM brcem_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'board-reporting-candidate-export-manifest-foundation smoke verifier failed';
  END IF;
END $$;
