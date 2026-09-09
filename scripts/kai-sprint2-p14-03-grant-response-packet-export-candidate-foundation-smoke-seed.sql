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

INSERT INTO kai.generation_runs (
  generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience
)
VALUES (
  '14030000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  'p14-03-smoke-generation-run',
  repeat('a', 64),
  'evidence_summary',
  'funder'
)
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

INSERT INTO kai.generated_content_drafts (
  generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, validator_results
)
VALUES (
  '14030000-0000-4000-8000-000000000401',
  '14030000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  'evidence_summary',
  'funder',
  '[]'::jsonb
)
ON CONFLICT (generated_content_draft_id) DO NOTHING;

-- First mint for (org, identity, fingerprint).
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

-- Replay of the exact same (org, identity, fingerprint) triple must converge
-- to the SAME row above, never mint a second candidate.
INSERT INTO kai.grant_response_packet_export_candidates (
  grant_response_packet_export_candidate_id, organization_id, grant_response_packet_export_identity_id,
  fingerprint_contract_version, canonical_fingerprint, created_by
)
VALUES (
  '14030000-0000-4000-8000-000000000502',
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000201',
  'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1',
  repeat('b', 64),
  '00000000-0000-4000-8000-000000000902'
)
ON CONFLICT (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint) DO NOTHING;

INSERT INTO kai.grant_response_packet_export_candidate_members (
  grant_response_packet_export_candidate_id, organization_id, generated_content_draft_id, ordinal
)
VALUES (
  '14030000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000001',
  '14030000-0000-4000-8000-000000000401',
  0
)
ON CONFLICT (grant_response_packet_export_candidate_id, generated_content_draft_id) DO NOTHING;

COMMIT;
