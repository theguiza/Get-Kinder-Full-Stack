WITH checks AS (
  SELECT 'NO_LATER_PACKAGE_TABLES' AS check_name,
         'kai schema' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'kai'
              AND table_name IN (
                'review_queue_items',
                'intake_source_candidates',
                'intake_promotion_decisions',
                'sources',
                'source_versions',
                'evidence',
                'claims'
              )
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'review queue, source candidate, promotion decision, source, evidence, and claim records remain out of scope' AS detail
  UNION ALL
  SELECT 'NO_SOURCE_COLUMNS', 'kai schema',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND column_name IN ('source', 'source_version')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'source and source_version are out of scope'
  UNION ALL
  SELECT 'NO_RETENTION_EXECUTION_COLUMNS', 'kai.intake_sensitivity_profiles',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name IN ('retention_executed_at', 'purge_scheduled_at', 'deleted_at', 'retention_job_id')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no retention-execution, purge-scheduling, deletion, or job-activation column exists'
  UNION ALL
  SELECT 'NO_APPROVAL_OR_REVIEW_STATE_COLUMNS', 'kai.intake_sensitivity_profiles',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name IN ('review_status', 'review_requirements', 'approved_by', 'approval_status')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'review requirements are output-only and no approval state is persisted'
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMNS', 'kai.intake_sensitivity_profiles',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name IN ('raw_text', 'raw_bytes', 'full_text', 'extracted_text', 'parsed_rows', 'sample_value', 'sample_values', 'field_label', 'excerpt')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw/unredacted content, sample-value, field-label, or excerpt columns'
  UNION ALL
  SELECT 'FAIL_CLOSED_DEFAULTS_ONLY', 'kai.intake_sensitivity_profiles',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name = 'pii_status'
              AND column_default NOT LIKE '%unknown%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'pii_status defaults to unknown, not a completed classification'
  UNION ALL
  SELECT 'DISTINCT_INDIGENOUS_GOVERNANCE_COLUMN', 'kai.intake_sensitivity_profiles',
         CASE WHEN EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name = 'indigenous_governance_status'
         ) AND EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name = 'pii_status'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Indigenous/OCAP-like governance-sensitive data is its own column, never merged into generic PII'
  UNION ALL
  SELECT 'DISTINCT_FINANCIAL_RECORDS_COLUMN', 'kai.intake_sensitivity_profiles',
         CASE WHEN EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name = 'financial_records_status'
         ) AND EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name = 'pii_status'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'financial records is its own distinct Data Protection special category, never merged into generic PII'
  UNION ALL
  SELECT 'DISTINCT_SMALL_CELL_RISK_COLUMN', 'kai.intake_sensitivity_profiles',
         CASE WHEN EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_sensitivity_profiles'
              AND column_name = 'small_cell_risk_status'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'small-cell risk is its own distinct classification'
)
SELECT 'P1_05_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
