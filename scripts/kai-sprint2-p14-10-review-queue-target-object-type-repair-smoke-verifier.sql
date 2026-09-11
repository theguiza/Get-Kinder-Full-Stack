DROP TABLE IF EXISTS p14_10_smoke_results;
CREATE TEMP TABLE p14_10_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_10_smoke_results
SELECT 'generated_content_review_queue_item_persists_with_exact_contract',
       CASE WHEN EXISTS (
              SELECT 1 FROM kai.review_queue_items
               WHERE review_queue_item_id = '14100000-0000-4000-8000-000000000301'
                 AND organization_id = '00000000-0000-4000-8000-000000000001'
                 AND queue_type = 'generated_content_review'
                 AND target_object_type = 'generated_content_draft'
                 AND target_object_id = '14100000-0000-4000-8000-000000000201'
                 AND queue_status = 'open'
                 AND review_status = 'needs_gk_review'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the smoke-seeded generated_content_review queue item for a generated_content_draft target persisted with the exact P3-01/P3-04 static/lifecycle contract';

SELECT * FROM p14_10_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_10_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-10 review-queue target_object_type schema-repair smoke verifier failed';
  END IF;
END $$;
