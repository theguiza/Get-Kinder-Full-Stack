BEGIN;

-- P13-EXT-1 adds the fifth generated-content type, case_for_support, to the
-- application vocabulary (ALLOWED_GENERATED_CONTENT_TYPES in
-- Backend/kai/dictionary/postgresGeneratedContentRepository.js), following
-- the exact widening pattern P14-14 already used to add readiness_assessment
-- and data_gap_memo. Without this migration, every case_for_support
-- generation would fail at the kai.generation_runs insert with a real
-- PostgreSQL 23514 check_violation on generation_runs_p3_01_content_type_check,
-- which the repository catches and surfaces as VAL-GEN-PERSIST-P0-001 /
-- persistence_validation_rejected (HTTP 422). This migration widens exactly
-- those two named constraints and touches nothing else: no fingerprint,
-- requested_audience, draft_status, review_status, created_by_type, foreign
-- key, uniqueness, tenant/organization, review-queue, or audit-contract
-- constraint is modified. case_for_support is not added to any Grant
-- Response Packet or Board Reporting membership set - those remain scoped
-- exactly as before.

DO $$
BEGIN
  IF to_regclass('kai.generation_runs') IS NULL THEN
    RAISE EXCEPTION 'kai.generation_runs is required before P13-EXT-1 case_for_support content-type evolution migration';
  END IF;
  IF to_regclass('kai.generated_content_drafts') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_drafts is required before P13-EXT-1 case_for_support content-type evolution migration';
  END IF;
END $$;

-- Fail closed if the P14-14 predecessor constraints are not in the exact
-- state this migration expects to evolve from (guards against running out
-- of order, against an already-different unexpected constraint shape, and
-- makes this migration idempotent if it is ever re-run after itself).
DO $$
DECLARE
  runs_def text;
  drafts_def text;
  predecessor_def CONSTANT text := 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text])))';
  target_def CONSTANT text := 'CHECK ((content_type = ANY (ARRAY[''evidence_summary''::text, ''impact_narrative''::text, ''readiness_assessment''::text, ''data_gap_memo''::text, ''case_for_support''::text])))';
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO runs_def
    FROM pg_constraint c
   WHERE c.conrelid = 'kai.generation_runs'::regclass
     AND c.conname = 'generation_runs_p3_01_content_type_check';

  SELECT pg_get_constraintdef(c.oid) INTO drafts_def
    FROM pg_constraint c
   WHERE c.conrelid = 'kai.generated_content_drafts'::regclass
     AND c.conname = 'generated_content_drafts_p3_01_content_type_check';

  IF runs_def IS NULL THEN
    RAISE EXCEPTION 'generation_runs_p3_01_content_type_check is required (P3-01/P13-01/P14-14) before P13-EXT-1 case_for_support content-type evolution migration';
  END IF;
  IF drafts_def IS NULL THEN
    RAISE EXCEPTION 'generated_content_drafts_p3_01_content_type_check is required (P3-01/P13-01/P14-14) before P13-EXT-1 case_for_support content-type evolution migration';
  END IF;

  IF runs_def <> predecessor_def AND runs_def <> target_def THEN
    RAISE EXCEPTION 'generation_runs_p3_01_content_type_check has an unexpected definition (%) - refusing to widen a constraint shape this migration does not recognize', runs_def;
  END IF;
  IF drafts_def <> predecessor_def AND drafts_def <> target_def THEN
    RAISE EXCEPTION 'generated_content_drafts_p3_01_content_type_check has an unexpected definition (%) - refusing to widen a constraint shape this migration does not recognize', drafts_def;
  END IF;
END $$;

ALTER TABLE kai.generation_runs
  DROP CONSTRAINT IF EXISTS generation_runs_p3_01_content_type_check,
  ADD CONSTRAINT generation_runs_p3_01_content_type_check
    CHECK (content_type IN ('evidence_summary', 'impact_narrative', 'readiness_assessment', 'data_gap_memo', 'case_for_support'));

ALTER TABLE kai.generated_content_drafts
  DROP CONSTRAINT IF EXISTS generated_content_drafts_p3_01_content_type_check,
  ADD CONSTRAINT generated_content_drafts_p3_01_content_type_check
    CHECK (content_type IN ('evidence_summary', 'impact_narrative', 'readiness_assessment', 'data_gap_memo', 'case_for_support'));

COMMIT;
