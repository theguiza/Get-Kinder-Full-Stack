BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'P14-02 Smoke Org', 'p14-02-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000002', 'P14-02 Smoke Other Org', 'p14-02-smoke-other-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('14020000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'p14-02-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

-- First mint for (org, engagement, funder).
INSERT INTO kai.grant_response_packet_export_identities (
  grant_response_packet_export_identity_id, organization_id, engagement_id, packet_audience, created_by
)
VALUES (
  '14020000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  '14020000-0000-4000-8000-000000000001',
  'funder',
  '00000000-0000-4000-8000-000000000901'
)
ON CONFLICT (organization_id, engagement_id, packet_audience) DO NOTHING;

-- Replay of the exact same (org, engagement, funder) triple must converge to
-- the SAME row above, never mint a second identity.
INSERT INTO kai.grant_response_packet_export_identities (
  grant_response_packet_export_identity_id, organization_id, engagement_id, packet_audience, created_by
)
VALUES (
  '14020000-0000-4000-8000-000000000302',
  '00000000-0000-4000-8000-000000000001',
  '14020000-0000-4000-8000-000000000001',
  'funder',
  '00000000-0000-4000-8000-000000000902'
)
ON CONFLICT (organization_id, engagement_id, packet_audience) DO NOTHING;

COMMIT;
