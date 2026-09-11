DROP TABLE IF EXISTS gcrs_smoke_results;
CREATE TEMP TABLE gcrs_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO gcrs_smoke_results
SELECT 'start_review_audit_row_persists_with_exact_metadata_contract',
       CASE WHEN EXISTS (
              SELECT 1 FROM kai.upload_lifecycle_audit
               WHERE organization_id = '00000000-0000-4000-8000-000000000001'
                 AND operation = 'generated_content_review_started'
                 AND metadata->>'generated_content_draft_id' = '9c500000-0000-4000-8000-000000000201'
                 AND metadata->>'review_queue_item_id' = '9c500000-0000-4000-8000-000000000301'
                 AND metadata ? 'validator_keys'
                 AND NOT metadata ? 'draft_text'
                 AND NOT metadata ? 'raw_content'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the smoke-seeded generated_content_review_started audit row persisted with the exact metadata-only contract';

SELECT * FROM gcrs_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gcrs_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'generated-content-review-start audit-contract smoke verifier failed';
  END IF;
END $$;
