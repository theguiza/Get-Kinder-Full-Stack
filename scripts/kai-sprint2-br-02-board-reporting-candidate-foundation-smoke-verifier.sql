DROP TABLE IF EXISTS br_02_smoke_results;
CREATE TEMP TABLE br_02_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO br_02_smoke_results
SELECT 'seeded_candidate_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM kai.board_reporting_candidates
          WHERE board_reporting_candidate_id = '15020000-0000-4000-8000-000000000301'
            AND packet_audience = 'internal'
            AND candidate_status = 'created'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'seeded internal Board candidate exists';

INSERT INTO br_02_smoke_results
SELECT 'seeded_members_in_order',
       CASE WHEN (
         SELECT string_agg(generated_content_draft_id::text, ',' ORDER BY ordinal)
           FROM kai.board_reporting_candidate_members
          WHERE board_reporting_candidate_id = '15020000-0000-4000-8000-000000000301'
       ) = '15020000-0000-4000-8000-000000000201,15020000-0000-4000-8000-000000000202'
       THEN 'PASS' ELSE 'FAIL' END,
       'member snapshot preserves deterministic ordinal order';

INSERT INTO br_02_smoke_results
SELECT 'idempotency_replay_converges',
       CASE WHEN (
         SELECT count(*) FROM kai.board_reporting_candidates
          WHERE organization_id = '00000000-0000-4000-8000-000000000001'
            AND engagement_id = '15020000-0000-4000-8000-000000000001'
            AND idempotency_key = 'br-02-smoke-key'
       ) = 1 THEN 'PASS' ELSE 'FAIL' END,
       'there is exactly one row for the scoped idempotency key';

SELECT * FROM br_02_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM br_02_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'BR-02 board-reporting-candidate-foundation smoke verifier failed';
  END IF;
END $$;
