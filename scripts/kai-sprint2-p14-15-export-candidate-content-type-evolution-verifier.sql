DO $$
DECLARE
  actual_def text;
  actual_validated boolean;

  target_def CONSTANT text :=
    'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text])))';
BEGIN
  IF to_regclass('kai.export_candidates') IS NULL THEN
    RAISE EXCEPTION
      'P14-15 VERIFY FAIL: kai.export_candidates missing';
  END IF;

  SELECT
    pg_get_constraintdef(c.oid),
    c.convalidated
  INTO
    actual_def,
    actual_validated
  FROM pg_constraint c
  WHERE c.conrelid = 'kai.export_candidates'::regclass
    AND c.conname = 'export_candidates_p3_16_content_type_check'
    AND c.contype = 'c';

  IF actual_def IS NULL THEN
    RAISE EXCEPTION
      'P14-15 VERIFY FAIL: named constraint missing';
  END IF;

  IF actual_def <> target_def THEN
    RAISE EXCEPTION
      'P14-15 VERIFY FAIL: unexpected definition (%)',
      actual_def;
  END IF;

  IF actual_validated IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'P14-15 VERIFY FAIL: constraint is not validated';
  END IF;
END $$;

SELECT
  'P14_15_EXPORT_CANDIDATE_CONTENT_TYPE_EVOLUTION_VERIFIED' AS verification,
  0 AS failures;
