DROP TABLE IF EXISTS p13_01_failure_results;
CREATE TEMP TABLE p13_01_failure_results (
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
      'p13-01-invalid-run-content-type',
      repeat('3', 64),
      'grant_response_paragraph',
      'internal',
      'system'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p13_01_failure_results
  VALUES ('generation_runs_rejects_unrelated_content_type', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'generation_runs.content_type rejects content types outside evidence_summary and impact_narrative');

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
      '13010000-0000-4000-8000-000000000102',
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
  INSERT INTO p13_01_failure_results
  VALUES ('generated_content_drafts_rejects_unrelated_content_type', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'generated_content_drafts.content_type rejects content types outside evidence_summary and impact_narrative');

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
      'p13-01-invalid-created-by-type',
      repeat('4', 64),
      'impact_narrative',
      'internal',
      'human'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p13_01_failure_results
  VALUES ('generation_runs_created_by_type_still_system_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'P13-01 does not widen system-owned generation_run creation');
END $$;

COMMIT;

SELECT * FROM p13_01_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p13_01_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P13-01 impact-narrative content-type failure-checks verifier failed';
  END IF;
END $$;
