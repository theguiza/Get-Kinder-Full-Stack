-- ==========================================================================
-- READ-ONLY post-cutover verifier for the KAI legacy-generation cutover.
--
-- pgAdmin Query Tool compatible. Every statement is a SELECT; nothing is
-- mutated. Emits one result set: result_type, check_name, object_name, status,
-- detail. EVERY row must be PASS.
--
-- Output safety: catalog metadata, classifications and aggregate counts only -
-- no PII, filenames, storage locations, object keys, URLs, secrets, raw business
-- content, or identifying rows.
-- ==========================================================================

WITH material (table_name) AS (VALUES
  ('intake_parser_runs'), ('intake_file_profiles'), ('data_dictionaries'),
  ('data_dictionary_fields'), ('data_dictionary_mappings'), ('data_quality_findings'),
  ('intake_sensitivity_profiles'), ('intake_source_candidates'),
  ('intake_promotion_decisions'), ('sources'), ('source_versions'),
  ('source_locators'), ('evidence_items')
),
-- The subset the canonical P1 contract must own at kai.* after this cutover.
-- source_locators / evidence_items are handled separately below because their
-- legacy rows are preserved while empty canonical P2-01 tables are installed.
canonical_expected (table_name) AS (VALUES
  ('intake_parser_runs'), ('intake_file_profiles'), ('data_dictionaries'),
  ('data_dictionary_fields'), ('data_dictionary_mappings'), ('data_quality_findings'),
  ('intake_sensitivity_profiles'), ('intake_source_candidates'),
  ('intake_promotion_decisions'), ('sources'), ('source_versions')
),
checks AS (

  -- 1. Required canonical P1 objects exist at the kai.* names.
  SELECT 'CANONICAL' AS result_type, 'TABLE_EXISTS' AS check_name, 'kai.' || table_name AS object_name,
         CASE WHEN to_regclass('kai.' || table_name) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'canonical P1 table must exist at its kai.* name' AS detail
    FROM canonical_expected

  -- 2. Canonical contracts (columns + named constraints) the current repository
  --    code actually depends on.
  UNION ALL
  SELECT 'CANONICAL', 'COLUMN_EXISTS', 'kai.intake_source_candidates.' || col,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_source_candidates' AND column_name = col
         ) THEN 'PASS' ELSE 'FAIL' END,
         'read by getScopedSourceCandidateByIdentityForDisplay (Backend/kai/db/kaiIntakeQueries.js)'
    FROM unnest(ARRAY['intake_source_candidate_id','organization_id','intake_file_id','file_profile_id',
                      'data_dictionary_id','intake_sensitivity_profile_id','profile_canonical_sha256',
                      'proposed_source_type','candidate_status','created_at']) AS col
  UNION ALL
  SELECT 'CANONICAL', 'COLUMN_EXISTS', 'kai.intake_promotion_decisions.' || col,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_promotion_decisions' AND column_name = col
         ) THEN 'PASS' ELSE 'FAIL' END,
         'read by getScopedSourcePromotionDecisionByIdentityForDisplay'
    FROM unnest(ARRAY['intake_promotion_decision_id','organization_id','intake_source_candidate_id',
                      'review_queue_item_id','reviewed_source_type','decision_status','source_id',
                      'source_version_id','created_at','decided_at','promoted_at']) AS col
  UNION ALL
  SELECT 'CANONICAL', 'COLUMN_EXISTS', 'kai.sources.' || col,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'sources' AND column_name = col
         ) THEN 'PASS' ELSE 'FAIL' END,
         'read by getScopedSourceById'
    FROM unnest(ARRAY['source_id','organization_id','source_code','reviewed_source_type','created_at']) AS col
  UNION ALL
  SELECT 'CANONICAL', 'COLUMN_EXISTS', 'kai.source_versions.' || col,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'source_versions' AND column_name = col
         ) THEN 'PASS' ELSE 'FAIL' END,
         'read by getScopedSourceVersionById'
    FROM unnest(ARRAY['source_version_id','organization_id','source_id','intake_source_candidate_id',
                      'intake_sensitivity_profile_id','profile_canonical_sha256','is_current','created_at']) AS col
  UNION ALL
  SELECT 'CANONICAL', 'COLUMN_EXISTS', 'kai.intake_file_profiles.' || col,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_file_profiles' AND column_name = col
         ) THEN 'PASS' ELSE 'FAIL' END,
         'read by getReviewCockpitFileProfileRecord'
    FROM unnest(ARRAY['file_profile_id','organization_id','intake_file_id','parser_name','parser_version',
                      'checksum','profile_canonical_sha256','created_at']) AS col
  UNION ALL
  SELECT 'CANONICAL', 'COLUMN_EXISTS', 'kai.data_quality_findings.' || col,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'data_quality_findings' AND column_name = col
         ) THEN 'PASS' ELSE 'FAIL' END,
         'read by getReviewCockpitFileProfileRecord'
    FROM unnest(ARRAY['data_quality_finding_id','organization_id','data_dictionary_id','file_profile_id',
                      'profile_field_key','finding_type','finding_status','finding_detail_safe','created_at']) AS col
  UNION ALL
  SELECT 'CANONICAL', 'CONSTRAINT_EXISTS', required_conname,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
            WHERE n.nspname = 'kai' AND c.conname = required_conname
         ) THEN 'PASS' ELSE 'FAIL' END,
         'required canonical constraint'
    FROM unnest(ARRAY[
      'intake_parser_runs_p1_identity_unique',
      'intake_file_profiles_p1_identity_unique',
      'intake_file_profiles_p1_04_lineage_unique',
      'data_dictionaries_p1_04_lineage_unique',
      'data_dictionary_fields_p1_04_identity_unique',
      'data_dictionary_mappings_p1_04_field_unique',
      'data_quality_findings_p1_04_identity_unique',
      'intake_sensitivity_profiles_p1_05_identity_unique',
      'intake_sensitivity_profiles_p1_07_candidate_lineage_unique',
      'intake_source_candidates_p1_07_identity_unique',
      'intake_source_candidates_p1_07_canonical_sha_check',
      'intake_source_candidates_p1_07_candidate_status_check',
      'intake_source_candidates_p1_08_identity_unique',
      'intake_source_candidates_p1_08_promotion_lineage_unique',
      'intake_promotion_decisions_p1_08_identity_unique',
      'sources_p1_08_identity_unique',
      'source_versions_p1_08_id_org_unique',
      'source_versions_p2_01_id_source_org_unique',
      'source_locators_p2_01_identity_unique',
      'source_locators_p2_01_id_org_unique',
      'source_locators_p2_01_source_version_fk',
      'source_locators_p2_01_locator_type_check',
      'source_locators_p2_01_coordinates_check',
      'source_locators_p2_01_fingerprint_check',
      'evidence_items_p2_01_identity_unique',
      'evidence_items_p2_01_id_org_unique',
      'evidence_items_p2_01_source_version_fk',
      'evidence_items_p2_01_source_locator_fk',
      'evidence_items_p2_01_evidence_type_check',
      'evidence_items_p2_01_statement_fingerprint_check',
      'evidence_items_p2_01_support_strength_check',
      'review_queue_items_p1_06_queue_type_check',
      'review_queue_items_p1_06_queue_status_check',
      'review_queue_items_p1_08_identity_unique'
    ]) AS required_conname

  -- 3. P2-01 legacy preservation and canonical schema-only install.
  UNION ALL
  SELECT 'P2_01_DECISION', 'CANONICAL_SCHEMA_INSTALLED', 'kai.' || t,
         CASE WHEN to_regclass('kai.' || t) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'P2_01_REQUIRED_FOR_REACHABLE_OPERATION: canonical P2-01 schema exists for the mounted human-authorized P2 routes'
    FROM unnest(ARRAY['source_locators','evidence_items']) AS t
  UNION ALL
  SELECT 'P2_01_DECISION', 'CANONICAL_TABLE_EMPTY', 'kai.' || t,
         CASE WHEN ((xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM kai.%I', t), false, true, '')))[1]::text)::bigint = 0
              THEN 'PASS' ELSE 'FAIL' END,
         'the cutover installs schema only; P2 rows must be produced later by P2-01, never translated from legacy rows'
    FROM unnest(ARRAY['source_locators','evidence_items']) AS t
  UNION ALL
  SELECT 'P2_01_DECISION', 'LEGACY_PRESERVED', 'kai_legacy_20260817.' || t,
         CASE WHEN to_regclass('kai_legacy_20260817.' || t) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'the legacy P2 graph is preserved intact and remains separate from the empty canonical P2-01 schema'
    FROM unnest(ARRAY['source_locators','evidence_items']) AS t

  -- 4. Every legacy object is preserved at the selected location.
  UNION ALL
  SELECT 'LEGACY_PRESERVATION', 'TABLE_PRESERVED', 'kai_legacy_20260817.' || table_name,
         CASE WHEN to_regclass('kai_legacy_20260817.' || table_name) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'relocated intact by ALTER TABLE ... SET SCHEMA'
    FROM material
  UNION ALL
  SELECT 'LEGACY_PRESERVATION', 'SCHEMA_COMMENTED', 'kai_legacy_20260817',
         CASE WHEN obj_description((SELECT oid FROM pg_namespace WHERE nspname = 'kai_legacy_20260817'), 'pg_namespace')
                   IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'the preserved schema records what it is, so it cannot be mistaken for a canonical namespace'
  UNION ALL
  SELECT 'LEGACY_PRESERVATION', 'UPDATED_AT_TRIGGER_PRESERVED',
         'kai_legacy_20260817.' || split_part(spec, '@', 1) || '.' || split_part(spec, '@', 2),
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_trigger tg
             JOIN pg_class r ON r.oid = tg.tgrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
             JOIN pg_proc p ON p.oid = tg.tgfoid
             JOIN pg_namespace pn ON pn.oid = p.pronamespace
            WHERE n.nspname = 'kai_legacy_20260817'
              AND r.relname = split_part(spec, '@', 1)
              AND tg.tgname = split_part(spec, '@', 2)
              AND NOT tg.tgisinternal
              AND pn.nspname = 'kai'
              AND p.proname = 'set_updated_at'
              AND pg_get_triggerdef(tg.oid) = format('CREATE TRIGGER %I BEFORE UPDATE ON kai_legacy_20260817.%I FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at()', split_part(spec, '@', 2), split_part(spec, '@', 1))
         ) THEN 'PASS' ELSE 'FAIL' END,
         'allowed legacy row-maintenance trigger remains attached to the preserved legacy relation'
    FROM unnest(ARRAY[
      'data_dictionaries@trg_data_dictionaries_updated_at',
      'data_dictionary_fields@trg_data_dictionary_fields_updated_at',
      'data_dictionary_mappings@trg_data_dictionary_mappings_updated_at',
      'data_quality_findings@trg_data_quality_findings_updated_at',
      'evidence_items@trg_evidence_items_updated_at',
      'intake_file_profiles@trg_intake_file_profiles_updated_at',
      'intake_parser_runs@trg_intake_parser_runs_updated_at',
      'intake_sensitivity_profiles@trg_intake_sensitivity_profiles_updated_at',
      'intake_source_candidates@trg_intake_source_candidates_updated_at',
      'source_locators@trg_source_locators_updated_at',
      'source_versions@trg_source_versions_updated_at',
      'sources@trg_sources_updated_at'
    ]) AS spec
  UNION ALL
  SELECT 'LEGACY_PRESERVATION', 'NO_CANONICAL_REPLACEMENT_TRIGGER', 'kai.* relocation replacements',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_trigger tg
             JOIN pg_class r ON r.oid = tg.tgrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname IN (SELECT table_name FROM material)
              AND NOT tg.tgisinternal
         ) THEN 'PASS' ELSE 'FAIL' END,
         'new canonical replacement tables must not inherit legacy updated_at triggers'

  -- 5. Material FK / dependency preservation.
  UNION ALL
  SELECT 'DEPENDENCY', 'LEGACY_FK_PRESERVED',
         'kai_legacy_20260817.' || split_part(edge, '@', 1) || '.' || split_part(edge, '@', 2),
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint pc
             JOIN pg_class r ON r.oid = pc.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
             JOIN pg_class fr ON fr.oid = pc.confrelid
             JOIN pg_namespace fn ON fn.oid = fr.relnamespace
            WHERE n.nspname = 'kai_legacy_20260817'
              AND r.relname = split_part(edge, '@', 1)
              AND pc.conname = split_part(edge, '@', 2)
              AND pc.contype = 'f'
              AND fn.nspname || '.' || fr.relname = split_part(edge, '@', 3)
         ) THEN 'PASS' ELSE 'FAIL' END,
         'must still reference ' || split_part(edge, '@', 3)
    FROM unnest(ARRAY[
      -- legacy-to-legacy edges, both endpoints moved together
      'source_versions@source_versions_source_id_fkey@kai_legacy_20260817.sources',
      'source_locators@source_locators_source_version_id_fkey@kai_legacy_20260817.source_versions',
      'evidence_items@evidence_items_source_locator_id_fkey@kai_legacy_20260817.source_locators',
      'evidence_items@evidence_items_source_version_id_fkey@kai_legacy_20260817.source_versions',
      'data_dictionary_fields@data_dictionary_fields_data_dictionary_id_fkey@kai_legacy_20260817.data_dictionaries',
      'data_dictionary_mappings@data_dictionary_mappings_data_dictionary_field_id_fkey@kai_legacy_20260817.data_dictionary_fields',
      'data_quality_findings@data_quality_findings_data_dictionary_field_id_fkey@kai_legacy_20260817.data_dictionary_fields',
      'intake_parser_runs@fk_intake_parser_runs_output_profile@kai_legacy_20260817.intake_file_profiles',
      'intake_promotion_decisions@intake_promotion_decisions_intake_source_candidate_id_fkey@kai_legacy_20260817.intake_source_candidates',
      'intake_source_candidates@intake_source_candidates_created_source_id_fkey@kai_legacy_20260817.sources',
      -- intended legacy-to-shared edges, which must NOT have followed the move
      'intake_source_candidates@intake_source_candidates_intake_file_id_fkey@kai.intake_files',
      'intake_parser_runs@intake_parser_runs_intake_file_id_fkey@kai.intake_files',
      'intake_sensitivity_profiles@intake_sensitivity_profiles_intake_file_id_fkey@kai.intake_files'
    ]) AS edge
  UNION ALL
  -- Retained dependents keep referencing the preserved legacy object, never a
  -- freshly-installed canonical one.
  SELECT 'DEPENDENCY', 'RETAINED_DEPENDENT_POINTS_AT_LEGACY',
         dn.nspname || '.' || dr.relname || '.' || pc.conname,
         CASE WHEN fn.nspname = 'kai_legacy_20260817' THEN 'PASS' ELSE 'FAIL' END,
         'references ' || fn.nspname || '.' || fr.relname
    FROM pg_constraint pc
    JOIN pg_class dr ON dr.oid = pc.conrelid
    JOIN pg_namespace dn ON dn.oid = dr.relnamespace
    JOIN pg_class fr ON fr.oid = pc.confrelid
    JOIN pg_namespace fn ON fn.oid = fr.relnamespace
   WHERE pc.contype = 'f'
     AND dn.nspname = 'kai'
     AND dr.relname NOT IN (SELECT table_name FROM material)
     AND fr.relname IN (SELECT table_name FROM material)
  UNION ALL
  -- Nothing canonical was left silently depending on the legacy schema.
  SELECT 'DEPENDENCY', 'NO_CANONICAL_TABLE_DEPENDS_ON_LEGACY_SCHEMA', 'kai.* -> kai_legacy_20260817',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_constraint pc
             JOIN pg_class dr ON dr.oid = pc.conrelid
             JOIN pg_namespace dn ON dn.oid = dr.relnamespace
             JOIN pg_class fr ON fr.oid = pc.confrelid
             JOIN pg_namespace fn ON fn.oid = fr.relnamespace
            WHERE pc.contype = 'f' AND dn.nspname = 'kai'
              AND fn.nspname = 'kai_legacy_20260817'
              AND dr.relname IN (SELECT table_name FROM canonical_expected)
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a canonical P1 table must never carry a foreign key into the preserved legacy schema'

  -- 6. Shared object contracts preserved (never relocated, never narrowed).
  UNION ALL
  SELECT 'SHARED', 'TABLE_STILL_IN_KAI', 'kai.' || t,
         CASE WHEN to_regclass('kai.' || t) IS NOT NULL
                AND to_regclass('kai_legacy_20260817.' || t) IS NULL THEN 'PASS' ELSE 'FAIL' END,
         'shared object must remain in kai and must never have been relocated'
    FROM unnest(ARRAY['intake_files','review_queue_items','upload_lifecycle_audit',
                      'organizations','engagements','users']) AS t
  UNION ALL
  SELECT 'SHARED', 'INTAKE_FILES_GATE_A_INTACT', 'kai.intake_files.' || required_conname,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'intake_files' AND c.conname = required_conname
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Gate A / Gate C1 contract must survive the cutover untouched'
    FROM unnest(ARRAY['intake_files_gate_a_upload_state_check',
                      'intake_files_gate_a_state_fact_consistency_check',
                      'intake_files_gate_a_verified_checksum_check']) AS required_conname
  UNION ALL
  SELECT 'SHARED', 'QUEUE_VOCABULARY_NOT_NARROWED', 'kai.review_queue_items.queue_type=' || lit,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) LIKE '%' || lit || '%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'every production queue_type literal must still be permitted'
    FROM unnest(ARRAY['intake_file_review','source_candidate_review','sensitivity_review',
                      'data_dictionary_review','evidence_review','claim_review','client_followup',
                      'conflict_resolution','generated_content_review','export_review']) AS lit
  UNION ALL
  SELECT 'SHARED', 'QUEUE_STATUS_VOCABULARY_NOT_NARROWED', 'kai.review_queue_items.queue_status=' || lit,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) LIKE '%' || lit || '%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'every production queue_status literal must still be permitted'
    FROM unnest(ARRAY['open','in_progress','blocked','waiting_on_client','waiting_on_gk',
                      'resolved','cancelled']) AS lit
  UNION ALL
  SELECT 'SHARED', 'QUEUE_PRIORITY_PRODUCTION_NATIVE',
         'kai.review_queue_items.priority',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_attribute a
             JOIN pg_class r ON r.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
             JOIN pg_type ty ON ty.oid = a.atttypid
            WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
              AND a.attname = 'priority' AND ty.typnamespace = n.oid
              AND ty.typname = 'priority_enum' AND ty.typtype = 'e'
              AND pg_get_expr((SELECT d.adbin FROM pg_attrdef d WHERE d.adrelid = r.oid AND d.adnum = a.attnum), r.oid) = '''medium''::kai.priority_enum'
              AND ARRAY(
                SELECT e.enumlabel::text FROM pg_enum e
                 WHERE e.enumtypid = ty.oid ORDER BY e.enumsortorder
              ) = ARRAY['mandatory','immediate_fix','high','medium','low','backlog','not_applicable','unknown']::text[]
         ) THEN 'PASS' ELSE 'FAIL' END,
         'shared production priority enum/default/labels must remain unchanged by the cutover'
  UNION ALL
  SELECT 'SHARED', 'AUDIT_WRITER_COLUMN_STILL_PRESENT',
         'kai.upload_lifecycle_audit.' || required_column,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'upload_lifecycle_audit'
              AND column_name = required_column
         ) THEN 'PASS' ELSE 'FAIL' END,
         'the cutover leaves this table completely unchanged; the current writers'' column set must still be intact'
    FROM unnest(ARRAY['organization_id','intake_file_id','operation','from_state','to_state',
                      'outcome','metadata','created_at']) AS required_column
  UNION ALL
  SELECT 'SHARED', 'AUDIT_OPERATION_VOCABULARY_NOT_NARROWED', 'kai.upload_lifecycle_audit.operation=' || lit,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'upload_lifecycle_audit' AND c.contype = 'c'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%' || lit || '%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'the cutover must never have narrowed this live vocabulary'
    FROM unnest(ARRAY['reserve_upload','start_upload','complete_object_version','confirm_upload',
                      'block_upload','abandon_upload','expire_upload',
                      'policy_decision_compare_and_set','parser_run_recorded',
                      'file_profile_persisted','data_dictionary_draft_persisted',
                      'intake_sensitivity_profile_persisted','sensitivity_review_queue_item_created',
                      'intake_source_candidate_persisted','source_promotion_decision_persisted']) AS lit

  -- 7. Legacy queue targets cannot be misread as canonical work.
  UNION ALL
  SELECT 'LEGACY_QUEUE_TARGET', 'EVERY_LEGACY_TARGET_IS_MARKED', 'kai.review_queue_items',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.review_queue_items q
             JOIN kai_legacy_20260817.intake_source_candidates l
               ON l.intake_source_candidate_id = q.target_object_id
            WHERE q.target_object_type = 'intake_source_candidate'
              AND NOT (q.queue_metadata ? 'kai_legacy_generation_target')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a queue row targeting a preserved legacy candidate must carry the marker the cockpit reader excludes'
  UNION ALL
  SELECT 'LEGACY_QUEUE_TARGET', 'NO_LEGACY_TARGET_RESOLVES_AS_CANONICAL', 'kai.review_queue_items',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.review_queue_items q
             JOIN kai.intake_source_candidates c ON c.intake_source_candidate_id = q.target_object_id
            WHERE q.queue_metadata ? 'kai_legacy_generation_target'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no marked legacy-target row may also resolve against the canonical table'
  UNION ALL
  SELECT 'LEGACY_QUEUE_TARGET', 'NO_STATUS_WAS_FABRICATED', 'kai.review_queue_items',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.review_queue_items q
            WHERE q.queue_metadata ? 'kai_legacy_generation_target'
              AND q.queue_status IN ('resolved', 'cancelled')
              AND q.queue_metadata #>> ARRAY['kai_legacy_generation_target','cutover'] = '20260817'
              AND q.updated_by IS NULL
              AND q.last_action_at IS NULL
         ) THEN 'PASS' ELSE 'FAIL' END,
         'the cutover never resolves or cancels a queue row; a marked row in a terminal status with no human action recorded would prove it did'

  -- 8. No legacy row was translated into the canonical generation.
  UNION ALL
  SELECT 'NO_TRANSLATION', 'IDENTITY_SETS_ARE_DISJOINT', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_source_candidates c
             JOIN kai_legacy_20260817.intake_source_candidates l
               ON l.intake_source_candidate_id = c.intake_source_candidate_id
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a canonical candidate identity may never equal a preserved legacy one'
  UNION ALL
  SELECT 'NO_TRANSLATION', 'IDENTITY_SETS_ARE_DISJOINT', 'kai.sources',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.sources c JOIN kai_legacy_20260817.sources l ON l.source_id = c.source_id
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a canonical source identity may never equal a preserved legacy one'
  UNION ALL
  SELECT 'NO_TRANSLATION', 'CANONICAL_LINEAGE_IS_COMPLETE', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_source_candidates
            WHERE file_profile_id IS NULL OR data_dictionary_id IS NULL
               OR intake_sensitivity_profile_id IS NULL OR profile_canonical_sha256 IS NULL
         ) THEN 'PASS' ELSE 'FAIL' END,
         'every canonical row carries its full, genuinely-produced lineage tuple'
  UNION ALL
  SELECT 'NO_TRANSLATION', 'NO_CROSS_TENANT_LINEAGE', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_source_candidates c
             JOIN kai.intake_file_profiles p ON p.file_profile_id = c.file_profile_id
            WHERE p.organization_id <> c.organization_id
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical candidate lineage never crosses organization_id'
  UNION ALL
  SELECT 'NO_TRANSLATION', 'CANDIDATE_STATUS_VOCABULARY', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_source_candidates
            WHERE candidate_status NOT IN ('needs_gk_review','promoted','rejected')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'current three-state vocabulary only'

  -- 9. The exact current application reads compile against the canonical shape.
  --    to_regclass + column presence above proves the relations and columns
  --    exist; these two rows prove the full projections parse and execute.
  UNION ALL
  SELECT 'READ_MODEL', 'SOURCE_CANDIDATE_SELECT_COMPILES', 'getScopedSourceCandidateByIdentityForDisplay',
         CASE WHEN (
           SELECT count(*) FROM (
             SELECT intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
                    data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
                    proposed_source_type, candidate_status, created_at
               FROM kai.intake_source_candidates
              WHERE organization_id = '00000000-0000-0000-0000-000000000000'::uuid
              LIMIT 1
           ) probe
         ) >= 0 THEN 'PASS' ELSE 'FAIL' END,
         'the exact current projection parses and executes; a zero-uuid predicate guarantees it reads no real row'
  UNION ALL
  SELECT 'READ_MODEL', 'PROMOTION_DECISION_SELECT_COMPILES', 'getScopedSourcePromotionDecisionByIdentityForDisplay',
         CASE WHEN (
           SELECT count(*) FROM (
             SELECT intake_promotion_decision_id, organization_id, intake_source_candidate_id,
                    review_queue_item_id, reviewed_source_type, decision_status, source_id,
                    source_version_id, created_at, decided_at, promoted_at
               FROM kai.intake_promotion_decisions
              WHERE organization_id = '00000000-0000-0000-0000-000000000000'::uuid
              LIMIT 1
           ) probe
         ) >= 0 THEN 'PASS' ELSE 'FAIL' END,
         'the exact current projection parses and executes; a zero-uuid predicate guarantees it reads no real row'
  UNION ALL
  SELECT 'READ_MODEL', 'COCKPIT_QUEUE_SELECT_COMPILES', 'listReviewCockpitQueueItems',
         CASE WHEN (
           SELECT count(*) FROM (
             SELECT review_queue_item_id, organization_id, queue_type, target_object_type,
                    target_object_id, priority, queue_status, due_at, summary, required_action,
                    created_at, updated_at
               FROM kai.review_queue_items
              WHERE organization_id = '00000000-0000-0000-0000-000000000000'::uuid
                AND NOT (queue_metadata ? 'kai_legacy_generation_target')
              LIMIT 1
           ) probe
         ) >= 0 THEN 'PASS' ELSE 'FAIL' END,
         'includes the legacy-target exclusion predicate the corrected cockpit reader uses'

  -- 10. Retained kai.claim_evidence_links: its foreign key is NEVER retargeted by
  --     this cutover. These checks ASSERT (not merely report) that every existing
  --     claim-evidence relationship is still correctly attached to the preserved
  --     legacy evidence_items rows after the OID-preserving relocation - nothing
  --     silently broke, and nothing now points at a canonical table or at nothing.
  UNION ALL
  SELECT 'DEFERRED_ATTACHMENT', 'FK_STILL_TARGETS_PRESERVED_LEGACY_BY_OID',
         'kai.claim_evidence_links.claim_evidence_links_evidence_item_id_fkey',
         CASE
           WHEN to_regclass('kai.claim_evidence_links') IS NULL THEN 'PASS'
           WHEN EXISTS (
             SELECT 1 FROM pg_constraint pc
               JOIN pg_class dr ON dr.oid = pc.conrelid
               JOIN pg_namespace dn ON dn.oid = dr.relnamespace
              WHERE pc.contype = 'f' AND dn.nspname = 'kai' AND dr.relname = 'claim_evidence_links'
                AND pc.conname = 'claim_evidence_links_evidence_item_id_fkey'
                -- confrelid is the OID of the preserved, relocated legacy table
                AND pc.confrelid = to_regclass('kai_legacy_20260817.evidence_items')
           ) THEN 'PASS'
           ELSE 'FAIL'
         END,
         'the foreign key must still bind, by referenced-table OID, to the relocated kai_legacy_20260817.evidence_items - never to a canonical table and never to a dropped relation'
  UNION ALL
  SELECT 'DEFERRED_ATTACHMENT', 'EVERY_LINK_ROW_STILL_RESOLVES', 'kai.claim_evidence_links',
         CASE
           WHEN to_regclass('kai.claim_evidence_links') IS NULL THEN 'PASS'
           WHEN NOT EXISTS (
             SELECT 1 FROM kai.claim_evidence_links l
              WHERE NOT EXISTS (
                SELECT 1 FROM kai_legacy_20260817.evidence_items e
                 WHERE e.evidence_item_id = l.evidence_item_id
              )
           ) THEN 'PASS'
           ELSE 'FAIL'
         END,
         'every retained claim-evidence link row must still resolve to a surviving preserved legacy evidence item; an orphan would prove the relationship broke'
  UNION ALL
  SELECT 'DEFERRED_ATTACHMENT', 'LINK_ROW_COUNT_AND_RESOLVED_COUNT_MATCH', 'kai.claim_evidence_links',
         CASE
           WHEN to_regclass('kai.claim_evidence_links') IS NULL THEN 'PASS'
           WHEN (SELECT count(*) FROM kai.claim_evidence_links)
                = (SELECT count(*) FROM kai.claim_evidence_links l
                     JOIN kai_legacy_20260817.evidence_items e
                       ON e.evidence_item_id = l.evidence_item_id)
           THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT count(*)::text FROM kai.claim_evidence_links), '0')
         || ' link row(s); the join against the preserved legacy evidence items must return exactly the same count'
  UNION ALL
  SELECT 'DEFERRED', 'LEGACY_AT_CANONICAL_NAME_OUTSIDE_THIS_CUTOVER', 'kai.claim_evidence_links',
         'PASS',
         CASE WHEN to_regclass('kai.claim_evidence_links') IS NOT NULL
              THEN 'present and retained in kai by design, foreign key never retargeted. A future P2-01/P2-03 cutover MUST handle it explicitly, because migrations/kai_sprint2_p2_03_claim_proposal.sql uses CREATE TABLE IF NOT EXISTS and would silently skip over it.'
              ELSE 'absent; nothing deferred' END
)
SELECT * FROM checks
ORDER BY result_type, check_name, object_name;
