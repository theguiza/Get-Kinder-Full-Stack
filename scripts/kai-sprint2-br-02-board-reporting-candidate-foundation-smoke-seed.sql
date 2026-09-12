BEGIN;

INSERT INTO kai.organizations (organization_id, name, organization_code)
VALUES ('00000000-0000-4000-8000-000000000001', 'BR-02 Smoke Org', 'br-02-smoke-org')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
VALUES ('15020000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'br-02-smoke-engagement')
ON CONFLICT (engagement_id) DO NOTHING;

INSERT INTO kai.generation_runs (
  generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience
)
VALUES
  ('15020000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'br-02-smoke-run-1', repeat('a', 64), 'evidence_summary', 'internal'),
  ('15020000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'br-02-smoke-run-2', repeat('b', 64), 'impact_narrative', 'internal')
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

UPDATE kai.generation_runs
   SET engagement_id = '15020000-0000-4000-8000-000000000001'
 WHERE generation_run_id IN ('15020000-0000-4000-8000-000000000101', '15020000-0000-4000-8000-000000000102');

INSERT INTO kai.generated_content_drafts (
  generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, validator_results
)
VALUES
  ('15020000-0000-4000-8000-000000000201', '15020000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'evidence_summary', 'internal', '[]'::jsonb),
  ('15020000-0000-4000-8000-000000000202', '15020000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'impact_narrative', 'internal', '[]'::jsonb)
ON CONFLICT (generated_content_draft_id) DO NOTHING;

INSERT INTO kai.board_reporting_candidates (
  board_reporting_candidate_id, organization_id, engagement_id, packet_audience,
  idempotency_key, fingerprint_contract_version, canonical_fingerprint, candidate_status, created_by
)
VALUES (
  '15020000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  '15020000-0000-4000-8000-000000000001',
  'internal',
  'br-02-smoke-key',
  'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1',
  repeat('c', 64),
  'created',
  '00000000-0000-4000-8000-000000000901'
)
ON CONFLICT (organization_id, engagement_id, idempotency_key) DO NOTHING;

INSERT INTO kai.board_reporting_candidate_members (
  board_reporting_candidate_id, organization_id, generated_content_draft_id, ordinal
)
VALUES
  ('15020000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '15020000-0000-4000-8000-000000000201', 0),
  ('15020000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000001', '15020000-0000-4000-8000-000000000202', 1)
ON CONFLICT (board_reporting_candidate_id, generated_content_draft_id) DO NOTHING;

COMMIT;
