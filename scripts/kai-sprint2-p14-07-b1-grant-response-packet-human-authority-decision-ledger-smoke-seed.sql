BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'P14-03 Smoke Org', 'p14-03-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000002', 'P14-03 Smoke Other Org', 'p14-03-smoke-other-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('14030000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'p14-03-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

INSERT INTO kai.grant_response_packet_export_identities (
  grant_response_packet_export_identity_id, organization_id, engagement_id, packet_audience, created_by
)
VALUES (
  '14030000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000001',
  'funder',
  '00000000-0000-4000-8000-000000000901'
)
ON CONFLICT (organization_id, engagement_id, packet_audience) DO NOTHING;

-- Candidate A - the exact packet export candidate this package's lineage
-- proofs are bound to. Same row the P14-03 smoke-seed mints for the same
-- (org, identity, fingerprint) triple, so running after or independently of
-- that package's own smoke-seed converges on the same row.
INSERT INTO kai.grant_response_packet_export_candidates (
  grant_response_packet_export_candidate_id, organization_id, grant_response_packet_export_identity_id,
  fingerprint_contract_version, canonical_fingerprint, created_by
)
VALUES (
  '14030000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000201',
  'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1',
  repeat('b', 64),
  '00000000-0000-4000-8000-000000000901'
)
ON CONFLICT (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint) DO NOTHING;

-- Candidate B - a second, distinct candidate under the SAME packet identity
-- (a different semantic/fingerprint state), used to prove a decision for
-- candidate A can never attach to, or be read as authorizing, candidate B.
INSERT INTO kai.grant_response_packet_export_candidates (
  grant_response_packet_export_candidate_id, organization_id, grant_response_packet_export_identity_id,
  fingerprint_contract_version, canonical_fingerprint, created_by
)
VALUES (
  '14070000-0000-4000-8000-000000000503',
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000201',
  'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1',
  repeat('c', 64),
  '00000000-0000-4000-8000-000000000901'
)
ON CONFLICT (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint) DO NOTHING;

-- Root grant on candidate A only.
INSERT INTO kai.grant_response_packet_human_authority_decisions (
  decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action,
  decided_by, decided_by_role
)
VALUES (
  '14070000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000501',
  'export_authority_granted',
  'grant',
  '00000000-0000-4000-8000-000000000901',
  'gk_admin'
)
ON CONFLICT DO NOTHING;

COMMIT;
