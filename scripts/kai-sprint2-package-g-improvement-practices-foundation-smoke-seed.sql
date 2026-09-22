BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('17060000-0000-4000-8000-000000000001', 'Package G Smoke Org', 'package-g-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('17060000-0000-4000-8000-000000000002', '17060000-0000-4000-8000-000000000001', 'package-g-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

-- One organization-level practice (no engagement, no gap origin) - a
-- human-created practice with no Project scoping and no originating gap.
INSERT INTO kai.improvement_practices (
  improvement_practice_id, organization_id, title, rationale, status, cadence, created_by
)
VALUES (
  '17060000-0000-4000-8000-000000000101',
  '17060000-0000-4000-8000-000000000001',
  'Package G Smoke: quarterly data-quality check-in',
  'Verifies the mutable practice row can be created, read, and updated end to end.',
  'recommended',
  'quarterly',
  '17060000-0000-4000-8000-000000000901'
)
ON CONFLICT (improvement_practice_id) DO NOTHING;

-- One engagement-scoped practice, already active, with a next-due date and a
-- responsible actor.
INSERT INTO kai.improvement_practices (
  improvement_practice_id, organization_id, engagement_id, title, rationale, status, cadence,
  next_due_date, responsible_actor_user_id, created_by
)
VALUES (
  '17060000-0000-4000-8000-000000000102',
  '17060000-0000-4000-8000-000000000001',
  '17060000-0000-4000-8000-000000000002',
  'Package G Smoke: monthly funder-report reconciliation',
  'Verifies an engagement-scoped, active practice with a next-due date persists correctly.',
  'active',
  'monthly',
  '2026-10-15',
  '17060000-0000-4000-8000-000000000902',
  '17060000-0000-4000-8000-000000000901'
)
ON CONFLICT (improvement_practice_id) DO NOTHING;

COMMIT;
