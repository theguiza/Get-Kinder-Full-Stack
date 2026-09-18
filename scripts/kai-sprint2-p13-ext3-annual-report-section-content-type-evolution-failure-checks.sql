-- KAI P13-EXT-3 annual_report_section content-type evolution failure checks.
--
-- Read-only. Proves from catalog definitions that unrelated content types,
-- near-miss annual_report_section-like tokens, and non-system generation-run
-- creators remain outside the accepted contracts after the widening. This
-- script performs no schema or data writes, and does not rely on
-- transaction rollback for read-only compliance.

WITH constraints AS (
  SELECT
    c.conname,
    pg_get_constraintdef(c.oid) AS constraint_def
  FROM pg_constraint c
  WHERE (c.conname = 'generation_runs_p3_01_content_type_check'
         AND c.conrelid = 'kai.generation_runs'::regclass)
     OR (c.conname = 'generation_runs_p3_01_created_by_type_check'
         AND c.conrelid = 'kai.generation_runs'::regclass)
     OR (c.conname = 'export_candidates_p3_16_content_type_check'
         AND c.conrelid = 'kai.export_candidates'::regclass)
),
expected AS (
  SELECT
    'generation_runs_p3_01_content_type_check' AS conname,
    'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))' AS expected_def
  UNION ALL
  SELECT
    'generation_runs_p3_01_created_by_type_check',
    'CHECK ((created_by_type = ''system''::text))'
  UNION ALL
  SELECT
    'export_candidates_p3_16_content_type_check',
    'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))'
),
results AS (
  SELECT
    'generation_runs_rejects_unrelated_content_type' AS check_name,
    CASE
      WHEN c.constraint_def = e.expected_def
       AND c.constraint_def NOT LIKE '%''grant_response_paragraph''::text%'
       AND c.constraint_def NOT LIKE '%''funder_outcome_table''::text%'
      THEN 'PASS' ELSE 'FAIL'
    END AS status,
    'generation_runs.content_type admits only the seven current application content types' AS detail
  FROM expected e
  LEFT JOIN constraints c ON c.conname = e.conname
  WHERE e.conname = 'generation_runs_p3_01_content_type_check'

  UNION ALL

  SELECT
    'generation_runs_rejects_near_miss_annual_report_section_token',
    CASE
      WHEN c.constraint_def = e.expected_def
       AND c.constraint_def LIKE '%''annual_report_section''::text%'
       AND c.constraint_def NOT LIKE '%''annual_report_section_v2''::text%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'generation_runs.content_type remains an exact enumeration for annual_report_section'
  FROM expected e
  LEFT JOIN constraints c ON c.conname = e.conname
  WHERE e.conname = 'generation_runs_p3_01_content_type_check'

  UNION ALL

  SELECT
    'generation_runs_created_by_type_still_system_only',
    CASE
      WHEN c.constraint_def = 'CHECK ((created_by_type = ''system''::text))'
       AND c.constraint_def NOT LIKE '%''human''::text%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'P13-EXT-3 does not widen system-owned generation_run creation, even for annual_report_section'
  FROM expected e
  LEFT JOIN constraints c ON c.conname = e.conname
  WHERE e.conname = 'generation_runs_p3_01_created_by_type_check'

  UNION ALL

  SELECT
    'export_candidates_rejects_unrelated_content_type',
    CASE
      WHEN c.constraint_def = e.expected_def
       AND c.constraint_def NOT LIKE '%''grant_response_paragraph''::text%'
       AND c.constraint_def NOT LIKE '%''funder_outcome_table''::text%'
      THEN 'PASS' ELSE 'FAIL'
    END,
    'export_candidates.content_type admits only the seven current application content types'
  FROM expected e
  LEFT JOIN constraints c ON c.conname = e.conname
  WHERE e.conname = 'export_candidates_p3_16_content_type_check'
)
SELECT * FROM results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH constraints AS (
      SELECT
        c.conname,
        pg_get_constraintdef(c.oid) AS constraint_def
      FROM pg_constraint c
      WHERE (c.conname = 'generation_runs_p3_01_content_type_check'
             AND c.conrelid = 'kai.generation_runs'::regclass)
         OR (c.conname = 'generation_runs_p3_01_created_by_type_check'
             AND c.conrelid = 'kai.generation_runs'::regclass)
         OR (c.conname = 'export_candidates_p3_16_content_type_check'
             AND c.conrelid = 'kai.export_candidates'::regclass)
    ),
    failures AS (
      SELECT 1
      FROM constraints
      WHERE conname = 'generation_runs_p3_01_content_type_check'
        AND constraint_def <> 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))'
      UNION ALL
      SELECT 1
      FROM constraints
      WHERE conname = 'generation_runs_p3_01_created_by_type_check'
        AND constraint_def <> 'CHECK ((created_by_type = ''system''::text))'
      UNION ALL
      SELECT 1
      FROM constraints
      WHERE conname = 'export_candidates_p3_16_content_type_check'
        AND constraint_def <> 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))'
      UNION ALL
      SELECT 1
      WHERE NOT EXISTS (
        SELECT 1 FROM constraints WHERE conname = 'generation_runs_p3_01_content_type_check'
      )
         OR NOT EXISTS (
        SELECT 1 FROM constraints WHERE conname = 'generation_runs_p3_01_created_by_type_check'
      )
         OR NOT EXISTS (
        SELECT 1 FROM constraints WHERE conname = 'export_candidates_p3_16_content_type_check'
      )
    )
    SELECT 1 FROM failures
  ) THEN
    RAISE EXCEPTION 'P13-EXT-3 annual_report_section content-type evolution failure-checks verifier failed';
  END IF;
END $$;
