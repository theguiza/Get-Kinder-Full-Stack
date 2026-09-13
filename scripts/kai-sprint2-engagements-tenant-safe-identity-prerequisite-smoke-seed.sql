BEGIN;

-- Synthetic data only. Assumes the runner has already applied
-- scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql
-- (which creates the synthetic kai.organizations/kai.engagements mirror
-- this package's converge script targets) and this package's own converge
-- script.

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'Engagements Prerequisite Smoke Org', 'etsip-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('17000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'etsip-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

COMMIT;
