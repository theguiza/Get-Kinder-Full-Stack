BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'BR-04 Smoke Org', 'br-04-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('15030000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'br-04-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

-- Candidate A - the exact resolved/resolved (COMPLETE) BR-03B smoke candidate,
-- the same row the BR-04 smoke-seed mints, so this manifest package's own
-- runner (which installs BR-04's migration/smoke chain first) converges on
-- the same candidate and decision rows rather than minting duplicates.
INSERT INTO kai.board_reporting_candidates (
  board_reporting_candidate_id, organization_id, engagement_id, packet_audience,
  idempotency_key, fingerprint_contract_version, canonical_fingerprint,
  candidate_status, created_by, created_by_type, created_at
)
VALUES (
  '15030000-0000-4000-8000-000000000323', '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000101', 'internal', 'br-03b-smoke-candidate-complete',
  'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1', repeat('d', 64),
  'created', '90000000-0000-4000-8000-000000000001', 'human', '2026-09-12T12:00:00.000Z'
)
ON CONFLICT (organization_id, engagement_id, idempotency_key) DO NOTHING;

-- Candidate B - a second, distinct Board candidate with no manifest of its
-- own, used to prove a manifest for candidate A can never attach to, or be
-- read as covering, candidate B.
INSERT INTO kai.board_reporting_candidates (
  board_reporting_candidate_id, organization_id, engagement_id, packet_audience,
  idempotency_key, fingerprint_contract_version, canonical_fingerprint,
  candidate_status, created_by, created_by_type, created_at
)
VALUES (
  '15030000-0000-4000-8000-000000000322', '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000101', 'internal', 'br-03b-smoke-candidate-start',
  'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1', repeat('c', 64),
  'created', '90000000-0000-4000-8000-000000000001', 'human', '2026-09-12T12:00:00.000Z'
)
ON CONFLICT (organization_id, engagement_id, idempotency_key) DO NOTHING;

-- Root grant on candidate A only (the exact BR-04 smoke-seed root decision).
INSERT INTO kai.board_reporting_candidate_human_authority_decisions (
  decision_id, organization_id, board_reporting_candidate_id, decision_type, decision_action,
  decided_by, decided_by_role
)
VALUES (
  '15070000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000323',
  'export_authority_granted',
  'grant',
  '00000000-0000-4000-8000-000000000901',
  'gk_admin'
)
ON CONFLICT DO NOTHING;

-- The manifest row itself: candidate A's export manifest, bound to the exact
-- effective grant decision above.
INSERT INTO kai.board_reporting_candidate_export_manifests (
  board_reporting_candidate_export_manifest_id, organization_id, board_reporting_candidate_id,
  effective_authority_decision_id, effective_authority_decision_type,
  fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type
)
VALUES (
  '15090000-0000-4000-8000-000000000701',
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

COMMIT;
