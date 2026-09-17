-- KAI P13-EXT-2 board_update content-type evolution smoke verifier.
--
-- Read-only. Proves the synthetic board_update fixture identifiers are
-- present and coherent across kai.generation_runs, kai.generated_content_drafts,
-- and kai.export_candidates after the source-only smoke seed has been run
-- against an ephemeral verification target. This script performs no schema
-- or data writes, and does not rely on transaction rollback for read-only
-- compliance.

WITH results AS (
  SELECT 'board_update_generation_run_and_draft_pair_admitted' AS check_name,
         CASE WHEN EXISTS (
                SELECT 1
                  FROM kai.generation_runs r
                  JOIN kai.generated_content_drafts d
                    ON d.generation_run_id = r.generation_run_id
                   AND d.organization_id = r.organization_id
                 WHERE r.idempotency_key = 'p13-ext2-smoke-board-update'
                   AND r.content_type = 'board_update'
                   AND d.content_type = 'board_update'
                   AND r.requested_audience = 'internal'
                   AND d.requested_audience = 'internal'
              )
              THEN 'PASS' ELSE 'FAIL' END AS status,
         'the synthetic board_update generation_run/draft pair is admitted by both target content_type contracts, requested_audience internal only' AS detail

  UNION ALL

  SELECT 'board_update_export_candidate_admitted',
         CASE WHEN EXISTS (
                SELECT 1
                  FROM kai.export_candidates ec
                 WHERE ec.export_candidate_id = '13ee0000-0000-4000-8000-000000000401'
                   AND ec.content_type = 'board_update'
                   AND ec.requested_audience = 'internal'
                   AND ec.generated_content_draft_id = '13ee0000-0000-4000-8000-000000000201'
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'the synthetic board_update export_candidates row is admitted by the target export_candidates content_type contract'

  UNION ALL

  SELECT 'predecessor_types_still_admitted_alongside_board_update',
         CASE WHEN EXISTS (
                SELECT 1 FROM pg_constraint c
                 WHERE c.conname = 'generation_runs_p3_01_content_type_check'
                   AND c.conrelid = 'kai.generation_runs'::regclass
                   AND pg_get_constraintdef(c.oid) =
                       'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text])))'
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'case_for_support and earlier predecessor types remain admitted alongside board_update'

  UNION ALL

  SELECT 'run_draft_candidate_content_type_and_audience_remain_coherent',
         CASE WHEN EXISTS (
                SELECT 1
                  FROM kai.generated_content_drafts d
                  JOIN kai.generation_runs r
                    ON r.generation_run_id = d.generation_run_id
                   AND r.organization_id = d.organization_id
                  JOIN kai.export_candidates ec
                    ON ec.generated_content_draft_id = d.generated_content_draft_id
                   AND ec.organization_id = d.organization_id
                 WHERE r.idempotency_key = 'p13-ext2-smoke-board-update'
                   AND r.content_type = d.content_type
                   AND d.content_type = ec.content_type
                   AND r.requested_audience = d.requested_audience
                   AND d.requested_audience = ec.requested_audience
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'the synthetic board_update run/draft/export-candidate triple preserves matching content_type and requested_audience end to end'
)
SELECT * FROM results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH results AS (
      SELECT CASE WHEN EXISTS (
               SELECT 1
                 FROM kai.generation_runs r
                 JOIN kai.generated_content_drafts d
                   ON d.generation_run_id = r.generation_run_id
                  AND d.organization_id = r.organization_id
                WHERE r.idempotency_key = 'p13-ext2-smoke-board-update'
                  AND r.content_type = 'board_update'
                  AND d.content_type = 'board_update'
                  AND r.requested_audience = 'internal'
                  AND d.requested_audience = 'internal'
             ) THEN 'PASS' ELSE 'FAIL' END AS status
      UNION ALL
      SELECT CASE WHEN EXISTS (
               SELECT 1
                 FROM kai.export_candidates ec
                WHERE ec.export_candidate_id = '13ee0000-0000-4000-8000-000000000401'
                  AND ec.content_type = 'board_update'
                  AND ec.requested_audience = 'internal'
                  AND ec.generated_content_draft_id = '13ee0000-0000-4000-8000-000000000201'
             ) THEN 'PASS' ELSE 'FAIL' END
      UNION ALL
      SELECT CASE WHEN EXISTS (
               SELECT 1 FROM pg_constraint c
                WHERE c.conname = 'generation_runs_p3_01_content_type_check'
                  AND c.conrelid = 'kai.generation_runs'::regclass
                  AND pg_get_constraintdef(c.oid) =
                      'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text])))'
             ) THEN 'PASS' ELSE 'FAIL' END
      UNION ALL
      SELECT CASE WHEN EXISTS (
               SELECT 1
                 FROM kai.generated_content_drafts d
                 JOIN kai.generation_runs r
                   ON r.generation_run_id = d.generation_run_id
                  AND r.organization_id = d.organization_id
                 JOIN kai.export_candidates ec
                   ON ec.generated_content_draft_id = d.generated_content_draft_id
                  AND ec.organization_id = d.organization_id
                WHERE r.idempotency_key = 'p13-ext2-smoke-board-update'
                  AND r.content_type = d.content_type
                  AND d.content_type = ec.content_type
                  AND r.requested_audience = d.requested_audience
                  AND d.requested_audience = ec.requested_audience
             ) THEN 'PASS' ELSE 'FAIL' END
    )
    SELECT 1 FROM results WHERE status <> 'PASS'
  ) THEN
    RAISE EXCEPTION 'P13-EXT-2 board_update content-type evolution smoke verifier failed';
  END IF;
END $$;
