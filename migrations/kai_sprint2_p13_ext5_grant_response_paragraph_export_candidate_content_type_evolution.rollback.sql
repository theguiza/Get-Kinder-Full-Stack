BEGIN;

DO $$
DECLARE
  actual_def text;

  predecessor_def CONSTANT text :=
    'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text, ''funder_outcome_table''::text])))';

  target_def CONSTANT text :=
    'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text, ''funder_outcome_table''::text, ''grant_response_paragraph''::text])))';
BEGIN
  IF to_regclass('kai.export_candidates') IS NULL THEN
    RAISE EXCEPTION
      'kai.export_candidates is required before P13-EXT-5 export-candidate rollback';
  END IF;

  SELECT pg_get_constraintdef(c.oid)
    INTO actual_def
    FROM pg_constraint c
   WHERE c.conrelid = 'kai.export_candidates'::regclass
     AND c.conname = 'export_candidates_p3_16_content_type_check'
     AND c.contype = 'c';

  IF actual_def IS NULL THEN
    RAISE EXCEPTION
      'P13-EXT-5 rollback refused: export_candidates_p3_16_content_type_check missing';
  END IF;

  IF actual_def = predecessor_def THEN
    RETURN;
  END IF;

  IF actual_def <> target_def THEN
    RAISE EXCEPTION
      'P13-EXT-5 rollback refused: unexpected constraint definition (%)',
      actual_def;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM kai.export_candidates
     WHERE content_type = 'grant_response_paragraph'
  ) THEN
    RAISE EXCEPTION
      'P13-EXT-5 rollback refused: grant_response_paragraph export candidates exist';
  END IF;
END $$;

ALTER TABLE kai.export_candidates
  DROP CONSTRAINT IF EXISTS export_candidates_p3_16_content_type_check,
  ADD CONSTRAINT export_candidates_p3_16_content_type_check
    CHECK (
      content_type IN (
        'evidence_summary',
        'impact_narrative',
        'readiness_assessment',
        'data_gap_memo',
        'case_for_support',
        'board_update',
        'annual_report_section',
        'funder_outcome_table'
      )
    );

COMMIT;
