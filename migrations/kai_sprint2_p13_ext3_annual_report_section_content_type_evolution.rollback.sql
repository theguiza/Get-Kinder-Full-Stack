BEGIN;

-- Reverts kai.generation_runs and kai.generated_content_drafts content_type
-- CHECK constraints to the P13-EXT-2 vocabulary (evidence_summary,
-- impact_narrative, readiness_assessment, data_gap_memo, case_for_support,
-- board_update). Fails closed if any annual_report_section row already
-- exists - narrowing the constraint under that data would either be
-- rejected by PostgreSQL immediately or (if rows were deleted first)
-- silently destroy governed generated content, neither of which this
-- rollback will do implicitly.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM kai.generation_runs
     WHERE content_type = 'annual_report_section'
  ) THEN
    RAISE EXCEPTION 'P13-EXT-3 rollback refused: kai.generation_runs holds annual_report_section rows; narrowing generation_runs_p3_01_content_type_check would violate on existing data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.generated_content_drafts
     WHERE content_type = 'annual_report_section'
  ) THEN
    RAISE EXCEPTION 'P13-EXT-3 rollback refused: kai.generated_content_drafts holds annual_report_section rows; narrowing generated_content_drafts_p3_01_content_type_check would violate on existing data';
  END IF;
END $$;

ALTER TABLE IF EXISTS kai.generated_content_drafts
  DROP CONSTRAINT IF EXISTS generated_content_drafts_p3_01_content_type_check,
  ADD CONSTRAINT generated_content_drafts_p3_01_content_type_check
    CHECK (content_type IN ('evidence_summary', 'impact_narrative', 'readiness_assessment', 'data_gap_memo', 'case_for_support', 'board_update'));

ALTER TABLE IF EXISTS kai.generation_runs
  DROP CONSTRAINT IF EXISTS generation_runs_p3_01_content_type_check,
  ADD CONSTRAINT generation_runs_p3_01_content_type_check
    CHECK (content_type IN ('evidence_summary', 'impact_narrative', 'readiness_assessment', 'data_gap_memo', 'case_for_support', 'board_update'));

COMMIT;
