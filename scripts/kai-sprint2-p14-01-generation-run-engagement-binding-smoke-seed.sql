BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'P14-01 Smoke Org', 'p14-01-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000002', 'P14-01 Smoke Other Org', 'p14-01-smoke-other-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('14010000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'p14-01-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

INSERT INTO kai.generation_runs (
  generation_run_id, organization_id, engagement_id, idempotency_key, request_fingerprint,
  content_type, requested_audience, created_by_type
)
VALUES
  (
    '14010000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    '14010000-0000-4000-8000-000000000001',
    'p14-01-smoke-engagement-bound',
    repeat('5', 64),
    'evidence_summary',
    'internal',
    'system'
  ),
  (
    '14010000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    NULL,
    'p14-01-smoke-legacy-unbound',
    repeat('6', 64),
    'evidence_summary',
    'internal',
    'system'
  );

INSERT INTO kai.generated_content_drafts (
  generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience,
  draft_status, review_status, validator_results, created_by_type
)
VALUES
  (
    '14010000-0000-4000-8000-000000000201',
    '14010000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'evidence_summary',
    'internal',
    'draft',
    'needs_gk_review',
    '[]'::jsonb,
    'system'
  ),
  (
    '14010000-0000-4000-8000-000000000202',
    '14010000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'evidence_summary',
    'internal',
    'draft',
    'needs_gk_review',
    '[]'::jsonb,
    'system'
  );

COMMIT;
