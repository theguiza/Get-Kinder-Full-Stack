-- ==========================================================================
-- PRE_REPROCESSING_ROLLBACK for the KAI legacy-generation cutover
-- (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql).
--
-- ONE atomic, pgAdmin-Query-Tool-executable transaction. No psql
-- meta-commands, no \i, no DATABASE_URL, no external transaction wrapper.
--
-- SCOPE - READ THIS BEFORE RUNNING
--
--   PRE_REPROCESSING_ROLLBACK (what this file is): valid ONLY while no canonical
--   row has been produced yet - that is, after the cutover bundle committed and
--   BEFORE any authorized synthetic canonical reprocessing operation has run. In
--   that window the canonical tables this cutover installed are still empty, so
--   dropping them loses nothing, and moving the preserved legacy tables back
--   restores the exact pre-cutover state: same relation OIDs, same rows, same
--   primary keys, same constraints, same indexes, same foreign keys, same
--   dependent-table edges. This file refuses to run outside that window.
--
--   POST_REPROCESSING_RECOVERY (what this file is NOT): once genuine canonical
--   rows exist - a real intake_file_profiles row with a real
--   profile_canonical_sha256, its data dictionary, its sensitivity profile, its
--   review-queue item, its source candidate - dropping the canonical tables
--   would destroy authentic, human-and-producer-generated records that have no
--   legacy equivalent and cannot be reconstructed from the preserved legacy
--   graph. There is deliberately no such procedure in this file. If recovery is
--   needed after reprocessing, it must be designed, reviewed and proved as its
--   own package; this file will refuse and say so rather than pretend the simple
--   rollback is safe.
--
-- What this rollback restores: names, locations, rows, identities, constraints,
-- indexes and dependency edges. What it cannot restore: the review_queue_items
-- updated_at timestamps that the canonical P1-06 trigger bumped on the rows the
-- cutover marked. Those rows' own business facts (queue_type, queue_status,
-- review_status, target, summary, required_action, assignment) are restored
-- exactly, and the marker key is removed.
-- ==========================================================================

BEGIN;

DO $rollback$
DECLARE
  legacy_schema_name constant text := 'kai_legacy_20260817';
  material           constant text[] := ARRAY[
    'intake_parser_runs', 'intake_file_profiles', 'data_dictionaries',
    'data_dictionary_fields', 'data_dictionary_mappings', 'data_quality_findings',
    'intake_sensitivity_profiles', 'intake_source_candidates',
    'intake_promotion_decisions', 'sources', 'source_versions',
    'source_locators', 'evidence_items'
  ];
  -- Canonical-only tables the cutover installed which have no legacy namesake to
  -- restore; they are dropped, in dependency order, only when provably empty.
  canonical_only     constant text[] := ARRAY[]::text[];
  target             text;
  canonical_rows     bigint;
BEGIN
  -- 1. Refuse unless the preserved legacy set is complete.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = legacy_schema_name) THEN
    RAISE EXCEPTION 'schema % does not exist; there is no cutover to roll back', legacy_schema_name;
  END IF;
  FOREACH target IN ARRAY material LOOP
    IF to_regclass(legacy_schema_name || '.' || target) IS NULL THEN
      RAISE EXCEPTION 'preserved legacy table %.% is missing; refusing to roll back a state this file does not recognise',
        legacy_schema_name, target;
    END IF;
  END LOOP;

  -- 2. Refuse if ANY canonical row exists anywhere in the installed canonical
  --    generation: that is the POST_REPROCESSING_RECOVERY case, which this file
  --    does not implement and must not approximate.
  FOREACH target IN ARRAY material LOOP
    CONTINUE WHEN to_regclass('kai.' || target) IS NULL;
    EXECUTE format('SELECT count(*) FROM kai.%I', target) INTO canonical_rows;
    IF canonical_rows > 0 THEN
      RAISE EXCEPTION 'kai.% already holds % canonical row(s). This is PRE_REPROCESSING_ROLLBACK only: dropping that table would destroy genuine canonical records that cannot be reconstructed from the preserved legacy graph. POST_REPROCESSING_RECOVERY is a separate, unimplemented, independently-reviewed procedure - do not approximate it with this file.',
        target, canonical_rows;
    END IF;
  END LOOP;

  -- 3. Undo the additive review_queue_items changes. The marker key is removed;
  --    no other column of any queue row was ever changed by the cutover, so
  --    nothing else needs restoring.
  UPDATE kai.review_queue_items
     SET queue_metadata = queue_metadata - 'kai_legacy_generation_target'
   WHERE queue_metadata ? 'kai_legacy_generation_target';

  -- 4. Drop the empty canonical tables the cutover installed, freeing the kai.*
  --    names again. Reverse dependency order, and BEFORE the shared
  --    review_queue_items constraints below, because the canonical
  --    intake_promotion_decisions_p1_08_review_queue_item_fk depends on the
  --    review_queue_items_p1_08_identity_unique index. CASCADE is never used, so
  --    an unexpected dependant aborts the whole rollback instead of being
  --    silently destroyed.
  -- The canonical parser-run / file-profile pair reference each other, so the
  -- one cross edge is dropped explicitly first. Named, single, and only on a
  -- canonical table this cutover installed itself.
  ALTER TABLE IF EXISTS kai.intake_parser_runs
    DROP CONSTRAINT IF EXISTS intake_parser_runs_p1_output_profile_fk;

  DROP TABLE IF EXISTS kai.evidence_items;
  DROP TABLE IF EXISTS kai.source_locators;
  DROP TABLE IF EXISTS kai.intake_promotion_decisions;
  DROP TABLE IF EXISTS kai.source_versions;
  DROP TABLE IF EXISTS kai.sources;
  DROP TABLE IF EXISTS kai.intake_source_candidates;
  DROP TABLE IF EXISTS kai.intake_sensitivity_profiles;
  DROP TABLE IF EXISTS kai.data_quality_findings;
  DROP TABLE IF EXISTS kai.data_dictionary_mappings;
  DROP TABLE IF EXISTS kai.data_dictionary_fields;
  DROP TABLE IF EXISTS kai.data_dictionaries;
  DROP TABLE IF EXISTS kai.intake_file_profiles;
  DROP TABLE IF EXISTS kai.intake_parser_runs;
  FOREACH target IN ARRAY canonical_only LOOP
    EXECUTE format('DROP TABLE IF EXISTS kai.%I', target);
  END LOOP;

  -- 4b. Now the shared review_queue_items additions can be undone safely.
  ALTER TABLE kai.review_queue_items
    DROP CONSTRAINT IF EXISTS review_queue_items_p1_06_queue_type_check,
    DROP CONSTRAINT IF EXISTS review_queue_items_p1_06_queue_status_check,
    DROP CONSTRAINT IF EXISTS review_queue_items_p1_08_identity_unique,
    DROP CONSTRAINT IF EXISTS review_queue_items_cutover_priority_compat_check;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema = 'kai' AND c.table_name = 'review_queue_items'
       AND c.column_name = 'priority' AND c.data_type = 'text'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM kai.review_queue_items
       WHERE priority NOT IN (
         'mandatory', 'immediate_fix', 'high', 'medium', 'low', 'backlog',
         'not_applicable', 'unknown'
       )
    ) THEN
      RAISE EXCEPTION 'review_queue_items.priority contains values outside the pre-cutover priority_enum vocabulary; this is PRE_REPROCESSING_ROLLBACK only and will not discard or remap canonical priority values';
    END IF;

    ALTER TABLE kai.review_queue_items ALTER COLUMN priority DROP DEFAULT;
    ALTER TABLE kai.review_queue_items
      ALTER COLUMN priority TYPE kai.priority_enum USING priority::kai.priority_enum;
    ALTER TABLE kai.review_queue_items ALTER COLUMN priority SET DEFAULT 'medium'::kai.priority_enum;
  END IF;

  ALTER TABLE kai.upload_lifecycle_audit
    DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_operation_check,
    ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
      CHECK (operation = ANY (ARRAY[
        'reserve_upload'::text,
        'start_upload'::text,
        'complete_object_version'::text,
        'confirm_upload'::text,
        'block_upload'::text,
        'abandon_upload'::text,
        'expire_upload'::text,
        'policy_decision_compare_and_set'::text
      ]));

  ALTER TABLE kai.upload_lifecycle_audit
    DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_metadata_object_check,
    ADD CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check
      CHECK (
        jsonb_typeof(metadata) = 'object'::text
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND (
          operation <> 'policy_decision_compare_and_set'::text
          OR (
            metadata ? 'metadata_only'::text
            AND metadata ? 'contract'::text
            AND metadata ? 'file_policy_status'::text
            AND metadata ? 'policy_decision_outcome'::text
            AND metadata ? 'object_version_bound'::text
            AND metadata ? 'verified_checksum_bound'::text
            AND metadata ? 'verified_size_bytes_bound'::text
            AND metadata ? 'declared_mime'::text
            AND metadata ? 'extension'::text
            AND metadata ? 'replay_contract_version'::text
            AND metadata ? 'validator_key'::text
            AND NOT metadata ? 'sanitized_result'::text
            AND (metadata - ARRAY[
              'metadata_only'::text,
              'contract'::text,
              'file_policy_status'::text,
              'policy_decision_outcome'::text,
              'object_version_bound'::text,
              'verified_checksum_bound'::text,
              'verified_size_bytes_bound'::text,
              'declared_mime'::text,
              'extension'::text,
              'replay_contract_version'::text,
              'validator_key'::text
            ]) = '{}'::jsonb
          )
        )
      );

  DROP INDEX IF EXISTS kai.ux_review_queue_items_p2_01_evidence_review_identity;
  DROP INDEX IF EXISTS kai.ux_review_queue_items_p1_06_sensitivity_review_identity;
  DROP INDEX IF EXISTS kai.ux_review_queue_items_p1_07_source_candidate_review_identity;
  DROP INDEX IF EXISTS kai.ix_review_queue_items_p1_06_tenant_queue;
  DROP TRIGGER IF EXISTS trg_review_queue_items_p1_06_touch_updated_at ON kai.review_queue_items;
  DROP FUNCTION IF EXISTS kai.review_queue_items_p1_06_touch_updated_at();

  -- 5. Move every preserved legacy table back to kai, intact. Exactly the
  --    inverse of the forward relocation, and equally non-destructive: no heap
  --    is rewritten, no constraint is dropped or revalidated, every foreign key
  --    keeps binding by OID.
  FOREACH target IN ARRAY ARRAY[
    'intake_file_profiles', 'intake_parser_runs', 'sources', 'source_versions',
    'data_dictionaries', 'data_dictionary_fields', 'data_dictionary_mappings',
    'data_quality_findings', 'intake_sensitivity_profiles',
    'intake_source_candidates', 'intake_promotion_decisions',
    'source_locators', 'evidence_items'
  ] LOOP
    EXECUTE format('ALTER TABLE %I.%I SET SCHEMA kai', legacy_schema_name, target);
  END LOOP;

  DROP SCHEMA IF EXISTS kai_legacy_20260817 RESTRICT;

  -- 6. Post-rollback assertions, still inside the transaction.
  FOREACH target IN ARRAY material LOOP
    IF to_regclass('kai.' || target) IS NULL THEN
      RAISE EXCEPTION 'rollback assertion failed: kai.% was not restored', target;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = legacy_schema_name) THEN
    RAISE EXCEPTION 'rollback assertion failed: schema % still exists, so something unexpected remained inside it',
      legacy_schema_name;
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.review_queue_items WHERE queue_metadata ? 'kai_legacy_generation_target'
  ) THEN
    RAISE EXCEPTION 'rollback assertion failed: a legacy-generation queue marker survived the rollback';
  END IF;
  IF to_regclass('kai.intake_files') IS NULL OR to_regclass('kai.review_queue_items') IS NULL
     OR to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'rollback assertion failed: a shared table is missing';
  END IF;

  RAISE NOTICE 'kai legacy-generation cutover: PRE_REPROCESSING_ROLLBACK complete; the pre-cutover legacy state is restored.';
END $rollback$;

COMMIT;
