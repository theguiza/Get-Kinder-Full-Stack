BEGIN;

-- ==========================================================================
-- KAI legacy-generation cutover (2026-08-17)
--
-- Root cause this migration addresses: production's kai.intake_source_candidates
-- (and its P1-04/P1-05/P1-08 lineage neighbors: kai.intake_file_profiles,
-- kai.data_dictionaries, kai.intake_sensitivity_profiles,
-- kai.intake_promotion_decisions, kai.sources, kai.source_versions) are an
-- entirely different, older data-model generation than the one the current
-- repository's P1-04 through P1-08 migrations and read models require. This was
-- confirmed against a real, read-only production catalog dump (columns,
-- constraints, indexes) supplied by the repository owner on 2026-08-17 - not
-- inferred, not guessed. The production shapes carry no `file_profile_id`,
-- `data_dictionary_id`, `intake_sensitivity_profile_id`, or
-- `profile_canonical_sha256` value anywhere, and their own lineage tables
-- (intake_file_profiles/data_dictionaries/intake_sensitivity_profiles) relate to
-- each other only through a shared, non-unique intake_file_id - there is no
-- deterministic single tuple to derive per legacy candidate, and no column
-- anywhere stores a real profile_canonical_sha256 value to backfill from.
--
-- This migration therefore does NOT attempt to translate legacy rows into
-- canonical P1 rows and does NOT fabricate lineage or a canonical hash for any
-- of them. It relocates the incompatible legacy tables intact, unmodified, into
-- a preserved schema (kai_legacy_20260817), freeing the canonical kai.* names so
-- the already-accepted P1 migrations (kai_sprint2_p1_parser_run_and_file_profile,
-- p1_04, p1_05, p1_06, p1_07, p1_08 - none of which are edited by this file) can
-- be applied immediately afterward, unmodified, to install the real canonical
-- tables. New canonical rows are then produced only by reprocessing an actual
-- intake file through the existing, real P1 producer chain
-- (activateParserProfileWorkForIntakeFile -> createDraftDataDictionary ->
-- persistIntakeSensitivityProfile -> createSensitivityReviewQueueItem ->
-- createSourceCandidateStub) - see
-- scripts/kai-sprint2-legacy-cutover-synthetic-reprocessor.js - never by this
-- migration.
--
-- Scope decisions proven by repository inspection (Backend/kai/**, migrations/,
-- and the supplied production catalog), not assumed:
--
-- - kai.intake_files and kai.upload_lifecycle_audit already carry this
--   repository's own Gate A/Gate C1 constraint names in production (for example
--   intake_files_gate_a_upload_state_check, intake_files_gate_c1_gcs_generation_
--   positive_check) - proof they were created/altered by this codebase's own
--   accepted migrations, not the legacy generation. They are left untouched.
-- - kai.review_queue_items is NOT a legacy-only table: it is already live today
--   under queue_type = 'intake_file_review' via already-wired repository code
--   (Backend/kai/db/kaiIntakeQueries.js insertReviewQueueItem /
--   updateReviewQueueItemStatusIfCurrent, reached from
--   Backend/kai/routes/sprint2IntakeApi.js). Its production shape does not carry
--   this repository's P1-06-named constraints, but its queue_type/queue_status
--   CHECK vocabularies already include every literal the canonical P1-06/P1-07/
--   P1-08 code writes. Relocating this table would delete a table live callers
--   read/write today, so it is never moved: this migration only ADDS (never
--   drops/replaces) the two specific named CHECK constraints
--   (review_queue_items_p1_06_queue_type_check,
--   review_queue_items_p1_06_queue_status_check) that the already-accepted
--   P1-07/P1-08 migrations' own prerequisite guards require by name, plus two
--   narrowly-scoped (partial, queue_type-restricted) unique indexes that cannot
--   affect any existing row of any other queue_type.
-- - kai.intake_file_profiles, kai.data_dictionaries, kai.intake_sensitivity_
--   profiles, kai.intake_source_candidates, kai.intake_promotion_decisions,
--   kai.sources, kai.source_versions have no current-repository caller that
--   still requires their legacy shape (every Backend/kai/** reader/writer of
--   these seven already codes against the canonical P1-04/05/07/08 contract, and
--   grep of the entire tracked repository - including frontend/, views/, and
--   Backend/routes/kaiApi.js - found zero code referencing the legacy-only
--   columns such as proposed_display_name, dashboard_visibility, or
--   classification_review_status). These seven are the ones relocated.
-- - kai.intake_parser_runs, kai.data_dictionary_fields, kai.data_dictionary_
--   mappings, kai.data_quality_findings were not present in the supplied
--   production catalog. This migration does not guess their state: if any of
--   them already exists, it must already be exactly canonical (verified below)
--   or this migration fails closed rather than assume a legacy shape it has no
--   evidence for.
-- ==========================================================================

DO $$
DECLARE
  legacy_schema_name text := 'kai_legacy_20260817';
BEGIN
  -- ------------------------------------------------------------------------
  -- 0. Preserved-legacy-schema collision guard: never overwrite a prior run's
  --    preserved data under an unexpected pre-existing schema of this name.
  -- ------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM pg_namespace WHERE nspname = legacy_schema_name
  ) THEN
    -- Idempotent-safe rerun: if the legacy schema already holds the relocated
    -- tables and kai.intake_source_candidates is either not yet reinstalled
    -- (relocation-only rerun, before the canonical P1 migrations have run) or
    -- already the canonical shape (full rerun after cutover completed), this
    -- migration has already relocated everything it is responsible for; do
    -- nothing further. Only an unrecognized third state is refused.
    IF to_regclass(legacy_schema_name || '.intake_source_candidates') IS NOT NULL
       AND (
         to_regclass('kai.intake_source_candidates') IS NULL
         OR EXISTS (
           SELECT 1 FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'intake_source_candidates'
              AND c.conname = 'intake_source_candidates_p1_07_identity_unique'
         )
       )
    THEN
      RAISE NOTICE 'kai legacy-generation cutover already applied; no-op rerun.';
      RETURN;
    END IF;
    RAISE EXCEPTION 'schema % already exists but does not match the expected post-cutover state; refusing to guess', legacy_schema_name;
  END IF;

  -- ------------------------------------------------------------------------
  -- 1. Prerequisite facts this migration relies on and never installs itself.
  -- ------------------------------------------------------------------------
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before the legacy-generation cutover';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'intake_files'
       AND c.conname = 'intake_files_gate_a_upload_state_check'
  ) THEN
    RAISE EXCEPTION 'kai.intake_files does not carry the expected Gate A canonical contract (intake_files_gate_a_upload_state_check); refusing to guess its compatibility';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before the legacy-generation cutover';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai' AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before the legacy-generation cutover';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before the legacy-generation cutover';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%source_candidate_review%'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items.queue_type CHECK does not already permit source_candidate_review; refusing to guess a compatible shape';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review%'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items.queue_type CHECK does not already permit sensitivity_review; refusing to guess a compatible shape';
  END IF;

  -- ------------------------------------------------------------------------
  -- 2. Per-table shape classification for the seven relocation candidates.
  --    CANONICAL -> already correct, nothing to relocate for this table.
  --    LEGACY    -> exact production shape proven by the supplied catalog;
  --                 relocated below.
  --    anything else -> RAISE EXCEPTION (unsupported/unknown shape).
  -- ------------------------------------------------------------------------

  -- kai.intake_source_candidates
  IF to_regclass('kai.intake_source_candidates') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'intake_source_candidates' AND c.conname = 'intake_source_candidates_p1_07_identity_unique'
    ) THEN
      NULL; -- already canonical
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_source_candidates' AND column_name = 'file_profile_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_source_candidates' AND column_name = 'proposed_display_name'
    ) THEN
      NULL; -- proven legacy shape; relocated in section 3
    ELSE
      RAISE EXCEPTION 'kai.intake_source_candidates does not match any supported canonical or legacy shape';
    END IF;
  END IF;

  -- kai.intake_file_profiles
  IF to_regclass('kai.intake_file_profiles') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_file_profiles' AND column_name = 'profile_canonical_sha256'
    ) THEN
      NULL; -- already canonical
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_file_profiles' AND column_name = 'profile_canonical_sha256'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_file_profiles' AND column_name = 'detected_columns'
    ) THEN
      NULL; -- proven legacy shape
    ELSE
      RAISE EXCEPTION 'kai.intake_file_profiles does not match any supported canonical or legacy shape';
    END IF;
  END IF;

  -- kai.data_dictionaries
  IF to_regclass('kai.data_dictionaries') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'data_dictionaries' AND column_name = 'file_profile_id'
    ) THEN
      NULL; -- already canonical
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'data_dictionaries' AND column_name = 'file_profile_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'data_dictionaries' AND column_name = 'dictionary_metadata'
    ) THEN
      NULL; -- proven legacy shape
    ELSE
      RAISE EXCEPTION 'kai.data_dictionaries does not match any supported canonical or legacy shape';
    END IF;
  END IF;

  -- kai.intake_sensitivity_profiles
  IF to_regclass('kai.intake_sensitivity_profiles') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_sensitivity_profiles' AND column_name = 'data_dictionary_id'
    ) THEN
      NULL; -- already canonical
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_sensitivity_profiles' AND column_name = 'data_dictionary_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_sensitivity_profiles' AND column_name = 'consent_scope'
    ) THEN
      NULL; -- proven legacy shape
    ELSE
      RAISE EXCEPTION 'kai.intake_sensitivity_profiles does not match any supported canonical or legacy shape';
    END IF;
  END IF;

  -- kai.intake_promotion_decisions
  IF to_regclass('kai.intake_promotion_decisions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_promotion_decisions' AND column_name = 'review_queue_item_id'
    ) THEN
      NULL; -- already canonical
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_promotion_decisions' AND column_name = 'review_queue_item_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'intake_promotion_decisions' AND column_name = 'decision_by'
    ) THEN
      NULL; -- proven legacy shape
    ELSE
      RAISE EXCEPTION 'kai.intake_promotion_decisions does not match any supported canonical or legacy shape';
    END IF;
  END IF;

  -- kai.sources
  IF to_regclass('kai.sources') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'sources' AND c.conname = 'sources_p1_08_identity_unique'
    ) THEN
      NULL; -- already canonical
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'sources' AND c.conname = 'sources_p1_08_identity_unique'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'sources' AND column_name = 'display_name'
    ) THEN
      NULL; -- proven legacy shape
    ELSE
      RAISE EXCEPTION 'kai.sources does not match any supported canonical or legacy shape';
    END IF;
  END IF;

  -- kai.source_versions
  IF to_regclass('kai.source_versions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'source_versions' AND c.conname = 'source_versions_p1_08_id_org_unique'
    ) THEN
      NULL; -- already canonical
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'source_versions' AND c.conname = 'source_versions_p1_08_id_org_unique'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'kai' AND table_name = 'source_versions' AND column_name = 'version_number'
    ) THEN
      NULL; -- proven legacy shape
    ELSE
      RAISE EXCEPTION 'kai.source_versions does not match any supported canonical or legacy shape';
    END IF;
  END IF;

  -- ------------------------------------------------------------------------
  -- 3. Downstream-dependent-object guard: a legacy-generation kai.source_versions
  --    could in principle already be depended on by P2-01/P2-04 tables outside
  --    this migration's scope. Their own accepted migrations guard on
  --    source_versions_p1_08_id_org_unique existing first, so if source_versions
  --    is still in its legacy shape, those tables cannot exist yet - verified,
  --    not assumed.
  -- ------------------------------------------------------------------------
  IF to_regclass('kai.source_versions') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'kai' AND r.relname = 'source_versions' AND c.conname = 'source_versions_p1_08_id_org_unique'
     )
  THEN
    IF to_regclass('kai.source_locators') IS NOT NULL THEN
      RAISE EXCEPTION 'kai.source_locators already exists against a legacy-shaped kai.source_versions; refusing to relocate without independent review';
    END IF;
    IF to_regclass('kai.evidence_items') IS NOT NULL THEN
      RAISE EXCEPTION 'kai.evidence_items already exists against a legacy-shaped kai.source_versions; refusing to relocate without independent review';
    END IF;
    IF to_regclass('kai.gap_log_items') IS NOT NULL THEN
      RAISE EXCEPTION 'kai.gap_log_items already exists against a legacy-shaped kai.source_versions; refusing to relocate without independent review';
    END IF;
  END IF;

  -- ------------------------------------------------------------------------
  -- 4. Group-U tables not covered by the supplied production catalog: fail
  --    closed on any unrecognized existing shape rather than guess.
  -- ------------------------------------------------------------------------
  IF to_regclass('kai.intake_parser_runs') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'intake_parser_runs' AND c.conname = 'intake_parser_runs_p1_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_parser_runs exists but is not the canonical shape and no legacy shape for it was supplied; refusing to guess';
  END IF;
  IF to_regclass('kai.data_dictionary_fields') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'data_dictionary_fields' AND column_name = 'profile_field_key'
  ) THEN
    RAISE EXCEPTION 'kai.data_dictionary_fields exists but is not the canonical shape and no legacy shape for it was supplied; refusing to guess';
  END IF;
  IF to_regclass('kai.data_dictionary_mappings') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'data_dictionary_mappings' AND column_name = 'data_dictionary_field_id'
  ) THEN
    RAISE EXCEPTION 'kai.data_dictionary_mappings exists but is not the canonical shape and no legacy shape for it was supplied; refusing to guess';
  END IF;
  IF to_regclass('kai.data_quality_findings') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'data_quality_findings' AND column_name = 'finding_type'
  ) THEN
    RAISE EXCEPTION 'kai.data_quality_findings exists but is not the canonical shape and no legacy shape for it was supplied; refusing to guess';
  END IF;

  -- ------------------------------------------------------------------------
  -- 5. Relocate every table proven to be in its legacy shape, intact, with all
  --    rows, identities, and mutual relationships preserved. SET SCHEMA does
  --    not touch row data or drop/recreate constraints - foreign keys between
  --    relocated tables keep working across the schema boundary.
  -- ------------------------------------------------------------------------
  CREATE SCHEMA IF NOT EXISTS kai_legacy_20260817;

  IF to_regclass('kai.intake_promotion_decisions') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'intake_promotion_decisions' AND column_name = 'review_queue_item_id'
  ) THEN
    ALTER TABLE kai.intake_promotion_decisions SET SCHEMA kai_legacy_20260817;
  END IF;

  IF to_regclass('kai.source_versions') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'source_versions' AND c.conname = 'source_versions_p1_08_id_org_unique'
  ) THEN
    ALTER TABLE kai.source_versions SET SCHEMA kai_legacy_20260817;
  END IF;

  IF to_regclass('kai.sources') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'sources' AND c.conname = 'sources_p1_08_identity_unique'
  ) THEN
    ALTER TABLE kai.sources SET SCHEMA kai_legacy_20260817;
  END IF;

  IF to_regclass('kai.intake_source_candidates') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'intake_source_candidates' AND column_name = 'file_profile_id'
  ) THEN
    ALTER TABLE kai.intake_source_candidates SET SCHEMA kai_legacy_20260817;
  END IF;

  IF to_regclass('kai.intake_sensitivity_profiles') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'intake_sensitivity_profiles' AND column_name = 'data_dictionary_id'
  ) THEN
    ALTER TABLE kai.intake_sensitivity_profiles SET SCHEMA kai_legacy_20260817;
  END IF;

  IF to_regclass('kai.data_dictionaries') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'data_dictionaries' AND column_name = 'file_profile_id'
  ) THEN
    ALTER TABLE kai.data_dictionaries SET SCHEMA kai_legacy_20260817;
  END IF;

  IF to_regclass('kai.intake_file_profiles') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'intake_file_profiles' AND column_name = 'profile_canonical_sha256'
  ) THEN
    ALTER TABLE kai.intake_file_profiles SET SCHEMA kai_legacy_20260817;
  END IF;

  -- ------------------------------------------------------------------------
  -- 6. Additive-only changes to the shared, live kai.review_queue_items table.
  --    Never dropped/replaced: the table's existing (unnamed, production)
  --    CHECK constraints are left exactly as they are. The two named
  --    constraints below are required, by name, by the already-accepted P1-07
  --    and P1-08 migrations' own prerequisite guards; adding them re-validates
  --    every existing row against the SAME vocabulary the existing unnamed
  --    constraints already enforce (proven compatible against the supplied
  --    production catalog), so no existing row of any queue_type can be
  --    rejected by this ADD CONSTRAINT unless it already violated its own
  --    table's existing CHECK - in which case this migration fails closed
  --    rather than silently accept a row outside the vocabulary. The two
  --    partial (queue_type-scoped) indexes are WHERE-scoped to queue_types no
  --    legacy or currently-wired code writes, so no existing row of any other
  --    queue_type is touched or re-validated.
  -- ------------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.conname = 'review_queue_items_p1_06_queue_type_check'
  ) THEN
    ALTER TABLE kai.review_queue_items
      ADD CONSTRAINT review_queue_items_p1_06_queue_type_check
      CHECK (queue_type IN (
        'intake_file_review', 'source_candidate_review', 'sensitivity_review',
        'data_dictionary_review', 'evidence_review', 'claim_review', 'client_followup',
        'conflict_resolution', 'generated_content_review', 'export_review'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.conname = 'review_queue_items_p1_06_queue_status_check'
  ) THEN
    ALTER TABLE kai.review_queue_items
      ADD CONSTRAINT review_queue_items_p1_06_queue_status_check
      CHECK (queue_status IN ('open', 'in_progress', 'blocked', 'waiting_on_client', 'waiting_on_gk', 'resolved', 'cancelled'));
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p1_06_sensitivity_review_identity
    ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
    WHERE queue_type = 'sensitivity_review';

  CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p1_07_source_candidate_review_identity
    ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
    WHERE queue_type = 'source_candidate_review';
END $$;

COMMIT;
