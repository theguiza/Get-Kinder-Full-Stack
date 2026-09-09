DROP TABLE IF EXISTS p14_01_smoke_results;
CREATE TEMP TABLE p14_01_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_01_smoke_results
SELECT 'engagement_bound_run_resolves_exact_engagement',
       CASE WHEN EXISTS (
              SELECT 1 FROM kai.generation_runs
               WHERE generation_run_id = '14010000-0000-4000-8000-000000000101'
                 AND organization_id = '00000000-0000-4000-8000-000000000001'
                 AND engagement_id = '14010000-0000-4000-8000-000000000001'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'engagement-bound generation run resolves its exact requested engagement_id';

INSERT INTO p14_01_smoke_results
SELECT 'legacy_run_engagement_null_is_valid_permanent_state',
       CASE WHEN EXISTS (
              SELECT 1 FROM kai.generation_runs
               WHERE generation_run_id = '14010000-0000-4000-8000-000000000102'
                 AND engagement_id IS NULL
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a historical generation run with engagement_id = NULL remains valid, permanent state, never a system_error';

INSERT INTO p14_01_smoke_results
SELECT 'draft_lineage_transitively_resolves_engagement_for_bound_run',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.generated_content_drafts d
                JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
               WHERE d.generated_content_draft_id = '14010000-0000-4000-8000-000000000201'
                 AND r.engagement_id = '14010000-0000-4000-8000-000000000001'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'organizationId + generatedContentDraftId -> generationRunId -> engagementId resolves transitively through the existing generation_run_id lineage, with no new column on generated_content_drafts';

INSERT INTO p14_01_smoke_results
SELECT 'legacy_draft_lineage_still_readable_with_null_engagement',
       CASE WHEN EXISTS (
              SELECT 1
                FROM kai.generated_content_drafts d
                JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
               WHERE d.generated_content_draft_id = '14010000-0000-4000-8000-000000000202'
                 AND r.engagement_id IS NULL
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a legacy unbound draft remains readable through the existing generation_run join, preserving already-closed per-draft workflows';

SELECT * FROM p14_01_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_01_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-01 generation-run engagement-binding smoke verifier failed';
  END IF;
END $$;
