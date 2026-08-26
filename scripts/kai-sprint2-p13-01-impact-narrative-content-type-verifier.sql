DROP TABLE IF EXISTS p13_01_results;
CREATE TEMP TABLE p13_01_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p13_01_results
SELECT 'generation_runs_content_type_contract_allows_exact_p13_vocabulary',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'generation_runs_p3_01_content_type_check'
                 AND c.conrelid = 'kai.generation_runs'::regclass
                 AND replace(pg_get_constraintdef(c.oid), '::text', '') LIKE '%content_type = ANY (ARRAY[''evidence_summary'', ''impact_narrative'']%)'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%grant_response%'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%export%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.generation_runs.content_type allows exactly evidence_summary and impact_narrative';

INSERT INTO p13_01_results
SELECT 'generated_content_drafts_content_type_contract_allows_exact_p13_vocabulary',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'generated_content_drafts_p3_01_content_type_check'
                 AND c.conrelid = 'kai.generated_content_drafts'::regclass
                 AND replace(pg_get_constraintdef(c.oid), '::text', '') LIKE '%content_type = ANY (ARRAY[''evidence_summary'', ''impact_narrative'']%)'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%grant_response%'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%export%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.generated_content_drafts.content_type allows exactly evidence_summary and impact_narrative';

INSERT INTO p13_01_results
SELECT 'requested_audience_contract_unchanged',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'generation_runs_p3_01_requested_audience_check'
                 AND conrelid = 'kai.generation_runs'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%internal%'
                 AND pg_get_constraintdef(oid) LIKE '%funder%'
                 AND pg_get_constraintdef(oid) LIKE '%public%'
            )
            AND EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'generated_content_drafts_p3_01_requested_audience_check'
                 AND conrelid = 'kai.generated_content_drafts'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%internal%'
                 AND pg_get_constraintdef(oid) LIKE '%funder%'
                 AND pg_get_constraintdef(oid) LIKE '%public%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P13-01 does not alter the existing requested_audience contracts';

INSERT INTO p13_01_results
SELECT 'draft_status_review_status_and_created_by_contracts_unchanged',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_draft_status_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_review_status_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_created_by_type_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_runs_p3_01_created_by_type_check')
            THEN 'PASS' ELSE 'FAIL' END,
       'P13-01 leaves draft-only, needs-review, and system-owned creation contracts in place';

INSERT INTO p13_01_results
SELECT 'no_p13_queue_export_or_authority_schema',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN (
                   'impact_fact_id',
                   'exported_at',
                   'finalized_at',
                   'public_ready',
                   'funder_ready',
                   'export_authority',
                   'final_export_gate'
                 )
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P13-01 adds no impact facts, export/finalization, audience authority, or final-gate schema';

SELECT * FROM p13_01_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p13_01_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P13-01 impact-narrative content-type verifier failed';
  END IF;
END $$;
