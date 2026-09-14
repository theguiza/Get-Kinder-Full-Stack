DROP TABLE IF EXISTS p14_14_results;
CREATE TEMP TABLE p14_14_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_14_results
SELECT 'generation_runs_content_type_contract_allows_exact_p14_14_vocabulary',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'generation_runs_p3_01_content_type_check'
                 AND c.conrelid = 'kai.generation_runs'::regclass
                 AND replace(pg_get_constraintdef(c.oid), '::text', '') LIKE
                     '%content_type = ANY (ARRAY[''evidence_summary'', ''impact_narrative'', ''readiness_assessment'', ''data_gap_memo'']%)'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%grant_response%'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%export%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.generation_runs.content_type allows exactly evidence_summary, impact_narrative, readiness_assessment, data_gap_memo';

INSERT INTO p14_14_results
SELECT 'generated_content_drafts_content_type_contract_allows_exact_p14_14_vocabulary',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'generated_content_drafts_p3_01_content_type_check'
                 AND c.conrelid = 'kai.generated_content_drafts'::regclass
                 AND replace(pg_get_constraintdef(c.oid), '::text', '') LIKE
                     '%content_type = ANY (ARRAY[''evidence_summary'', ''impact_narrative'', ''readiness_assessment'', ''data_gap_memo'']%)'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%grant_response%'
                 AND pg_get_constraintdef(c.oid) NOT LIKE '%export%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.generated_content_drafts.content_type allows exactly evidence_summary, impact_narrative, readiness_assessment, data_gap_memo';

INSERT INTO p14_14_results
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
       'P14-14 does not alter the existing requested_audience contracts';

INSERT INTO p14_14_results
SELECT 'fingerprint_draft_status_review_status_and_created_by_contracts_unchanged',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_runs_p3_01_fingerprint_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_draft_status_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_review_status_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_created_by_type_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_runs_p3_01_created_by_type_check')
            THEN 'PASS' ELSE 'FAIL' END,
       'P14-14 leaves fingerprint, draft-only, needs-review, and system-owned creation contracts in place';

INSERT INTO p14_14_results
SELECT 'identity_and_fk_contracts_unchanged',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_runs_p3_01_identity_unique')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generation_runs_p3_01_id_org_unique')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_run_unique')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_id_org_unique')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_run_fk')
            THEN 'PASS' ELSE 'FAIL' END,
       'P14-14 leaves uniqueness and foreign-key identity contracts in place';

INSERT INTO p14_14_results
SELECT 'review_queue_and_audit_contracts_unchanged',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_queue_items_p3_01_generated_content_review_contract_check')
              AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_lifecycle_audit_p3_01_metadata_object_check')
            THEN 'PASS' ELSE 'FAIL' END,
       'P14-14 leaves the generated-content review-queue and audit contracts in place';

INSERT INTO p14_14_results
SELECT 'unknown_content_type_rejected_by_generation_runs',
       CASE WHEN NOT (
              SELECT pg_get_constraintdef(c.oid) ~ 'not_a_real_type'
                FROM pg_constraint c
               WHERE c.conname = 'generation_runs_p3_01_content_type_check'
                 AND c.conrelid = 'kai.generation_runs'::regclass
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.generation_runs.content_type constraint text does not admit an arbitrary/unknown type token';

INSERT INTO p14_14_results
SELECT 'content_type_still_explicit_enumeration',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'generation_runs_p3_01_content_type_check'
                 AND c.conrelid = 'kai.generation_runs'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%= ANY (ARRAY[%'
            )
            AND EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'generated_content_drafts_p3_01_content_type_check'
                 AND c.conrelid = 'kai.generated_content_drafts'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%= ANY (ARRAY[%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'content_type remains an explicit IN(...)/ANY(ARRAY[...]) enumeration, not a weakened free-text check';

SELECT * FROM p14_14_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_14_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-14 generated-content type-evolution verifier failed';
  END IF;
END $$;
