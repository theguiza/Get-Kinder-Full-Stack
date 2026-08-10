DROP TABLE IF EXISTS p3_05_results;
CREATE TEMP TABLE p3_05_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_05_results
SELECT 'export_review_contract_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_05_export_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'queue contract pins export_review to the single open/needs_gk_review static profile';

INSERT INTO p3_05_results
SELECT 'export_review_identity_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_review_queue_items_p3_05_export_review_identity'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'partial unique index enforces at most one export_review row per organization/draft';

INSERT INTO p3_05_results
SELECT 'audit_operation_allowed',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'upload_lifecycle_audit'
                 AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
                 AND pg_get_constraintdef(c.oid) LIKE '%export_review_requested%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'metadata-only audit operation vocabulary includes P3-05 export_review_requested';

INSERT INTO p3_05_results
SELECT 'audit_metadata_safe_contract',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'upload_lifecycle_audit_p3_05_metadata_object_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-05 audit metadata is constrained to metadata-only identifiers, the validator key, and failed-gate codes';

INSERT INTO p3_05_results
SELECT 'no_export_authority_or_final_gate_state',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM information_schema.columns
               WHERE table_schema = 'kai'
                 AND column_name IN ('export_authority', 'final_export_gate', 'approved_at', 'finalized_at', 'exported_at')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'P3-05 introduces no export-authority, final-gate, or finalize/export state anywhere in kai schema';

SELECT * FROM p3_05_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_05_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-05 export-review-request verifier failed';
  END IF;
END $$;
