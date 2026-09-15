BEGIN;

DO $$
DECLARE
  candidate_def text;

  predecessor_def CONSTANT text :=
    'CHECK ((content_type = ''evidence_summary''::text))';

  target_def CONSTANT text :=
    'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text])))';
BEGIN
  IF to_regclass('kai.export_candidates') IS NULL THEN
    RAISE EXCEPTION
      'kai.export_candidates is required before P14-15 export-candidate content-type evolution migration';
  END IF;

  SELECT pg_get_constraintdef(c.oid)
    INTO candidate_def
    FROM pg_constraint c
   WHERE c.conrelid = 'kai.export_candidates'::regclass
     AND c.conname = 'export_candidates_p3_16_content_type_check'
     AND c.contype = 'c';

  IF candidate_def IS NULL THEN
    RAISE EXCEPTION
      'export_candidates_p3_16_content_type_check is required before P14-15';
  END IF;

  IF candidate_def <> predecessor_def
     AND candidate_def <> target_def THEN
    RAISE EXCEPTION
      'export_candidates_p3_16_content_type_check has an unexpected definition (%)',
      candidate_def;
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
        'data_gap_memo'
      )
    );

COMMIT;
