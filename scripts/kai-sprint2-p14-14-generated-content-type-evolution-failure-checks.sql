DROP TABLE IF EXISTS p14_14_failure_results;
CREATE TEMP TABLE p14_14_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    INSERT INTO kai.generation_runs (
      organization_id,
      idempotency_key,
      request_fingerprint,
      content_type,
      requested_audience,
      created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'p14-14-invalid-run-content-type',
      repeat('9', 64),
      'grant_response_paragraph',
      'internal',
      'system'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_14_failure_results
  VALUES ('generation_runs_rejects_unrelated_content_type', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'generation_runs.content_type rejects content types outside the four current application content types');

  rejected := false;
  BEGIN
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
    VALUES (
      gen_random_uuid(),
      '14140000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000001',
      'grant_response_paragraph',
      'internal',
      'draft',
      'needs_gk_review',
      '[]'::jsonb,
      'system'
    );
  EXCEPTION WHEN unique_violation OR check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_14_failure_results
  VALUES ('generated_content_drafts_rejects_unrelated_content_type', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'generated_content_drafts.content_type rejects content types outside the four current application content types');

  rejected := false;
  BEGIN
    INSERT INTO kai.generation_runs (
      organization_id,
      idempotency_key,
      request_fingerprint,
      content_type,
      requested_audience,
      created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'p14-14-invalid-created-by-type',
      repeat('a', 64),
      'data_gap_memo',
      'internal',
      'human'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_14_failure_results
  VALUES ('generation_runs_created_by_type_still_system_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'P14-14 does not widen system-owned generation_run creation');

  rejected := false;
  BEGIN
    INSERT INTO kai.generation_runs (
      organization_id,
      idempotency_key,
      request_fingerprint,
      content_type,
      requested_audience,
      created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'p14-14-invalid-arbitrary-type',
      repeat('b', 64),
      'readiness_assessment_v2',
      'internal',
      'system'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_14_failure_results
  VALUES ('generation_runs_rejects_arbitrary_near_miss_type', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'generation_runs.content_type rejects a near-miss/unknown type token, proving the constraint is an exact enumeration and not a prefix/substring match');
END $$;

COMMIT;

SELECT * FROM p14_14_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_14_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-14 generated-content type-evolution failure-checks verifier failed';
  END IF;
END $$;
