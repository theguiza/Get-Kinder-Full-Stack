BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'P14-10 Smoke Org', 'p14-10-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.generation_runs (
  generation_run_id, organization_id, idempotency_key, request_fingerprint,
  content_type, requested_audience, created_by_type
)
VALUES (
  '14100000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'p14-10-smoke-generation-run',
  repeat('9', 64),
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
  '14100000-0000-4000-8000-000000000201',
  '14100000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'evidence_summary',
  'internal',
  'draft',
  'needs_gk_review',
  '[]'::jsonb,
  'system'
)
ON CONFLICT (generated_content_draft_id, organization_id) DO NOTHING;

-- The exact shape persistCompleteSet writes for the review queue item -
-- proving, post-repair, that a real generated_content_review row for a
-- generated_content_draft target now persists under both
-- review_queue_items_p1_06_target_object_type_check and
-- review_queue_items_p3_04_generated_content_review_contract_check.
INSERT INTO kai.review_queue_items (
  review_queue_item_id, organization_id, engagement_id, queue_type, target_object_type, target_object_id,
  priority, queue_status, review_status, blocked_reason, assigned_to, due_at,
  summary, required_action, queue_metadata, created_by, created_by_type
)
VALUES (
  '14100000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  NULL,
  'generated_content_review',
  'generated_content_draft',
  '14100000-0000-4000-8000-000000000201',
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

COMMIT;
