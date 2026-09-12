INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'BR-03A Smoke Org', 'br-03a-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('15030000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'br-03a-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

INSERT INTO kai.board_reporting_candidates (
  board_reporting_candidate_id,
  organization_id,
  engagement_id,
  packet_audience,
  idempotency_key,
  fingerprint_contract_version,
  canonical_fingerprint,
  candidate_status,
  created_by,
  created_by_type,
  created_at
)
VALUES (
  '15030000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000101',
  'internal',
  'br-03a-smoke-candidate',
  'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1',
  repeat('b', 64),
  'created',
  '90000000-0000-4000-8000-000000000001',
  'human',
  '2026-09-12T12:00:00.000Z'
)
ON CONFLICT (organization_id, engagement_id, idempotency_key) DO NOTHING;

INSERT INTO kai.review_queue_items (
  review_queue_item_id,
  organization_id,
  engagement_id,
  queue_type,
  target_object_type,
  target_object_id,
  priority,
  queue_status,
  review_status,
  summary,
  required_action,
  queue_metadata,
  created_by,
  created_by_type
)
VALUES (
  '15030000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000101',
  'board_reporting_candidate_review',
  'board_reporting_candidate',
  '15030000-0000-4000-8000-000000000301',
  'medium',
  'open',
  'needs_gk_review',
  'Board Reporting candidate requires review.',
  'Review internal Board packet membership and current-use support before release work.',
  '{}'::jsonb,
  NULL,
  'system'
)
ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'board_reporting_candidate_review'
DO NOTHING;
