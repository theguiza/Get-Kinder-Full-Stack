BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'BR-04 Smoke Org', 'br-04-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('15030000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'br-04-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

-- Candidate A - the exact resolved/resolved (COMPLETE) BR-03B candidate this
-- package's lineage proofs are bound to. Same row the BR-03B smoke-seed
-- mints, so running after or independently of that package's own smoke-seed
-- converges on the same row.
INSERT INTO kai.board_reporting_candidates (
  board_reporting_candidate_id, organization_id, engagement_id, packet_audience,
  idempotency_key, fingerprint_contract_version, canonical_fingerprint,
  candidate_status, created_by, created_by_type, created_at
)
VALUES (
  '15030000-0000-4000-8000-000000000323', '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000101', 'internal', 'br-03b-smoke-candidate-complete',
  'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1', repeat('d', 64),
  'created', '90000000-0000-4000-8000-000000000001', 'human', '2026-09-12T12:00:00.000Z'
)
ON CONFLICT (organization_id, engagement_id, idempotency_key) DO NOTHING;

INSERT INTO kai.review_queue_items (
  review_queue_item_id, organization_id, engagement_id, queue_type, target_object_type, target_object_id,
  priority, queue_status, review_status, summary, required_action, queue_metadata, created_by, created_by_type
)
VALUES (
  '15030000-0000-4000-8000-000000000423', '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000101', 'board_reporting_candidate_review', 'board_reporting_candidate',
  '15030000-0000-4000-8000-000000000323', 'medium', 'resolved', 'resolved',
  'Board Reporting candidate requires review.',
  'Review internal Board packet membership and current-use support before release work.',
  '{}'::jsonb, NULL, 'system'
)
ON CONFLICT (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'board_reporting_candidate_review'
DO NOTHING;

-- Candidate B - a second, distinct Board candidate whose review is still in
-- START (not yet resolved), used to prove a decision for candidate A can
-- never attach to, or be read as authorizing, candidate B.
INSERT INTO kai.board_reporting_candidates (
  board_reporting_candidate_id, organization_id, engagement_id, packet_audience,
  idempotency_key, fingerprint_contract_version, canonical_fingerprint,
  candidate_status, created_by, created_by_type, created_at
)
VALUES (
  '15030000-0000-4000-8000-000000000322', '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000101', 'internal', 'br-03b-smoke-candidate-start',
  'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1', repeat('c', 64),
  'created', '90000000-0000-4000-8000-000000000001', 'human', '2026-09-12T12:00:00.000Z'
)
ON CONFLICT (organization_id, engagement_id, idempotency_key) DO NOTHING;

-- Root grant on candidate A only.
INSERT INTO kai.board_reporting_candidate_human_authority_decisions (
  decision_id, organization_id, board_reporting_candidate_id, decision_type, decision_action,
  decided_by, decided_by_role
)
VALUES (
  '15070000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000001',
  '15030000-0000-4000-8000-000000000323',
  'export_authority_granted',
  'grant',
  '00000000-0000-4000-8000-000000000901',
  'gk_admin'
)
ON CONFLICT DO NOTHING;

COMMIT;
