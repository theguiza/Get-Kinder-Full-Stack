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

-- Candidate A - the exact packet export candidate this package's manifest
-- proofs are bound to (the same row P14-03/P14-07B1's own smoke-seeds mint).
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

-- Candidate B - a second, distinct candidate under the SAME packet identity,
-- used to prove a manifest bound to candidate A can never represent
-- candidate B.
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

-- Root grant on candidate A only - the exact effective authority decision
-- this package's manifest FK binds to.
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

-- Candidate A's manifest, bound to candidate A's own effective decision.
INSERT INTO kai.grant_response_packet_export_manifests (
  grant_response_packet_export_manifest_id, organization_id, grant_response_packet_export_candidate_id,
  effective_authority_decision_id, effective_authority_decision_type,
  fingerprint_contract_version, canonical_fingerprint, created_by
)
VALUES (
  '14080000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000501',
  '14070000-0000-4000-8000-000000000601',
  'export_authority_granted',
  'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1',
  repeat('d', 64),
  '00000000-0000-4000-8000-000000000901'
)
ON CONFLICT (organization_id, grant_response_packet_export_candidate_id, canonical_fingerprint) DO NOTHING;

COMMIT;
