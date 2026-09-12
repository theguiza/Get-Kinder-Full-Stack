SELECT 'br_03b_smoke_row_request_open_needs_review' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1
           FROM kai.review_queue_items q
           JOIN kai.board_reporting_candidates c
             ON c.organization_id = q.organization_id
            AND c.board_reporting_candidate_id = q.target_object_id
          WHERE q.organization_id = '00000000-0000-4000-8000-000000000001'
            AND q.queue_type = 'board_reporting_candidate_review'
            AND q.target_object_type = 'board_reporting_candidate'
            AND q.target_object_id = '15030000-0000-4000-8000-000000000321'
            AND q.queue_status = 'open'
            AND q.review_status = 'needs_gk_review'
            AND c.candidate_status = 'created'
       ) THEN 'PASS' ELSE 'FAIL' END AS status,
       'REQUEST pair (open / needs_gk_review) is permitted' AS detail
UNION ALL
SELECT 'br_03b_smoke_row_start_in_progress_needs_review',
       CASE WHEN EXISTS (
         SELECT 1
           FROM kai.review_queue_items q
           JOIN kai.board_reporting_candidates c
             ON c.organization_id = q.organization_id
            AND c.board_reporting_candidate_id = q.target_object_id
          WHERE q.organization_id = '00000000-0000-4000-8000-000000000001'
            AND q.queue_type = 'board_reporting_candidate_review'
            AND q.target_object_type = 'board_reporting_candidate'
            AND q.target_object_id = '15030000-0000-4000-8000-000000000322'
            AND q.queue_status = 'in_progress'
            AND q.review_status = 'needs_gk_review'
            AND c.candidate_status = 'created'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'START pair (in_progress / needs_gk_review) is permitted'
UNION ALL
SELECT 'br_03b_smoke_row_complete_resolved_resolved',
       CASE WHEN EXISTS (
         SELECT 1
           FROM kai.review_queue_items q
           JOIN kai.board_reporting_candidates c
             ON c.organization_id = q.organization_id
            AND c.board_reporting_candidate_id = q.target_object_id
          WHERE q.organization_id = '00000000-0000-4000-8000-000000000001'
            AND q.queue_type = 'board_reporting_candidate_review'
            AND q.target_object_type = 'board_reporting_candidate'
            AND q.target_object_id = '15030000-0000-4000-8000-000000000323'
            AND q.queue_status = 'resolved'
            AND q.review_status = 'resolved'
            AND c.candidate_status = 'created'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'COMPLETE pair (resolved / resolved) is permitted (schema-level proof; the repository/service/route completion code path is proven separately by the focused BR-03B COMPLETE tests)';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM kai.review_queue_items
     WHERE queue_type = 'board_reporting_candidate_review'
       AND target_object_id IN (
         '15030000-0000-4000-8000-000000000321',
         '15030000-0000-4000-8000-000000000322',
         '15030000-0000-4000-8000-000000000323'
       )
     GROUP BY target_object_id
    HAVING count(*) <> 1
  ) THEN
    RAISE EXCEPTION 'BR-03B smoke verifier failed: unexpected row count per candidate';
  END IF;
  IF (
    SELECT count(*) FROM kai.review_queue_items
     WHERE queue_type = 'board_reporting_candidate_review'
       AND target_object_id IN (
         '15030000-0000-4000-8000-000000000321',
         '15030000-0000-4000-8000-000000000322',
         '15030000-0000-4000-8000-000000000323'
       )
       AND (
         (queue_status = 'open' AND review_status = 'needs_gk_review')
         OR (queue_status = 'in_progress' AND review_status = 'needs_gk_review')
         OR (queue_status = 'resolved' AND review_status = 'resolved')
       )
  ) <> 3 THEN
    RAISE EXCEPTION 'BR-03B smoke verifier failed';
  END IF;
END $$;
