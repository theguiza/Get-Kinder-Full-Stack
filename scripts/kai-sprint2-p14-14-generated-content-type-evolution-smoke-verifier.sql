DROP TABLE IF EXISTS p14_14_smoke_results;
CREATE TEMP TABLE p14_14_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_14_smoke_results
SELECT 'historical_evidence_summary_pair_remains_valid',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.generation_runs r
                JOIN kai.generated_content_drafts d
                  ON d.generation_run_id = r.generation_run_id
                 AND d.organization_id = r.organization_id
               WHERE r.idempotency_key = 'p14-14-smoke-evidence-summary'
                 AND r.content_type = 'evidence_summary'
                 AND d.content_type = 'evidence_summary'
                 AND r.requested_audience = 'internal'
                 AND d.requested_audience = 'internal'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the historical evidence_summary content type is still admitted by both target contracts';

INSERT INTO p14_14_smoke_results
SELECT 'historical_impact_narrative_pair_remains_valid',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.generation_runs r
                JOIN kai.generated_content_drafts d
                  ON d.generation_run_id = r.generation_run_id
                 AND d.organization_id = r.organization_id
               WHERE r.idempotency_key = 'p14-14-smoke-impact-narrative'
                 AND r.content_type = 'impact_narrative'
                 AND d.content_type = 'impact_narrative'
                 AND r.requested_audience = 'internal'
                 AND d.requested_audience = 'internal'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the historical impact_narrative content type is still admitted by both target contracts';

INSERT INTO p14_14_smoke_results
SELECT 'readiness_assessment_pair_is_admitted',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.generation_runs r
                JOIN kai.generated_content_drafts d
                  ON d.generation_run_id = r.generation_run_id
                 AND d.organization_id = r.organization_id
               WHERE r.idempotency_key = 'p14-14-smoke-readiness-assessment'
                 AND r.content_type = 'readiness_assessment'
                 AND d.content_type = 'readiness_assessment'
                 AND r.requested_audience = 'internal'
                 AND d.requested_audience = 'internal'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'readiness_assessment is admitted by both target content_type contracts';

INSERT INTO p14_14_smoke_results
SELECT 'data_gap_memo_pair_is_admitted',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.generation_runs r
                JOIN kai.generated_content_drafts d
                  ON d.generation_run_id = r.generation_run_id
                 AND d.organization_id = r.organization_id
               WHERE r.idempotency_key = 'p14-14-smoke-data-gap-memo'
                 AND r.content_type = 'data_gap_memo'
                 AND d.content_type = 'data_gap_memo'
                 AND r.requested_audience = 'internal'
                 AND d.requested_audience = 'internal'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'data_gap_memo is admitted by both target content_type contracts';

INSERT INTO p14_14_smoke_results
SELECT 'generation_run_and_draft_content_type_remain_coherent',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM kai.generated_content_drafts d
                JOIN kai.generation_runs r
                  ON r.generation_run_id = d.generation_run_id
                 AND r.organization_id = d.organization_id
               WHERE r.idempotency_key IN (
                 'p14-14-smoke-evidence-summary',
                 'p14-14-smoke-impact-narrative',
                 'p14-14-smoke-readiness-assessment',
                 'p14-14-smoke-data-gap-memo'
               )
                 AND (r.content_type <> d.content_type OR r.requested_audience <> d.requested_audience)
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'synthetic generation-run/draft pairs preserve matching content_type and requested_audience across all four content types';

SELECT * FROM p14_14_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_14_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-14 generated-content type-evolution smoke verifier failed';
  END IF;
END $$;
