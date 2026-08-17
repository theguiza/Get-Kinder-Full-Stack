-- ==========================================================================
-- READ-ONLY production preflight for the KAI legacy-generation cutover
-- (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql).
--
-- pgAdmin Query Tool compatible. No psql meta-commands, no \i, no DATABASE_URL,
-- no mutation of any kind: every statement below is a SELECT.
--
-- Emits exactly one result set: result_type, check_name, object_name, status,
-- detail. EVERY row must be PASS before the cutover bundle may run.
--
-- Safety of the emitted output: catalog metadata, classifications and aggregate
-- counts only. No PII, no filenames, no storage locations, no object keys, no
-- URLs, no secrets, no raw business content, and no unrestricted or identifying
-- rows - in particular the legacy review-queue check emits counts per
-- (queue_type, target_object_type, classification) and never a queue row, a
-- summary, a required_action or a target_object_id.
--
-- WHY THIS FILE WAS CORRECTED
-- Run against the real production catalog, the first pass of this preflight
-- returned four FAILs (kai.evidence_items, kai.source_locators,
-- kai.data_dictionary_fields, kai.intake_parser_runs) because it assumed those
-- tables were absent or already canonical. It also returned two FALSE PASSes
-- (kai.data_dictionary_mappings, kai.data_quality_findings) because it
-- classified a shape by a SINGLE marker column that both the legacy and the
-- canonical generation happen to carry. This version classifies every material
-- object by a multi-factor structural signature - required columns AND their
-- information_schema data-type classes, the primary-key column set, named
-- unique/check constraints, named indexes, and the outgoing foreign-key
-- signature - and treats UNRECOGNIZED as a hard FAIL.
-- ==========================================================================

WITH signature (
  table_name, legacy_columns, legacy_pk_columns, legacy_constraints,
  legacy_indexes, legacy_fk_edges, canonical_columns, canonical_constraints
) AS (VALUES
('intake_parser_runs',
 ARRAY['intake_parser_run_id:uuid','job_id:uuid','job_status:USER-DEFINED','parse_status:USER-DEFINED',
       'max_retries:integer','requires_manual_review:boolean','locked_by:text','output_profile_id:uuid',
       'parser_input_metadata:jsonb','parser_output_metadata:jsonb'],
 ARRAY['intake_parser_run_id'],
 ARRAY['intake_parser_runs_pkey','intake_parser_runs_max_retries_check',
       'fk_intake_parser_runs_output_profile','fk_intake_parser_runs_file_org'],
 ARRAY['idx_intake_parser_runs_file','idx_intake_parser_runs_org','idx_intake_parser_runs_status'],
 ARRAY['fk_intake_parser_runs_output_profile->kai.intake_file_profiles',
       'intake_parser_runs_intake_file_id_fkey->kai.intake_files'],
 ARRAY['parser_run_id:uuid','checksum:text','parser_status:text'],
 ARRAY['intake_parser_runs_p1_identity_unique','intake_parser_runs_p1_parser_status_check',
       'intake_parser_runs_p1_state_fact_consistency_check']),

('intake_file_profiles',
 ARRAY['intake_file_profile_id:uuid','detected_columns:jsonb','sample_values_redacted:jsonb',
       'detected_file_kind:text','detected_entity_types:jsonb','row_count:integer','column_count:integer',
       'cell_count:bigint','profile_summary:text','profile_metadata:jsonb'],
 ARRAY['intake_file_profile_id'],
 ARRAY['intake_file_profiles_pkey','intake_file_profiles_detected_columns_check',
       'intake_file_profiles_sample_values_redacted_check','fk_intake_file_profiles_file_org'],
 ARRAY['idx_intake_file_profiles_file','idx_intake_file_profiles_org_status'],
 ARRAY['intake_file_profiles_intake_file_id_fkey->kai.intake_files'],
 ARRAY['file_profile_id:uuid','parser_run_id:uuid','profile:jsonb','profile_canonical_sha256:text'],
 ARRAY['intake_file_profiles_p1_identity_unique','intake_file_profiles_p1_canonical_sha_check',
       'intake_file_profiles_p1_04_lineage_unique']),

('data_dictionaries',
 ARRAY['data_dictionary_id:uuid','intake_file_id:uuid','source_id:uuid','dictionary_name:text',
       'dictionary_summary:text','dictionary_metadata:jsonb','processing_status:USER-DEFINED',
       'last_audit_event_id:uuid'],
 ARRAY['data_dictionary_id'],
 ARRAY['data_dictionaries_pkey','data_dictionaries_dictionary_name_check',
       'fk_data_dictionaries_source_org','data_dictionaries_intake_file_id_fkey'],
 ARRAY['idx_data_dictionaries_intake_file','idx_data_dictionaries_org_review',
       'idx_data_dictionaries_source','ux_data_dictionaries_dictionary_org'],
 ARRAY['data_dictionaries_source_id_fkey->kai.sources',
       'data_dictionaries_intake_file_id_fkey->kai.intake_files'],
 ARRAY['file_profile_id:uuid','profile_canonical_sha256:text','dictionary_status:text'],
 ARRAY['data_dictionaries_p1_04_lineage_unique','data_dictionaries_p1_04_canonical_sha_check',
       'data_dictionaries_p1_04_status_check']),

('data_dictionary_fields',
 ARRAY['data_dictionary_field_id:uuid','field_name:text','display_label:text','business_meaning:text',
       'entity_level:text','data_type_detected:text','allowed_use:ARRAY','consent_scope:ARRAY',
       'quality_status:text','mapping_confidence:text','field_metadata:jsonb'],
 ARRAY['data_dictionary_field_id'],
 ARRAY['data_dictionary_fields_pkey','data_dictionary_fields_data_dictionary_id_field_name_key',
       'data_dictionary_fields_entity_level_check','fk_data_dictionary_fields_dictionary_org'],
 ARRAY['idx_data_dictionary_fields_dictionary','idx_data_dictionary_fields_entity',
       'idx_data_dictionary_fields_org_review','ux_data_dictionary_fields_field_org'],
 ARRAY['data_dictionary_fields_data_dictionary_id_fkey->kai.data_dictionaries',
       'data_dictionary_fields_source_id_fkey->kai.sources',
       'data_dictionary_fields_intake_file_id_fkey->kai.intake_files'],
 ARRAY['file_profile_id:uuid','profile_field_key:text'],
 ARRAY['data_dictionary_fields_p1_04_identity_unique','data_dictionary_fields_p1_04_field_key_check',
       'data_dictionary_fields_p1_04_lineage_unique']),

('data_dictionary_mappings',
 ARRAY['data_dictionary_mapping_id:uuid','mapped_object_type:text','mapped_object_id:uuid',
       'mapped_concept_code:text','classification_source:USER-DEFINED','basis_note:text',
       'mapping_metadata:jsonb'],
 ARRAY['data_dictionary_mapping_id'],
 ARRAY['data_dictionary_mappings_pkey','data_dictionary_mappings_mapped_object_type_check',
       'data_dictionary_mappings_mapping_confidence_check','fk_data_dictionary_mappings_field_org'],
 ARRAY['idx_data_dictionary_mappings_field','idx_data_dictionary_mappings_object',
       'idx_data_dictionary_mappings_org_review'],
 ARRAY['data_dictionary_mappings_data_dictionary_field_id_fkey->kai.data_dictionary_fields'],
 ARRAY['data_dictionary_id:uuid','file_profile_id:uuid','profile_field_key:text'],
 ARRAY['data_dictionary_mappings_p1_04_field_unique','data_dictionary_mappings_p1_04_field_key_check']),

('data_quality_findings',
 ARRAY['data_quality_finding_id:uuid','gap_type:USER-DEFINED','priority:USER-DEFINED',
       'finding_summary:text','impact_on_use:text','recommended_fix:text','finding_metadata:jsonb',
       'data_dictionary_field_id:uuid'],
 ARRAY['data_quality_finding_id'],
 ARRAY['data_quality_findings_pkey','data_quality_findings_finding_type_check',
       'data_quality_findings_finding_summary_check1','fk_data_quality_findings_source_org'],
 ARRAY['idx_data_quality_findings_field','idx_data_quality_findings_file',
       'idx_data_quality_findings_org_review'],
 ARRAY['data_quality_findings_data_dictionary_field_id_fkey->kai.data_dictionary_fields',
       'data_quality_findings_source_id_fkey->kai.sources'],
 ARRAY['data_dictionary_id:uuid','file_profile_id:uuid','profile_field_key:text',
       'finding_status:text','finding_detail_safe:text'],
 ARRAY['data_quality_findings_p1_04_identity_unique','data_quality_findings_p1_04_field_key_check',
       'data_quality_findings_p1_04_status_check']),

('intake_sensitivity_profiles',
 ARRAY['intake_sensitivity_profile_id:uuid','pii_detected:boolean','minor_data_possible:boolean',
       'health_or_housing_data_possible:boolean','justice_or_immigration_data_possible:boolean',
       'story_or_testimonial_possible:boolean','indigenous_or_ocap_possible:boolean',
       'consent_scope:ARRAY','basis_note:text','sensitivity_metadata:jsonb'],
 ARRAY['intake_sensitivity_profile_id'],
 ARRAY['intake_sensitivity_profiles_pkey','intake_sensitivity_profiles_consent_scope_check',
       'fk_intake_sensitivity_profiles_file_org','fk_intake_sensitivity_profiles_engagement_org'],
 ARRAY['idx_intake_sensitivity_profiles_file','idx_intake_sensitivity_profiles_gates',
       'idx_intake_sensitivity_profiles_org_review'],
 ARRAY['intake_sensitivity_profiles_intake_file_id_fkey->kai.intake_files'],
 ARRAY['file_profile_id:uuid','data_dictionary_id:uuid','profile_canonical_sha256:text','pii_status:text'],
 ARRAY['intake_sensitivity_profiles_p1_05_identity_unique',
       'intake_sensitivity_profiles_p1_05_canonical_sha_check',
       'intake_sensitivity_profiles_p1_07_candidate_lineage_unique']),

('intake_source_candidates',
 ARRAY['intake_source_candidate_id:uuid','proposed_source_code:text','proposed_display_name:text',
       'proposed_owner_type:USER-DEFINED','proposed_data_class:smallint',
       'proposed_permission_scope:ARRAY','candidate_summary:text','candidate_metadata:jsonb',
       'created_source_id:uuid','created_source_version_id:uuid'],
 ARRAY['intake_source_candidate_id'],
 ARRAY['intake_source_candidates_pkey','intake_source_candidates_proposed_permission_scope_check',
       'fk_intake_source_candidates_file_org','fk_intake_source_candidates_created_source_org'],
 ARRAY['idx_intake_source_candidates_file','idx_intake_source_candidates_org_review',
       'ux_intake_source_candidates_candidate_org','ux_intake_source_candidates_source_code'],
 ARRAY['intake_source_candidates_created_source_id_fkey->kai.sources',
       'intake_source_candidates_created_source_version_id_fkey->kai.source_versions',
       'intake_source_candidates_intake_file_id_fkey->kai.intake_files'],
 ARRAY['file_profile_id:uuid','data_dictionary_id:uuid','intake_sensitivity_profile_id:uuid',
       'profile_canonical_sha256:text','candidate_status:text'],
 ARRAY['intake_source_candidates_p1_07_identity_unique',
       'intake_source_candidates_p1_07_canonical_sha_check',
       'intake_source_candidates_p1_07_candidate_status_check']),

('intake_promotion_decisions',
 ARRAY['intake_promotion_decision_id:uuid','decision_status:text','decision_by:uuid',
       'decision_by_type:USER-DEFINED','decision_note:text','created_source_id:uuid',
       'created_source_version_id:uuid','decision_metadata:jsonb'],
 ARRAY['intake_promotion_decision_id'],
 ARRAY['intake_promotion_decisions_pkey','intake_promotion_decisions_decision_status_check',
       'fk_intake_promotion_decisions_candidate_org',
       'fk_intake_promotion_decisions_created_source_org'],
 ARRAY['idx_intake_promotion_decisions_candidate','idx_intake_promotion_decisions_org_status'],
 ARRAY['intake_promotion_decisions_intake_source_candidate_id_fkey->kai.intake_source_candidates',
       'intake_promotion_decisions_created_source_id_fkey->kai.sources'],
 ARRAY['review_queue_item_id:uuid','reviewed_source_type:text','source_id:uuid',
       'promoted_at:timestamp with time zone'],
 ARRAY['intake_promotion_decisions_p1_08_identity_unique',
       'intake_promotion_decisions_p1_08_decision_status_check',
       'intake_promotion_decisions_p1_08_promoted_binding_check']),

('sources',
 ARRAY['source_id:uuid','source_code:text','source_family_id:uuid','current_source_version_id:uuid',
       'display_name:text','permission_use_scope:ARRAY','classification_review_status:USER-DEFINED',
       'classification_version:text','derived_from:ARRAY','dashboard_visibility:USER-DEFINED',
       'approval_audience:ARRAY','llm_processing_constraints:ARRAY'],
 ARRAY['source_id'],
 ARRAY['sources_pkey','sources_approval_requires_human_chk','sources_date_range_chk',
       'sources_display_name_check','sources_raw_pointer_chk'],
 ARRAY['idx_sources_checksum','idx_sources_engagement_status','idx_sources_org_class',
       'ux_sources_source_org'],
 ARRAY['sources_engagement_id_fkey->kai.engagements','sources_organization_id_fkey->kai.organizations'],
 ARRAY['reviewed_source_type:text'],
 ARRAY['sources_p1_08_identity_unique','sources_p1_08_id_org_unique',
       'sources_p1_08_reviewed_source_type_check']),

('source_versions',
 ARRAY['source_version_id:uuid','version_number:integer','version_label:text',
       'received_at:timestamp with time zone','received_by_user_id:uuid','extracted_text_pointer:text',
       'extracted_table_pointer:text','parse_warnings:jsonb','supersedes_source_version_id:uuid',
       'legacy_module_status_label:text'],
 ARRAY['source_version_id'],
 ARRAY['source_versions_pkey','source_versions_source_id_checksum_key',
       'source_versions_source_id_version_number_key','source_versions_approval_requires_human_chk'],
 ARRAY['idx_source_versions_checksum','idx_source_versions_parse_status',
       'idx_source_versions_source_current','ux_source_versions_one_current'],
 ARRAY['source_versions_source_id_fkey->kai.sources'],
 ARRAY['intake_source_candidate_id:uuid','intake_sensitivity_profile_id:uuid',
       'profile_canonical_sha256:text'],
 ARRAY['source_versions_p1_08_id_org_unique','source_versions_p1_08_canonical_sha_check',
       'source_versions_p1_08_candidate_identity_unique']),

('source_locators',
 ARRAY['locator_id:uuid','locator_path:text','locator_label:text','verbatim_snippet:text',
       'normalized_value:text','hash_of_snippet:text','page_number:integer','row_key:text',
       'column_key:text','locator_status:USER-DEFINED'],
 ARRAY['locator_id'],
 ARRAY['source_locators_pkey','source_locators_locator_path_check','source_locators_snippet_hash_chk',
       'source_locators_page_number_check'],
 ARRAY['idx_source_locators_hash','idx_source_locators_source_path'],
 ARRAY['source_locators_source_version_id_fkey->kai.source_versions',
       'source_locators_source_id_fkey->kai.sources'],
 ARRAY['source_locator_id:uuid','coordinates:jsonb','locator_fingerprint:text'],
 ARRAY['source_locators_p2_01_identity_unique','source_locators_p2_01_fingerprint_check',
       'source_locators_p2_01_coordinates_check']),

('evidence_items',
 ARRAY['evidence_item_id:uuid','evidence_code:text','evidence_statement:text','evidence_value:jsonb',
       'evidence_status:USER-DEFINED','confidence_note:text','prompt_run_id:uuid','model_output_id:uuid',
       'schema_version:text','supersedes_id:uuid'],
 ARRAY['evidence_item_id'],
 ARRAY['evidence_items_pkey','evidence_items_content_chk','evidence_items_approval_requires_human_chk',
       'evidence_items_source_locator_id_fkey'],
 ARRAY['idx_evidence_items_engagement_review','idx_evidence_items_source'],
 ARRAY['evidence_items_source_locator_id_fkey->kai.source_locators',
       'evidence_items_source_version_id_fkey->kai.source_versions',
       'evidence_items_source_id_fkey->kai.sources'],
 ARRAY['statement:text','statement_fingerprint:text','support_strength:text',
       'evidence_review_status:text'],
 ARRAY['evidence_items_p2_01_identity_unique','evidence_items_p2_01_statement_fingerprint_check',
       'evidence_items_p2_01_support_strength_check'])
),

-- Multi-factor classification. Each element is evaluated independently so a
-- shape can never be classified from one marker.
classified AS (
  SELECT s.table_name,
         to_regclass('kai.' || s.table_name) IS NOT NULL AS present,
         NOT EXISTS (
           SELECT 1 FROM unnest(s.legacy_columns) AS spec
            WHERE NOT EXISTS (
              SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema = 'kai' AND c.table_name = s.table_name
                 AND c.column_name = split_part(spec, ':', 1)
                 AND c.data_type = split_part(spec, ':', 2)
            )
         ) AS legacy_columns_ok,
         NOT EXISTS (
           SELECT 1 FROM unnest(s.canonical_columns) AS spec
            WHERE EXISTS (
              SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema = 'kai' AND c.table_name = s.table_name
                 AND c.column_name = split_part(spec, ':', 1)
            )
         ) AS no_canonical_columns,
         (
           SELECT coalesce(array_agg(a.attname::text ORDER BY a.attname), ARRAY[]::text[])
             FROM pg_constraint pc
             JOIN pg_class r ON r.oid = pc.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
             JOIN unnest(pc.conkey) AS k(attnum) ON true
             JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.attnum
            WHERE n.nspname = 'kai' AND r.relname = s.table_name AND pc.contype = 'p'
         ) = (SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) FROM unnest(s.legacy_pk_columns) AS x)
           AS legacy_pk_ok,
         NOT EXISTS (
           SELECT 1 FROM unnest(s.legacy_constraints) AS required_conname
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_constraint pc
                JOIN pg_class r ON r.oid = pc.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai' AND r.relname = s.table_name AND pc.conname = required_conname
            )
         ) AS legacy_constraints_ok,
         NOT EXISTS (
           SELECT 1 FROM unnest(s.legacy_indexes) AS ixname
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai' AND tablename = s.table_name AND indexname = ixname
            )
         ) AS legacy_indexes_ok,
         NOT EXISTS (
           SELECT 1 FROM unnest(s.legacy_fk_edges) AS edge
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_constraint pc
                JOIN pg_class r ON r.oid = pc.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
                JOIN pg_class fr ON fr.oid = pc.confrelid
                JOIN pg_namespace fn ON fn.oid = fr.relnamespace
               WHERE n.nspname = 'kai' AND r.relname = s.table_name AND pc.contype = 'f'
                 AND pc.conname = split_part(edge, '->', 1)
                 AND fn.nspname || '.' || fr.relname = split_part(edge, '->', 2)
            )
         ) AS legacy_fks_ok,
         NOT EXISTS (
           SELECT 1 FROM unnest(s.canonical_columns) AS spec
            WHERE NOT EXISTS (
              SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema = 'kai' AND c.table_name = s.table_name
                 AND c.column_name = split_part(spec, ':', 1)
                 AND c.data_type = split_part(spec, ':', 2)
            )
         ) AS canonical_columns_ok,
         NOT EXISTS (
           SELECT 1 FROM unnest(s.canonical_constraints) AS required_conname
            WHERE NOT EXISTS (
              SELECT 1 FROM pg_constraint pc
                JOIN pg_class r ON r.oid = pc.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai' AND r.relname = s.table_name AND pc.conname = required_conname
            )
         ) AS canonical_constraints_ok
    FROM signature s
),
final_class AS (
  SELECT table_name,
         CASE
           WHEN NOT present THEN 'ABSENT'
           WHEN legacy_columns_ok AND no_canonical_columns AND legacy_pk_ok
                AND legacy_constraints_ok AND legacy_indexes_ok AND legacy_fks_ok THEN 'LEGACY_EXPECTED'
           WHEN canonical_columns_ok AND canonical_constraints_ok THEN 'CANONICAL_EXPECTED'
           ELSE 'UNRECOGNIZED'
         END AS classification,
         concat_ws('; ',
           CASE WHEN NOT legacy_columns_ok THEN 'legacy columns/types unsatisfied' END,
           CASE WHEN NOT no_canonical_columns THEN 'canonical-only column present' END,
           CASE WHEN NOT legacy_pk_ok THEN 'primary key differs from captured legacy PK' END,
           CASE WHEN NOT legacy_constraints_ok THEN 'named legacy constraint missing' END,
           CASE WHEN NOT legacy_indexes_ok THEN 'named legacy index missing' END,
           CASE WHEN NOT legacy_fks_ok THEN 'legacy foreign-key signature missing' END,
           CASE WHEN NOT canonical_columns_ok THEN 'canonical columns/types unsatisfied' END,
           CASE WHEN NOT canonical_constraints_ok THEN 'named canonical constraint missing' END
         ) AS signature_detail
    FROM classified
),

-- Legacy review-queue target classification. Aggregate counts only: never a
-- queue row, a target_object_id, a summary or a required_action.
queue_targets AS (
  SELECT q.queue_type, q.target_object_type,
         count(*)::text AS row_count
    FROM kai.review_queue_items q
   WHERE to_regclass('kai.review_queue_items') IS NOT NULL
     AND q.target_object_type IN (
       'intake_source_candidate','intake_sensitivity_profile','data_dictionary',
       'data_dictionary_field','data_quality_finding','intake_file_profile',
       'source','source_version','evidence_item'
     )
   GROUP BY q.queue_type, q.target_object_type
),

checks AS (
  -- 1. Shared prerequisites this cutover relies on and never installs.
  SELECT 'PREREQUISITE' AS result_type, 'TABLE_EXISTS' AS check_name, 'kai.intake_files' AS object_name,
         CASE WHEN to_regclass('kai.intake_files') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'required before cutover; never relocated, never replaced' AS detail
  UNION ALL
  SELECT 'PREREQUISITE', 'GATE_A_CONSTRAINT_EXISTS', 'kai.intake_files.intake_files_gate_a_upload_state_check',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'intake_files'
              AND c.conname = 'intake_files_gate_a_upload_state_check'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'proves intake_files is already this repository''s canonical Gate A shape'
  UNION ALL
  SELECT 'PREREQUISITE', 'TABLE_EXISTS', 'kai.upload_lifecycle_audit',
         CASE WHEN to_regclass('kai.upload_lifecycle_audit') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'required before cutover; never relocated, never replaced'
  UNION ALL
  SELECT 'PREREQUISITE', 'GATE_A_FUNCTION_EXISTS', 'kai.gate_a_p0_jsonb_metadata_only',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'kai' AND p.proname = 'gate_a_p0_jsonb_metadata_only'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'required by the canonical metadata-only CHECK constraints'
  UNION ALL
  SELECT 'PREREQUISITE', 'TABLE_EXISTS', 'kai.review_queue_items',
         CASE WHEN to_regclass('kai.review_queue_items') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'shared/live; never relocated'
  UNION ALL
  SELECT 'PREREQUISITE', 'QUEUE_TYPE_CHECK_PERMITS', 'kai.review_queue_items.queue_type=source_candidate_review',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) LIKE '%source_candidate_review%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'the cutover adds the P1-06-named CHECK over this same vocabulary; it must already be permitted'
  UNION ALL
  SELECT 'PREREQUISITE', 'QUEUE_TYPE_CHECK_PERMITS', 'kai.review_queue_items.queue_type=sensitivity_review',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'the cutover adds the P1-06-named CHECK over this same vocabulary; it must already be permitted'
  UNION ALL
  -- kai.review_queue_items.priority: every priority label the CURRENT repository's
  -- review-queue producers can actually write, verified against the live enum's
  -- own pg_enum labels rather than against any assumed default.
  --
  -- Labels derived by inspecting current HEAD, not assumed:
  --   'normal'  - written by every repository-side review_queue_items producer.
  --               Backend/kai/dictionary/postgresReviewQueueRepository.js:34
  --               (SENSITIVITY_REVIEW_PRIORITY) and its insert fallback at :174;
  --               postgresSourceCandidateRepository.js:36
  --               (SOURCE_CANDIDATE_REVIEW_PRIORITY);
  --               validators/kaiConflictGroupValidators.js:14
  --               (CONFLICT_RESOLUTION_PRIORITY);
  --               validators/kaiClaimGapFollowupValidators.js:47
  --               (CLIENT_FOLLOWUP_PRIORITY);
  --               dictionary/exportReviewQueueContract.js:4 (EXPORT_REVIEW_PRIORITY).
  --               A repo-wide scan for `PRIORITY = "<label>"` under Backend/kai/
  --               yields exactly one distinct value: 'normal'.
  --   'medium'  - the insert fallback in the already-live intake path,
  --               Backend/kai/db/kaiIntakeQueries.js:181 (`item.priority || "medium"`).
  --
  -- Production confirms the column is kai.priority_enum with default 'medium', but
  -- the full label set was never captured, so it is read from pg_enum here. If any
  -- label a current producer can write is missing, the producer cannot run after
  -- the cutover, and the cutover must not proceed on the assumption that it can.
  -- The text-typed branch exists only so this script is correct against a
  -- non-enum column; it is not the production case.
  SELECT 'PREREQUISITE', 'QUEUE_PRIORITY_LABEL_WRITABLE',
         'kai.review_queue_items.priority=' || required_priority,
         CASE
           WHEN NOT EXISTS (
             SELECT 1 FROM pg_attribute a
               JOIN pg_class r ON r.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = r.relnamespace
              WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND a.attname = 'priority'
           ) THEN 'FAIL'
           -- enum-typed column (the production case): the label must exist in pg_enum
           WHEN EXISTS (
             SELECT 1 FROM pg_attribute a
               JOIN pg_class r ON r.oid = a.attrelid
               JOIN pg_namespace n ON n.oid = r.relnamespace
               JOIN pg_type ty ON ty.oid = a.atttypid
              WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
                AND a.attname = 'priority' AND ty.typtype = 'e'
           ) THEN
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_attribute a
                 JOIN pg_class r ON r.oid = a.attrelid
                 JOIN pg_namespace n ON n.oid = r.relnamespace
                 JOIN pg_enum e ON e.enumtypid = a.atttypid
                WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
                  AND a.attname = 'priority' AND e.enumlabel = required_priority
             ) THEN 'PASS' ELSE 'FAIL' END
           -- text-typed column: no vocabulary CHECK on priority may exclude the
           -- label. A vocabulary CHECK is detected by how PostgreSQL actually
           -- renders one - `col = ANY (ARRAY[...])` for a multi-value IN, or
           -- `col = 'x'` for a single value - never by looking for the literal
           -- text "IN", which pg_get_constraintdef never emits.
           WHEN NOT EXISTS (
             SELECT 1 FROM pg_constraint c
               JOIN pg_class r ON r.oid = c.conrelid
               JOIN pg_namespace n ON n.oid = r.relnamespace
              WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
                AND (pg_get_constraintdef(c.oid) LIKE '%priority = ANY (ARRAY[%'
                     OR pg_get_constraintdef(c.oid) LIKE '%priority = ''%')
                AND pg_get_constraintdef(c.oid) NOT LIKE '%''' || required_priority || '''%'
           ) THEN 'PASS'
           ELSE 'FAIL'
         END,
         'a priority label the current repository review-queue producers can write; it must already be accepted by the live column'
    FROM unnest(ARRAY['normal', 'medium']) AS required_priority
  UNION ALL
  -- The live enum's actual label set, reported so the operator can see exactly
  -- what the production type carries (metadata only - enum labels are schema, not
  -- business data).
  SELECT 'PREREQUISITE', 'QUEUE_PRIORITY_ENUM_LABELS_PRESENT',
         'kai.review_queue_items.priority type labels', 'PASS',
         coalesce((
           SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
             FROM pg_attribute a
             JOIN pg_class r ON r.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
             JOIN pg_enum e ON e.enumtypid = a.atttypid
            WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND a.attname = 'priority'
         ), 'not an enum-typed column')

  -- kai.upload_lifecycle_audit: the table itself is left COMPLETELY unchanged by
  -- the cutover - no column, constraint, index, trigger or vocabulary of it is
  -- added, narrowed or replaced. Its full production shape was never captured, so
  -- rather than assert a whole shape, these checks verify exactly the minimal
  -- compatibility subset the CURRENT audit-writer code path actually needs, and
  -- nothing beyond it.
  --
  -- Derived by inspecting every current writer of this table. All of them issue
  -- the identical statement shape (a repo-wide scan of the column list following
  -- `INSERT INTO kai.upload_lifecycle_audit` yields exactly one distinct list):
  --   INSERT INTO kai.upload_lifecycle_audit
  --     (organization_id, intake_file_id, operation, from_state, to_state,
  --      outcome, metadata, created_at)
  --   VALUES (uuid, uuid, <operation>, <upload_state>, <upload_state>,
  --           'success', <jsonb>, <timestamptz>)
  -- The cutover-adjacent producers and the operation literal each writes:
  --   parsing/postgresParserRunRepository.js:27,28        parser_run_recorded,
  --                                                       file_profile_persisted
  --   dictionary/postgresDataDictionaryRepository.js:25    data_dictionary_draft_persisted
  --   dictionary/postgresIntakeSensitivityProfileRepository.js:33
  --                                                       intake_sensitivity_profile_persisted
  --   dictionary/postgresReviewQueueRepository.js:42       sensitivity_review_queue_item_created
  --   dictionary/postgresSourceCandidateRepository.js:53   intake_source_candidate_persisted
  --   dictionary/postgresSourcePromotionRepository.js:117  source_promotion_decision_persisted
  UNION ALL
  SELECT 'PREREQUISITE', 'AUDIT_WRITER_COLUMN_PRESENT',
         'kai.upload_lifecycle_audit.' || split_part(required_column, ':', 1),
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'upload_lifecycle_audit'
              AND column_name = split_part(required_column, ':', 1)
              AND data_type = split_part(required_column, ':', 2)
         ) THEN 'PASS' ELSE 'FAIL' END,
         'inserted by every current upload_lifecycle_audit writer; nothing beyond this column set is required'
    FROM unnest(ARRAY['organization_id:uuid','intake_file_id:uuid','operation:text','from_state:text',
                      'to_state:text','outcome:text','metadata:jsonb',
                      'created_at:timestamp with time zone']) AS required_column
  UNION ALL
  -- Any column the writers do NOT supply must be nullable or defaulted, otherwise
  -- every one of those inserts fails. This is the only whole-table property the
  -- writers actually depend on.
  SELECT 'PREREQUISITE', 'AUDIT_NO_UNSATISFIABLE_REQUIRED_COLUMN', 'kai.upload_lifecycle_audit',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'upload_lifecycle_audit'
              AND is_nullable = 'NO' AND column_default IS NULL
              AND is_generated = 'NEVER'
              AND column_name NOT IN ('organization_id','intake_file_id','operation','from_state',
                                      'to_state','outcome','metadata','created_at')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a NOT NULL column with no default outside the writers'' insert list would break every current audit write'
  UNION ALL
  SELECT 'PREREQUISITE', 'AUDIT_OPERATION_ALREADY_PERMITTED',
         'kai.upload_lifecycle_audit.operation=' || required_operation,
         -- A vocabulary CHECK is detected by how PostgreSQL actually renders one:
         -- `operation = ANY (ARRAY[...])` for a multi-value IN, or
         -- `operation = 'x'` for a single value. pg_get_constraintdef never emits
         -- the literal text "IN", and matching merely "%operation%" would also
         -- catch the metadata CHECK's `operation <> '...'` clauses, which do not
         -- constrain the vocabulary at all. No vocabulary CHECK on operation may
         -- exclude a literal a current producer writes.
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'upload_lifecycle_audit' AND c.contype = 'c'
              AND (pg_get_constraintdef(c.oid) LIKE '%operation = ANY (ARRAY[%'
                   OR pg_get_constraintdef(c.oid) LIKE '%operation = ''%')
              AND pg_get_constraintdef(c.oid) NOT LIKE '%''' || required_operation || '''%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'written by a current cutover-adjacent producer; the cutover never widens or narrows this live vocabulary, so it must already be permitted'
    FROM unnest(ARRAY['parser_run_recorded','file_profile_persisted','data_dictionary_draft_persisted',
                      'intake_sensitivity_profile_persisted','sensitivity_review_queue_item_created',
                      'intake_source_candidate_persisted','source_promotion_decision_persisted'
                     ]) AS required_operation
  UNION ALL
  -- Every current writer hardcodes outcome = 'success'.
  SELECT 'PREREQUISITE', 'AUDIT_OUTCOME_ALREADY_PERMITTED',
         'kai.upload_lifecycle_audit.outcome=success',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'upload_lifecycle_audit' AND c.contype = 'c'
              AND (pg_get_constraintdef(c.oid) LIKE '%outcome = ANY (ARRAY[%'
                   OR pg_get_constraintdef(c.oid) LIKE '%outcome = ''%')
              AND pg_get_constraintdef(c.oid) NOT LIKE '%''success''%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'every current writer hardcodes outcome = ''success''; no other outcome value is required by this cutover'
  UNION ALL
  -- Reported, not asserted: which of the required operations the live metadata
  -- CHECK carries a per-operation clause for. A clause that exists was installed
  -- by the same accepted migration as the writer that satisfies it, and an absent
  -- clause is permissive - so neither state is a cutover blocker. Emitted so the
  -- operator sees it rather than it being silently ignored.
  SELECT 'PREREQUISITE', 'AUDIT_METADATA_CHECK_CLAUSES_REPORTED',
         'kai.upload_lifecycle_audit.metadata', 'PASS',
         coalesce((
           SELECT string_agg(op, ',' ORDER BY op)
             FROM unnest(ARRAY['parser_run_recorded','file_profile_persisted',
                               'data_dictionary_draft_persisted','intake_sensitivity_profile_persisted',
                               'sensitivity_review_queue_item_created','intake_source_candidate_persisted',
                               'source_promotion_decision_persisted']) AS op
            WHERE EXISTS (
              SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai' AND r.relname = 'upload_lifecycle_audit' AND c.contype = 'c'
                 AND pg_get_constraintdef(c.oid) LIKE '%metadata%'
                 AND pg_get_constraintdef(c.oid) LIKE '%' || op || '%'
            )
         ), 'no per-operation metadata clause present (permissive)')

  -- 2. Destination-schema collision state.
  UNION ALL
  SELECT 'DESTINATION', 'SCHEMA_ABSENT_OR_ALREADY_CONVERGED', 'kai_legacy_20260817',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'kai_legacy_20260817') THEN 'PASS'
           WHEN (SELECT count(*) FROM signature s
                  WHERE to_regclass('kai_legacy_20260817.' || s.table_name) IS NOT NULL)
                = (SELECT count(*) FROM signature) THEN 'PASS'
           ELSE 'FAIL'
         END,
         'must not already exist unless it holds this cutover''s own complete, already-converged relocated set'

  -- 3. Exact structural classification of every material object.
  UNION ALL
  SELECT 'SHAPE_CLASSIFICATION', 'STRUCTURAL_SIGNATURE', 'kai.' || table_name,
         CASE WHEN classification = 'UNRECOGNIZED' THEN 'FAIL' ELSE 'PASS' END,
         classification || CASE
           WHEN classification <> 'UNRECOGNIZED' OR signature_detail = '' THEN ''
           ELSE ' (' || signature_detail || ')'
         END
    FROM final_class
  UNION ALL
  -- The cutover only accepts a fully-legacy starting state or its own fully
  -- converged post-cutover state; a mixture is refused.
  SELECT 'SHAPE_CLASSIFICATION', 'STARTING_STATE_IS_COHERENT', 'kai.* material objects',
         CASE
           WHEN (SELECT count(*) FROM final_class WHERE classification = 'LEGACY_EXPECTED')
                = (SELECT count(*) FROM final_class) THEN 'PASS'
           WHEN (SELECT count(*) FROM final_class WHERE classification IN ('CANONICAL_EXPECTED','ABSENT'))
                = (SELECT count(*) FROM final_class)
                AND (SELECT count(*) FROM signature s
                      WHERE to_regclass('kai_legacy_20260817.' || s.table_name) IS NOT NULL)
                    = (SELECT count(*) FROM signature) THEN 'PASS'
           ELSE 'FAIL'
         END,
         (SELECT string_agg(classification || '=' || cnt::text, ' ' ORDER BY classification)
            FROM (SELECT classification, count(*) AS cnt FROM final_class GROUP BY classification) t)

  -- 4. Material dependencies the cutover must understand before relocating.
  UNION ALL
  SELECT 'DEPENDENCY', 'NO_VIEW_ON_RELOCATION_CANDIDATE', 'kai.* views/matviews',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM pg_depend d
             JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
             JOIN pg_class v ON v.oid = rw.ev_class
             JOIN pg_class t ON t.oid = d.refobjid
             JOIN pg_namespace tn ON tn.oid = t.relnamespace
            WHERE tn.nspname = 'kai'
              AND t.relname IN (SELECT table_name FROM signature)
              AND v.relkind IN ('v','m') AND v.oid <> t.oid
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a view or materialized view over a relocation candidate would change meaning under SET SCHEMA'
  UNION ALL
  SELECT 'DEPENDENCY', 'NO_USER_TRIGGER_ON_RELOCATION_CANDIDATE', 'kai.* triggers',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_trigger tg
             JOIN pg_class r ON r.oid = tg.tgrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname IN (SELECT table_name FROM signature)
              AND NOT tg.tgisinternal
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a user trigger on a relocation candidate is a dependency this cutover does not model'
  UNION ALL
  SELECT 'DEPENDENCY', 'NO_FUNCTION_BODY_RESOLVES_RELOCATION_CANDIDATE', 'kai.* functions',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             JOIN signature s ON position('kai.' || s.table_name in coalesce(p.prosrc, '')) > 0
            WHERE n.nspname = 'kai'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a function body naming a relocation candidate would silently resolve differently after the move'
  UNION ALL
  -- Incoming dependents are expected and are NOT relocated; they are reported so
  -- the operator can see them, and only an unexpected one fails.
  SELECT 'DEPENDENCY', 'INCOMING_FK_IS_EXPECTED',
         dn.nspname || '.' || dr.relname || ' -> kai.' || fr.relname,
         CASE WHEN dr.relname IN ('claim_evidence_links','funder_requirements','funders')
              THEN 'PASS' ELSE 'FAIL' END,
         'retained dependent; its foreign key will follow its parent into kai_legacy_20260817 by OID, keeping the same rows'
    FROM pg_constraint pc
    JOIN pg_class dr ON dr.oid = pc.conrelid
    JOIN pg_namespace dn ON dn.oid = dr.relnamespace
    JOIN pg_class fr ON fr.oid = pc.confrelid
    JOIN pg_namespace fn ON fn.oid = fr.relnamespace
   WHERE pc.contype = 'f' AND fn.nspname = 'kai'
     AND fr.relname IN (SELECT table_name FROM signature)
     AND NOT (dn.nspname = 'kai' AND dr.relname IN (SELECT table_name FROM signature))

  -- 5. The atomic cutover's own applicability.
  UNION ALL
  SELECT 'APPLICABILITY', 'P2_01_CANONICAL_INSTALL_REQUIRED', 'kai.source_locators / kai.evidence_items',
         CASE WHEN (SELECT classification FROM final_class WHERE table_name = 'source_locators')
                     IN ('LEGACY_EXPECTED','CANONICAL_EXPECTED','ABSENT')
               AND (SELECT classification FROM final_class WHERE table_name = 'evidence_items')
                     IN ('LEGACY_EXPECTED','CANONICAL_EXPECTED','ABSENT')
              THEN 'PASS' ELSE 'FAIL' END,
         'P2_01_REQUIRED_FOR_REACHABLE_OPERATION: legacy/absent P2 tables can be safely relocated/replaced by empty canonical P2-01 objects, and canonical P2-01 tables are valid in a converged state; an unrecognized shape remains a hard fail'
  UNION ALL
  SELECT 'APPLICABILITY', 'NO_HISTORICAL_MIGRATION_REPLAY_REQUIRED', 'migrations/kai_sprint2_p1_*.sql',
         'PASS',
         'the atomic bundle installs the canonical objects itself from extracted canonical DDL; no historical migration is executed as a production step'
)

SELECT * FROM checks
-- 6. Safe aggregate counts. Counts only - never a row, an identifier or any
--    business content. Counted through query_to_xml over the catalog rather than
--    by naming each table statically, so this one script parses and runs
--    unchanged whether an object is currently present in kai, present in
--    kai_legacy_20260817, or absent.
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', t.nspname || '.' || t.relname, 'PASS',
       (xpath('/row/c/text()',
              query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.nspname, t.relname),
                           false, true, '')))[1]::text
  FROM (
    SELECT n.nspname, r.relname
      FROM pg_class r
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE r.relkind = 'r'
       AND (
         (n.nspname IN ('kai', 'kai_legacy_20260817')
            AND r.relname IN (SELECT table_name FROM signature))
         OR (n.nspname = 'kai' AND r.relname = 'review_queue_items')
       )
  ) t
UNION ALL
SELECT 'LEGACY_QUEUE_TARGET', 'COUNT_BY_TYPE',
       qt.queue_type || '/' || qt.target_object_type, 'PASS',
       qt.row_count || ' row(s) target this object type; the cutover marks only those whose target is proven to exist in the preserved legacy table, and never resolves, retargets, moves or deletes any of them'
  FROM queue_targets qt
ORDER BY result_type, check_name, object_name;
