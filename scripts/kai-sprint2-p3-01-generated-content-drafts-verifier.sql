DROP TABLE IF EXISTS p3_01_results;
CREATE TEMP TABLE p3_01_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_01_results
SELECT 'generation_runs_present',
       CASE WHEN to_regclass('kai.generation_runs') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'generation run reservation table exists';

INSERT INTO p3_01_results
SELECT 'draft_block_citation_tables_present',
       CASE WHEN to_regclass('kai.generated_content_drafts') IS NOT NULL
              AND to_regclass('kai.generated_content_blocks') IS NOT NULL
              AND to_regclass('kai.generated_content_citations') IS NOT NULL
            THEN 'PASS' ELSE 'FAIL' END,
       'draft, block, and citation tables exist';

INSERT INTO p3_01_results
SELECT 'idempotency_identity_unique',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'generation_runs'
                 AND c.conname = 'generation_runs_p3_01_identity_unique'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'organization_id + idempotency_key is the PostgreSQL arbiter';

INSERT INTO p3_01_results
SELECT 'immutable_relationship_uniques',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_drafts_p3_01_run_unique'
            )
            AND EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_blocks_p3_01_identity_unique'
            )
            AND EXISTS (
              SELECT 1 FROM pg_constraint WHERE conname = 'generated_content_citations_p3_01_identity_unique'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'one draft per run, blocks unique by ordinal, citations unique by block/claim/evidence';

INSERT INTO p3_01_results
SELECT 'generated_content_review_queue_identity',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_review_queue_items_p3_01_generated_content_review_identity'
            )
            AND EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_01_generated_content_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'exactly one generated_content_review item per draft identity';

INSERT INTO p3_01_results
SELECT 'audit_operation_allowed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%generated_content_draft_created%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'metadata-only audit operation vocabulary includes P3-01 creation';

INSERT INTO p3_01_results
SELECT 'audit_metadata_safe_contract',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_p3_01_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-01 audit metadata is constrained to metadata-only identifiers and counts';

INSERT INTO p3_01_results
SELECT 'draft_only_no_approval_or_export_columns',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND table_name IN ('generation_runs','generated_content_drafts','generated_content_blocks','generated_content_citations')
                 AND column_name IN ('approved_at','finalized_at','exported_at','funder_ready','public_ready','source_of_truth')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'generated content schema has no approval, finalize, export, funder/public-ready, or source-of-truth state';

SELECT * FROM p3_01_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_01_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-01 generated-content verifier failed';
  END IF;
END $$;
