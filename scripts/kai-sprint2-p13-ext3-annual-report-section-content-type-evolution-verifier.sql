-- KAI P13-EXT-3 annual_report_section content-type evolution catalog verifier.
--
-- Read-only. Verifies the exact post-migration state of the three named
-- CHECK constraints this package widens:
--   - generation_runs_p3_01_content_type_check          (kai.generation_runs)
--   - generated_content_drafts_p3_01_content_type_check (kai.generated_content_drafts)
--   - export_candidates_p3_16_content_type_check        (kai.export_candidates)
--
-- Fails closed (raises) on: a missing constraint; an unrecognized/unexpected
-- constraint definition; a mixed predecessor/target state; annual_report_section
-- missing from any target definition; and any content-type token appearing
-- in a constraint definition that is not part of the exact recognized
-- predecessor or target vocabulary.
--
-- This script performs no schema or data writes, and does not rely on
-- transaction rollback for read-only compliance.

WITH constraint_state(label, table_regclass, constraint_name, predecessor_def, target_def) AS (
  VALUES
    (
      'generation_runs',
      'kai.generation_runs',
      'generation_runs_p3_01_content_type_check',
      'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text])))',
      'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))'
    ),
    (
      'generated_content_drafts',
      'kai.generated_content_drafts',
      'generated_content_drafts_p3_01_content_type_check',
      'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text])))',
      'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))'
    ),
    (
      'export_candidates',
      'kai.export_candidates',
      'export_candidates_p3_16_content_type_check',
      'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text])))',
      'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))'
    )
),
actual_state AS (
  SELECT
    s.*,
    c.oid,
    pg_get_constraintdef(c.oid) AS actual_def
  FROM constraint_state s
  LEFT JOIN pg_constraint c
    ON c.conname = s.constraint_name
   AND c.conrelid = s.table_regclass::regclass
),
classified_state AS (
  SELECT
    *,
    CASE
      WHEN actual_def = target_def THEN 'target'
      WHEN actual_def = predecessor_def THEN 'predecessor'
      WHEN actual_def IS NULL THEN 'missing'
      ELSE 'unrecognized'
    END AS definition_state
  FROM actual_state
),
results AS (
  SELECT
    label || '_constraint_exists' AS check_name,
    CASE WHEN oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
    constraint_name || ' exists on ' || table_regclass AS detail
  FROM classified_state

  UNION ALL

  SELECT
    label || '_at_target_annual_report_section_vocabulary',
    CASE WHEN definition_state = 'target' THEN 'PASS' ELSE 'FAIL' END,
    CASE
      WHEN definition_state = 'missing' THEN constraint_name || ' is missing'
      WHEN definition_state = 'target' THEN constraint_name || ' is at the exact P13-EXT-3 target vocabulary'
      WHEN definition_state = 'predecessor' THEN constraint_name || ' is still at the P13-EXT-2 predecessor vocabulary'
      ELSE constraint_name || ' has an unrecognized definition: ' || actual_def
    END
  FROM classified_state

  UNION ALL

  SELECT
    'no_mixed_predecessor_target_state',
    CASE WHEN count(DISTINCT definition_state) = 1 AND min(definition_state) = 'target' THEN 'PASS' ELSE 'FAIL' END,
    'all three constraints must be at the same target annual_report_section-inclusive state'
  FROM classified_state

  UNION ALL

  SELECT
    label || '_annual_report_section_present_when_at_target',
    CASE
      WHEN definition_state = 'target' AND actual_def LIKE '%''annual_report_section''::text%' THEN 'PASS'
      ELSE 'FAIL'
    END,
    constraint_name || ' includes annual_report_section when reporting the target vocabulary'
  FROM classified_state

  UNION ALL

  SELECT
    label || '_no_unrecognized_content_type_token',
    CASE
      WHEN oid IS NULL THEN 'FAIL'
      WHEN EXISTS (
        SELECT 1
        FROM regexp_matches(actual_def, '''([a-z_]+)''::text', 'g') AS m(token)
        WHERE m.token[1] NOT IN (
          'evidence_summary', 'impact_narrative', 'readiness_assessment',
          'data_gap_memo', 'case_for_support', 'board_update', 'annual_report_section'
        )
      ) THEN 'FAIL'
      ELSE 'PASS'
    END,
    constraint_name || ' contains only recognized content-type tokens'
  FROM classified_state
)
SELECT * FROM results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH constraint_state(label, table_regclass, constraint_name, predecessor_def, target_def) AS (
      VALUES
        ('generation_runs', 'kai.generation_runs', 'generation_runs_p3_01_content_type_check', 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text])))', 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))'),
        ('generated_content_drafts', 'kai.generated_content_drafts', 'generated_content_drafts_p3_01_content_type_check', 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text])))', 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))'),
        ('export_candidates', 'kai.export_candidates', 'export_candidates_p3_16_content_type_check', 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text])))', 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text])))')
    ),
    classified_state AS (
      SELECT
        s.*,
        c.oid,
        pg_get_constraintdef(c.oid) AS actual_def,
        CASE
          WHEN pg_get_constraintdef(c.oid) = s.target_def THEN 'target'
          WHEN pg_get_constraintdef(c.oid) = s.predecessor_def THEN 'predecessor'
          WHEN c.oid IS NULL THEN 'missing'
          ELSE 'unrecognized'
        END AS definition_state
      FROM constraint_state s
      LEFT JOIN pg_constraint c
        ON c.conname = s.constraint_name
       AND c.conrelid = s.table_regclass::regclass
    ),
    failures AS (
      SELECT 1 FROM classified_state WHERE definition_state <> 'target'
      UNION ALL
      SELECT 1
      FROM classified_state
      WHERE actual_def NOT LIKE '%''annual_report_section''::text%'
      UNION ALL
      SELECT 1
      FROM classified_state cs
      WHERE EXISTS (
        SELECT 1
        FROM regexp_matches(cs.actual_def, '''([a-z_]+)''::text', 'g') AS m(token)
        WHERE m.token[1] NOT IN (
          'evidence_summary', 'impact_narrative', 'readiness_assessment',
          'data_gap_memo', 'case_for_support', 'board_update', 'annual_report_section'
        )
      )
      UNION ALL
      SELECT 1
      FROM classified_state
      HAVING count(DISTINCT definition_state) <> 1 OR min(definition_state) <> 'target'
    )
    SELECT 1 FROM failures
  ) THEN
    RAISE EXCEPTION 'P13-EXT-3 annual_report_section content-type evolution verifier failed';
  END IF;
END $$;
