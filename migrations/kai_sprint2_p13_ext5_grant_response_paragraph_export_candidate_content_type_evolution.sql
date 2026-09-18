BEGIN;

-- P13-EXT-5 companion to kai_sprint2_p13_ext5_grant_response_paragraph_content_type_evolution.sql:
-- widens kai.export_candidates' own content_type CHECK constraint to include
-- grant_response_paragraph, following the exact pattern P13-EXT-4 already
-- used to add funder_outcome_table (EXPORT_CANDIDATE_CONTENT_TYPES in
-- Backend/kai/dictionary/exportCandidateContract.js). This is the generic
-- export-candidate/limitation-snapshot flow only, separate from Grant
-- Response Packet and Board Reporting, neither of which is touched here,
-- despite grant_response_paragraph's name resembling "Grant Response
-- Packet".

DO $$
DECLARE
  candidate_def text;

  predecessor_def CONSTANT text :=
    'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text, ''funder_outcome_table''::text])))';

  target_def CONSTANT text :=
    'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text, ''board_update''::text, ''annual_report_section''::text, ''funder_outcome_table''::text, ''grant_response_paragraph''::text])))';
BEGIN
  IF to_regclass('kai.export_candidates') IS NULL THEN
    RAISE EXCEPTION
      'kai.export_candidates is required before P13-EXT-5 grant_response_paragraph export-candidate content-type evolution migration';
  END IF;

  SELECT pg_get_constraintdef(c.oid)
    INTO candidate_def
    FROM pg_constraint c
   WHERE c.conrelid = 'kai.export_candidates'::regclass
     AND c.conname = 'export_candidates_p3_16_content_type_check'
     AND c.contype = 'c';

  IF candidate_def IS NULL THEN
    RAISE EXCEPTION
      'export_candidates_p3_16_content_type_check is required (P3-16/P14-15/P13-EXT-1/P13-EXT-2/P13-EXT-3/P13-EXT-4) before P13-EXT-5';
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
        'data_gap_memo',
        'case_for_support',
        'board_update',
        'annual_report_section',
        'funder_outcome_table',
        'grant_response_paragraph'
      )
    );

COMMIT;
