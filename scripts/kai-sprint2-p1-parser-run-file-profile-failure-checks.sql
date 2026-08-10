WITH checks AS (
  SELECT 'NO_OTHER_P1_TABLES' AS check_name,
         'kai schema' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'kai'
              AND table_name IN (
                'data_dictionaries',
                'quality_records',
                'sensitivity_records',
                'review_workflow',
                'source_candidates',
                'promotion_decisions',
                'sources',
                'source_versions'
              )
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'only intake_parser_runs and intake_file_profiles P1 tables exist' AS detail
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMNS', 'kai.intake_parser_runs',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_parser_runs'
              AND column_name IN ('raw_text', 'raw_bytes', 'full_text', 'extracted_text', 'parsed_rows')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw/unredacted content columns'
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMNS', 'kai.intake_file_profiles',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND table_name = 'intake_file_profiles'
              AND column_name IN ('raw_text', 'raw_bytes', 'full_text', 'extracted_text', 'parsed_rows')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw/unredacted content columns'
  UNION ALL
  SELECT 'NO_SOURCE_COLUMNS', 'kai schema',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'kai'
              AND column_name IN ('source', 'source_version')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'source and source_version are out of scope'
)
SELECT 'P1_02_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
