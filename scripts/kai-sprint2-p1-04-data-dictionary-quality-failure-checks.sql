WITH checks AS (
  SELECT 'NO_LATER_PACKAGE_TABLES' AS check_name,
         'kai schema' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'kai'
              AND table_name IN (
                'sensitivity_records',
                'review_workflow',
                'source_candidates',
                'promotion_decisions',
                'sources',
                'source_versions',
                'evidence',
                'claims'
              )
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'sensitivity, review, source, evidence, and claim records remain out of scope' AS detail
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
  SELECT 'NO_REVISION_LINEAGE_COLUMNS', 'kai.data_dictionaries',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'data_dictionaries'
              AND column_name IN ('revision_number', 'predecessor_id', 'supersedes_id', 'superseded_by_id')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no revision numbers, predecessor links, or supersession links'
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMNS', 'kai.data_dictionary_fields',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'data_dictionary_fields'
              AND column_name IN ('raw_text', 'raw_bytes', 'full_text', 'extracted_text', 'parsed_rows', 'sample_value', 'sample_values')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw/unredacted content or sample-value columns'
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMNS', 'kai.data_quality_findings',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'data_quality_findings'
              AND column_name IN ('raw_text', 'raw_bytes', 'full_text', 'extracted_text', 'parsed_rows', 'sample_value', 'sample_values')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw/unredacted content or sample-value columns'
  UNION ALL
  SELECT 'FAIL_CLOSED_DEFAULTS_ONLY', 'kai.data_dictionary_fields',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'data_dictionary_fields'
              AND column_name = 'sensitivity'
              AND column_default NOT LIKE '%unknown%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'sensitivity defaults to unknown, not a completed classification'
)
SELECT 'P1_04_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
