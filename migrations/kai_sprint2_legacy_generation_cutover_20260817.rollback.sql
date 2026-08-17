BEGIN;

-- ==========================================================================
-- Rollback for kai_sprint2_legacy_generation_cutover_20260817.sql.
--
-- LOSSLESS ONLY BEFORE any of the subsequent canonical P1 migrations
-- (kai_sprint2_p1_parser_run_and_file_profile, p1_04, p1_05, p1_07, p1_08) have
-- been applied. This file only reverses the schema relocation: it moves the
-- seven legacy tables (if present under kai_legacy_20260817) back to kai.*, and
-- drops the two additive review_queue_items indexes. It does not and cannot
-- reverse canonical writes that happened after those later migrations ran - if
-- any canonical kai.intake_source_candidates/kai.sources/etc. row already
-- exists, this rollback refuses to run rather than silently destroy or
-- shadow it. A rollback after canonical writes exist requires first running
-- each already-accepted P1 migration's own .rollback.sql file, in reverse
-- dependency order (p1_08 -> p1_07 -> p1_06 -> p1_05 -> p1_04 -> parser_run),
-- to remove the canonical tables/columns those migrations installed, and only
-- then running this file.
-- ==========================================================================

DO $$
BEGIN
  IF to_regclass('kai_legacy_20260817.intake_source_candidates') IS NULL THEN
    RAISE NOTICE 'kai_legacy_20260817 not present; nothing to roll back.';
    RETURN;
  END IF;

  IF to_regclass('kai.intake_source_candidates') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'intake_source_candidates' AND c.conname = 'intake_source_candidates_p1_07_identity_unique'
  ) THEN
    RAISE EXCEPTION 'canonical kai.intake_source_candidates already exists; this rollback only reverses the pre-canonical-write relocation step. Run the accepted P1-08/P1-07/P1-06/P1-05/P1-04/parser-run rollbacks first, then re-run this file.';
  END IF;

  IF to_regclass('kai.intake_source_candidates') IS NOT NULL THEN
    RAISE EXCEPTION 'a table already exists at kai.intake_source_candidates that is neither the expected canonical shape nor absent; refusing to guess how to proceed';
  END IF;

  DROP INDEX IF EXISTS kai.ux_review_queue_items_p1_06_sensitivity_review_identity;
  DROP INDEX IF EXISTS kai.ux_review_queue_items_p1_07_source_candidate_review_identity;

  ALTER TABLE kai_legacy_20260817.intake_file_profiles SET SCHEMA kai;
  ALTER TABLE kai_legacy_20260817.data_dictionaries SET SCHEMA kai;
  ALTER TABLE kai_legacy_20260817.intake_sensitivity_profiles SET SCHEMA kai;
  ALTER TABLE kai_legacy_20260817.intake_source_candidates SET SCHEMA kai;
  ALTER TABLE kai_legacy_20260817.sources SET SCHEMA kai;
  ALTER TABLE kai_legacy_20260817.source_versions SET SCHEMA kai;
  ALTER TABLE kai_legacy_20260817.intake_promotion_decisions SET SCHEMA kai;

  DROP SCHEMA kai_legacy_20260817;
END $$;

COMMIT;
