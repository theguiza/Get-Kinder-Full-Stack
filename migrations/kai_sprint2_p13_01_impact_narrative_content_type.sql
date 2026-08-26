BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.generation_runs') IS NULL THEN
    RAISE EXCEPTION 'kai.generation_runs is required before P13-01 impact-narrative content-type migration';
  END IF;
  IF to_regclass('kai.generated_content_drafts') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_drafts is required before P13-01 impact-narrative content-type migration';
  END IF;
END $$;

ALTER TABLE kai.generation_runs
  DROP CONSTRAINT IF EXISTS generation_runs_p3_01_content_type_check,
  ADD CONSTRAINT generation_runs_p3_01_content_type_check
    CHECK (content_type IN ('evidence_summary', 'impact_narrative'));

ALTER TABLE kai.generated_content_drafts
  DROP CONSTRAINT IF EXISTS generated_content_drafts_p3_01_content_type_check,
  ADD CONSTRAINT generated_content_drafts_p3_01_content_type_check
    CHECK (content_type IN ('evidence_summary', 'impact_narrative'));

COMMIT;
