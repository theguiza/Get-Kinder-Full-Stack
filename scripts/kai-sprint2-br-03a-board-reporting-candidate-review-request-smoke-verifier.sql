SELECT 'br_03a_smoke_review_row_open_needs_review' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1
           FROM kai.review_queue_items q
           JOIN kai.board_reporting_candidates c
             ON c.organization_id = q.organization_id
            AND c.board_reporting_candidate_id = q.target_object_id
          WHERE q.organization_id = '00000000-0000-4000-8000-000000000001'
            AND q.queue_type = 'board_reporting_candidate_review'
            AND q.target_object_type = 'board_reporting_candidate'
            AND q.target_object_id = '15030000-0000-4000-8000-000000000301'
            AND q.queue_status = 'open'
            AND q.review_status = 'needs_gk_review'
            AND c.candidate_status = 'created'
            AND c.canonical_fingerprint = repeat('b', 64)
       ) THEN 'PASS' ELSE 'FAIL' END AS status,
       'smoke row binds exact immutable Board candidate and stays open / needs_gk_review' AS detail;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM kai.review_queue_items
     WHERE queue_type = 'board_reporting_candidate_review'
       AND target_object_type = 'board_reporting_candidate'
       AND queue_status = 'open'
       AND review_status = 'needs_gk_review'
  ) THEN
    RAISE EXCEPTION 'BR-03A smoke verifier failed';
  END IF;
END $$;
