BEGIN;

INSERT INTO kai.generation_runs (
  generation_run_id,
  organization_id,
  idempotency_key,
  request_fingerprint,
  content_type,
  requested_audience,
  created_by_type
)
VALUES
  (
    '13010000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'p13-01-smoke-evidence-summary',
    repeat('1', 64),
    'evidence_summary',
    'internal',
    'system'
  ),
  (
    '13010000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'p13-01-smoke-impact-narrative',
    repeat('2', 64),
    'impact_narrative',
    'internal',
    'system'
  );

INSERT INTO kai.generated_content_drafts (
  generated_content_draft_id,
  generation_run_id,
  organization_id,
  content_type,
  requested_audience,
  draft_status,
  review_status,
  validator_results,
  created_by_type
)
VALUES
  (
    '13010000-0000-4000-8000-000000000201',
    '13010000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'evidence_summary',
    'internal',
    'draft',
    'needs_gk_review',
    '[]'::jsonb,
    'system'
  ),
  (
    '13010000-0000-4000-8000-000000000202',
    '13010000-0000-4000-8000-000000000102',
    '00000000-0000-4000-8000-000000000001',
    'impact_narrative',
    'internal',
    'draft',
    'needs_gk_review',
    '[]'::jsonb,
    'system'
  );

COMMIT;
