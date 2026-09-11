BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'GCRS Smoke Org', 'gcrs-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.generation_runs (
  generation_run_id, organization_id, idempotency_key, request_fingerprint,
  content_type, requested_audience, created_by_type
)
VALUES (
  '9c500000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'gcrs-smoke-generation-run',
  repeat('7', 64),
  'evidence_summary',
  'internal',
  'system'
)
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

INSERT INTO kai.generated_content_drafts (
  generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience,
  draft_status, review_status, validator_results, created_by_type
)
VALUES (
  '9c500000-0000-4000-8000-000000000201',
  '9c500000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'evidence_summary',
  'internal',
  'draft',
  'needs_gk_review',
  '[]'::jsonb,
  'system'
)
ON CONFLICT (generated_content_draft_id, organization_id) DO NOTHING;

INSERT INTO kai.review_queue_items (
  review_queue_item_id, organization_id, engagement_id, queue_type, target_object_type, target_object_id,
  priority, queue_status, review_status, blocked_reason, assigned_to, due_at,
  summary, required_action, queue_metadata, created_by, created_by_type
)
VALUES (
  '9c500000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  NULL,
  'generated_content_review',
  'generated_content_draft',
  '9c500000-0000-4000-8000-000000000201',
  'medium',
  'open',
  'needs_gk_review',
  NULL,
  NULL,
  NULL,
  'Generated draft requires human review.',
  'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.',
  '{}'::jsonb,
  NULL,
  'system'
)
ON CONFLICT DO NOTHING;

-- Proves, directly in SQL, that the real audit row shape
-- insertGeneratedContentStartReviewAudit
-- (Backend/kai/dictionary/postgresGeneratedContentRepository.js) writes on
-- /start is now accepted by both the audit-operation allowlist and the new
-- metadata-only CHECK.
INSERT INTO kai.upload_lifecycle_audit (
  organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
)
SELECT
  '00000000-0000-4000-8000-000000000001',
  f.intake_file_id,
  'generated_content_review_started',
  f.upload_state,
  f.upload_state,
  'success',
  jsonb_build_object(
    'contract', 'p3_stage_b_generated_content_review_start_v1',
    'organization_id', '00000000-0000-4000-8000-000000000001',
    'generation_run_id', '9c500000-0000-4000-8000-000000000101',
    'generated_content_draft_id', '9c500000-0000-4000-8000-000000000201',
    'review_queue_item_id', '9c500000-0000-4000-8000-000000000301',
    'actor_id', '90000000-0000-4000-8000-000000000001',
    'actor_type', 'human',
    'expected_updated_at', '2026-08-06T10:00:00.000Z',
    'requested_start_timestamp', '2026-08-06T10:00:01.000Z',
    'previous_queue_status', 'open',
    'resulting_queue_status', 'in_progress',
    'previous_review_status', 'needs_gk_review',
    'resulting_review_status', 'needs_gk_review',
    'validator_keys', jsonb_build_array('VAL-REV-START-001')
  ),
  now()
FROM kai.intake_files f
WHERE f.organization_id = '00000000-0000-4000-8000-000000000001'
ORDER BY f.intake_file_id ASC
LIMIT 1
ON CONFLICT DO NOTHING;

COMMIT;
