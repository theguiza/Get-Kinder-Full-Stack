-- ==========================================================================
-- KAI legacy-generation cutover - CORRECTED forward-only bundle (2026-08-17)
--
-- ONE atomic, pgAdmin-Query-Tool-executable transaction. No psql meta-commands,
-- no \i, no DATABASE_URL, no external transaction wrapper, no nested
-- historical-migration transaction boundaries. Any error before COMMIT rolls
-- back the complete cutover; there is no reachable committed state in which
-- legacy names have moved but the required canonical replacements are missing.
--
-- WHY THIS FILE WAS CORRECTED
-- The first pass of this cutover assumed only seven tables were legacy-shaped
-- and that kai.intake_parser_runs, kai.data_dictionary_fields,
-- kai.data_dictionary_mappings, kai.data_quality_findings,
-- kai.source_locators and kai.evidence_items were absent or already canonical.
-- Run read-only against the real production catalog, that preflight returned
-- four FAILs. Four further owner-supplied production captures then proved the
-- assumption wrong: all thirteen objects below are the same older
-- data-model generation, and the two tables the first pass believed had
-- "passed" (data_dictionary_mappings, data_quality_findings) had only passed
-- because the first pass classified shapes by a SINGLE marker column. Their
-- production shapes carry that marker column while carrying none of the
-- canonical P1-04 lineage columns. This file replaces single-column guessing
-- with a multi-factor structural signature (columns + column type classes +
-- primary key + named unique/check/foreign-key constraints + named indexes) and
-- fails closed on any shape it does not recognise.
--
-- EVIDENCE (owner-supplied, read-only production captures, 2026-08-17)
--   capture 1  full catalog: data_dictionaries, intake_file_profiles,
--              intake_files, intake_promotion_decisions,
--              intake_sensitivity_profiles, intake_source_candidates,
--              review_queue_items, source_versions, sources
--   capture 2  the production run of the first-pass preflight (29 checks, 4 FAIL)
--   capture 3  full catalog: intake_parser_runs, data_dictionary_fields,
--              source_locators, evidence_items, plus the incoming edges
--              claim_evidence_links -> evidence_items,
--              funder_requirements -> source_locators,
--              funders -> source_locators
--   capture 4  full catalog: data_dictionary_mappings, data_quality_findings
--
-- PER-OBJECT TREATMENT (classified from the captures plus current-HEAD code,
-- never from the fact that an object appeared in a foreign-key edge)
--
--   RELOCATE_LEGACY (13) - proven legacy shape sitting on a name the current
--   canonical P1 contract owns; moved intact into kai_legacy_20260817:
--     kai.intake_parser_runs           kai.intake_file_profiles
--     kai.data_dictionaries            kai.data_dictionary_fields
--     kai.data_dictionary_mappings     kai.data_quality_findings
--     kai.intake_sensitivity_profiles  kai.intake_source_candidates
--     kai.intake_promotion_decisions   kai.sources
--     kai.source_versions              kai.source_locators
--     kai.evidence_items
--
--   KEEP_SHARED_IN_KAI (never relocated, never replaced, only additively
--   extended by the narrowly-scoped changes in section 4):
--     kai.intake_files  kai.review_queue_items  kai.upload_lifecycle_audit
--     kai.organizations kai.engagements         kai.users
--
--   NOT_REQUIRED_FOR_CURRENT_CUTOVER (dependent tables whose foreign keys point
--   at relocated objects; deliberately left in kai so their rows keep
--   referencing the preserved legacy object, which is the truthful current
--   meaning of those rows). ALTER TABLE ... SET SCHEMA moves a table without
--   dropping or recreating any constraint, and a foreign key binds to the
--   referenced table's OID, not to its schema-qualified name - so each of these
--   keeps pointing at exactly the same rows after the move, now addressed as
--   kai_legacy_20260817.*:
--     kai.claim_evidence_links -> evidence_items
--     kai.funder_requirements  -> source_locators
--     kai.funders              -> source_locators
--   No currently-mounted repository caller requires a canonical object at these
--   three names right now. This is recorded, not silently ignored: the
--   post-cutover verifier reports each of these edges, and the runbook records
--   that a future P2-01/P2-03 package must handle kai.claim_evidence_links
--   explicitly (its CREATE TABLE IF NOT EXISTS in
--   migrations/kai_sprint2_p2_03_claim_proposal.sql would otherwise silently
--   skip over the retained legacy table, reproducing this same class of
--   incident).
--
--   P2-01 DECISION: P2_01_REQUIRED_FOR_REACHABLE_OPERATION.
--   Repository proof at current HEAD: the Review Cockpit source-candidate detail
--   itself still does not read source_locators or evidence_items, but the
--   authenticated Sprint 2 intake router mounts the accepted P2-01
--   evidence-extraction route and P2-02 evidence-coverage route behind only
--   KAI_SPRINT2_ENABLED. The admin Impact Evidence Library UI also exposes those
--   calls. Because KAI_SPRINT2_ENABLED is owner-confirmed enabled in production,
--   leaving kai.source_locators/kai.evidence_items absent after this cutover
--   would leave a currently mounted, human-authorized operation structurally
--   broken. This bundle therefore preserves the legacy P2 graph intact under
--   kai_legacy_20260817 and installs EMPTY canonical P2-01 source_locators and
--   evidence_items tables. It still never translates, copies, relabels, or
--   fabricates any legacy row into the canonical P2 generation.
--
-- WHAT THIS BUNDLE NEVER DOES
--   * never translates a legacy row into a canonical row
--   * never fabricates profile_canonical_sha256, file-profile / dictionary /
--     sensitivity / candidate lineage, promotion decisions, source or
--     source-version lineage, source locators, or evidence items
--   * never fabricates a queue approval, rejection, resolution or cancellation
--   * never relocates, replaces or narrows a shared object
--   * never replays a historical migration file as a production step, and never
--     edits one
--   * never narrows kai.upload_lifecycle_audit's operation vocabulary or
--     kai.review_queue_items' queue_type/queue_status vocabulary. The P1-02/04/
--     05/06/07/08 migration files each DROP and re-ADD
--     upload_lifecycle_audit_gate_a_operation_check and
--     upload_lifecycle_audit_gate_a_metadata_object_check with their own
--     generation's list. Replaying any of them against a production database
--     that has since been widened by a later package would silently SHRINK a
--     live vocabulary, so every one of those twelve statements is excluded from
--     the canonical DDL below and replaced by the fail-closed assertion in
--     section 4: the two operations the canonical P1 producers actually write
--     must ALREADY be permitted, or this bundle refuses to proceed.
--
-- OPERATIONAL TIMEOUTS: this repository defines no lock_timeout /
-- statement_timeout convention anywhere in migrations/ or scripts/, so none is
-- invented here. That decision is reported as NOT_CONFIRMED and belongs to the
-- operator running this bundle; see
-- scripts/kai-sprint2-legacy-cutover-runbook.md.
-- ==========================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. Expected starting-state signatures, revalidated INSIDE this transaction.
--
--    A temporary, ON COMMIT DROP table, so nothing here survives the
--    transaction and nothing is left behind on rollback. Each row is the
--    multi-factor structural signature of one material object, transcribed
--    from the four production captures (legacy side) and from this
--    repository's own current canonical migrations (canonical side).
--
--    legacy_columns / canonical_columns entries are 'column_name:data_type',
--    where data_type is information_schema.columns.data_type - the exact
--    vocabulary the captures use ('uuid', 'text', 'jsonb', 'boolean',
--    'smallint', 'integer', 'bigint', 'date', 'timestamp with time zone',
--    'ARRAY', 'USER-DEFINED').
-- --------------------------------------------------------------------------
CREATE TEMPORARY TABLE kai_cutover_signature (
  table_name              text PRIMARY KEY,
  legacy_columns          text[] NOT NULL,
  legacy_pk_columns       text[] NOT NULL,
  legacy_constraints      text[] NOT NULL,
  legacy_indexes          text[] NOT NULL,
  legacy_fk_edges         text[] NOT NULL,
  canonical_columns       text[] NOT NULL,
  canonical_constraints   text[] NOT NULL
) ON COMMIT DROP;

INSERT INTO kai_cutover_signature VALUES
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
 ARRAY['review_queue_item_id:uuid','reviewed_source_type:text','source_id:uuid','promoted_at:timestamp with time zone'],
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
       'evidence_items_p2_01_support_strength_check']);

CREATE TEMPORARY TABLE kai_cutover_allowed_updated_at_trigger (
  table_name   text PRIMARY KEY,
  trigger_name text NOT NULL,
  relation_oid oid
) ON COMMIT DROP;

INSERT INTO kai_cutover_allowed_updated_at_trigger (table_name, trigger_name) VALUES
('data_dictionaries', 'trg_data_dictionaries_updated_at'),
('data_dictionary_fields', 'trg_data_dictionary_fields_updated_at'),
('data_dictionary_mappings', 'trg_data_dictionary_mappings_updated_at'),
('data_quality_findings', 'trg_data_quality_findings_updated_at'),
('evidence_items', 'trg_evidence_items_updated_at'),
('intake_file_profiles', 'trg_intake_file_profiles_updated_at'),
('intake_parser_runs', 'trg_intake_parser_runs_updated_at'),
('intake_sensitivity_profiles', 'trg_intake_sensitivity_profiles_updated_at'),
('intake_source_candidates', 'trg_intake_source_candidates_updated_at'),
('source_locators', 'trg_source_locators_updated_at'),
('source_versions', 'trg_source_versions_updated_at'),
('sources', 'trg_sources_updated_at');

-- --------------------------------------------------------------------------
-- 2. In-transaction starting-state revalidation and shape classification.
--
--    Every material object is classified as exactly one of
--      LEGACY_EXPECTED    - matches the captured production legacy signature
--      CANONICAL_EXPECTED - matches this repository's canonical signature
--      ABSENT             - not present
--      UNRECOGNIZED       - anything else; always fails closed
--    using the full signature, never a single marker column or constraint.
--
--    Two whole-database starting states are accepted:
--      FULL_LEGACY - every one of the thirteen is LEGACY_EXPECTED and the
--                    destination schema does not exist yet (the real
--                    pre-cutover production state)
--      CONVERGED   - every one is CANONICAL_EXPECTED or ABSENT and the
--                    destination schema already holds this cutover's own
--                    relocated tables (a safe no-op rerun of a completed
--                    cutover)
--    Any mixture, any UNRECOGNIZED object, or an unexpected pre-existing
--    destination schema aborts the whole transaction without mutating anything.
-- --------------------------------------------------------------------------
DO $cutover_precheck$
DECLARE
  legacy_schema_name  constant text := 'kai_legacy_20260817';
  sig                 record;
  classification      text;
  legacy_count        integer := 0;
  canonical_count     integer := 0;
  absent_count        integer := 0;
  total_count         integer := 0;
  missing_detail      text;
  destination_state   text;
BEGIN
  FOR sig IN SELECT * FROM kai_cutover_signature ORDER BY table_name LOOP
    total_count := total_count + 1;

    IF to_regclass('kai.' || sig.table_name) IS NULL THEN
      classification := 'ABSENT';
      absent_count := absent_count + 1;

    ELSIF NOT EXISTS (
            -- any required legacy column missing, or present with a different
            -- data-type class than the capture recorded
            SELECT 1 FROM unnest(sig.legacy_columns) AS spec
             WHERE NOT EXISTS (
               SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'kai' AND c.table_name = sig.table_name
                  AND c.column_name = split_part(spec, ':', 1)
                  AND c.data_type = split_part(spec, ':', 2)
             )
          )
          AND NOT EXISTS (
            -- any canonical-only column present at all disqualifies the legacy
            -- classification: the two generations are mutually exclusive
            SELECT 1 FROM unnest(sig.canonical_columns) AS spec
             WHERE EXISTS (
               SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'kai' AND c.table_name = sig.table_name
                  AND c.column_name = split_part(spec, ':', 1)
             )
          )
          AND (
            SELECT coalesce(array_agg(a.attname::text ORDER BY a.attname), ARRAY[]::text[])
              FROM pg_constraint pc
              JOIN pg_class r ON r.oid = pc.conrelid
              JOIN pg_namespace n ON n.oid = r.relnamespace
              JOIN unnest(pc.conkey) AS k(attnum) ON true
              JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.attnum
             WHERE n.nspname = 'kai' AND r.relname = sig.table_name AND pc.contype = 'p'
          ) = (SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) FROM unnest(sig.legacy_pk_columns) AS x)
          AND NOT EXISTS (
            SELECT 1 FROM unnest(sig.legacy_constraints) AS required_conname
             WHERE NOT EXISTS (
               SELECT 1 FROM pg_constraint pc
                 JOIN pg_class r ON r.oid = pc.conrelid
                 JOIN pg_namespace n ON n.oid = r.relnamespace
                WHERE n.nspname = 'kai' AND r.relname = sig.table_name AND pc.conname = required_conname
             )
          )
          AND NOT EXISTS (
            SELECT 1 FROM unnest(sig.legacy_indexes) AS ixname
             WHERE NOT EXISTS (
               SELECT 1 FROM pg_indexes
                WHERE schemaname = 'kai' AND tablename = sig.table_name AND indexname = ixname
             )
          )
          AND NOT EXISTS (
            SELECT 1 FROM unnest(sig.legacy_fk_edges) AS edge
             WHERE NOT EXISTS (
               SELECT 1 FROM pg_constraint pc
                 JOIN pg_class r ON r.oid = pc.conrelid
                 JOIN pg_namespace n ON n.oid = r.relnamespace
                 JOIN pg_class fr ON fr.oid = pc.confrelid
                 JOIN pg_namespace fn ON fn.oid = fr.relnamespace
                WHERE n.nspname = 'kai' AND r.relname = sig.table_name
                  AND pc.contype = 'f'
                  AND pc.conname = split_part(edge, '->', 1)
                  AND fn.nspname || '.' || fr.relname = split_part(edge, '->', 2)
             )
          )
    THEN
      classification := 'LEGACY_EXPECTED';
      legacy_count := legacy_count + 1;

    ELSIF NOT EXISTS (
            SELECT 1 FROM unnest(sig.canonical_columns) AS spec
             WHERE NOT EXISTS (
               SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema = 'kai' AND c.table_name = sig.table_name
                  AND c.column_name = split_part(spec, ':', 1)
                  AND c.data_type = split_part(spec, ':', 2)
             )
          )
          AND NOT EXISTS (
            SELECT 1 FROM unnest(sig.canonical_constraints) AS required_conname
             WHERE NOT EXISTS (
               SELECT 1 FROM pg_constraint pc
                 JOIN pg_class r ON r.oid = pc.conrelid
                 JOIN pg_namespace n ON n.oid = r.relnamespace
                WHERE n.nspname = 'kai' AND r.relname = sig.table_name AND pc.conname = required_conname
             )
          )
    THEN
      classification := 'CANONICAL_EXPECTED';
      canonical_count := canonical_count + 1;

    ELSE
      SELECT string_agg(spec, ', ' ORDER BY spec) INTO missing_detail
        FROM unnest(sig.legacy_columns) AS spec
       WHERE NOT EXISTS (
         SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'kai' AND c.table_name = sig.table_name
            AND c.column_name = split_part(spec, ':', 1)
            AND c.data_type = split_part(spec, ':', 2)
       );
      RAISE EXCEPTION
        'kai.% is UNRECOGNIZED: it matches neither the captured production legacy signature nor this repository''s canonical signature. Legacy signature elements not satisfied: %. Refusing to guess.',
        sig.table_name, coalesce(missing_detail, '(constraint/index/primary-key/foreign-key element)');
    END IF;

    RAISE NOTICE 'kai legacy-generation cutover: kai.% classified %', sig.table_name, classification;
  END LOOP;

  -- Destination-schema state.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = legacy_schema_name) THEN
    destination_state := 'ABSENT';
  ELSIF (SELECT count(*) FROM kai_cutover_signature s
          WHERE to_regclass(legacy_schema_name || '.' || s.table_name) IS NOT NULL) = total_count THEN
    destination_state := 'CONVERGED';
  ELSE
    RAISE EXCEPTION
      'schema % already exists but does not hold this cutover''s complete relocated set; refusing to guess whether it is a partial prior run or an unrelated schema',
      legacy_schema_name;
  END IF;

  IF legacy_count = total_count AND destination_state = 'ABSENT' THEN
    RAISE NOTICE 'kai legacy-generation cutover: starting state FULL_LEGACY; proceeding.';
  ELSIF canonical_count + absent_count = total_count AND destination_state = 'CONVERGED' THEN
    RAISE NOTICE 'kai legacy-generation cutover: starting state CONVERGED; every statement below is a no-op.';
  ELSE
    RAISE EXCEPTION
      'unsupported starting state: % legacy / % canonical / % absent of % material objects, destination schema %. This bundle only accepts a fully-legacy pre-cutover state or its own fully-converged post-cutover state.',
      legacy_count, canonical_count, absent_count, total_count, destination_state;
  END IF;

  -- Shared prerequisites this bundle relies on and never installs itself.
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before the legacy-generation cutover';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
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

  -- Material dependency guard: any relocation candidate that is depended on by
  -- an object this bundle does not classify must be understood before the move,
  -- not discovered afterwards. Views, materialized views, triggers on the
  -- relocated tables, and functions/procedures whose body resolves one of these
  -- names would all change meaning under ALTER TABLE ... SET SCHEMA, so their
  -- presence fails closed. Incoming foreign keys are exempt and enumerated
  -- separately below, because a foreign key binds to the referenced table's OID
  -- and therefore survives the move pointing at exactly the same rows.
  IF legacy_count = total_count THEN
  IF EXISTS (
    SELECT 1
      FROM pg_depend d
      JOIN pg_rewrite rw ON rw.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
      JOIN pg_class v ON v.oid = rw.ev_class
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_namespace tn ON tn.oid = t.relnamespace
     WHERE tn.nspname = 'kai'
       AND t.relname IN (SELECT table_name FROM kai_cutover_signature)
       AND v.relkind IN ('v', 'm')
       AND v.oid <> t.oid
  ) THEN
    RAISE EXCEPTION 'a view or materialized view depends on a relocation candidate; this bundle does not understand that dependency and refuses to relocate';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_class r ON r.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      JOIN pg_proc p ON p.oid = tg.tgfoid
      JOIN pg_namespace pn ON pn.oid = p.pronamespace
      LEFT JOIN kai_cutover_allowed_updated_at_trigger allow
        ON allow.table_name = r.relname AND allow.trigger_name = tg.tgname
     WHERE n.nspname = 'kai'
       AND r.relname IN (SELECT table_name FROM kai_cutover_signature)
       AND NOT tg.tgisinternal
       AND (
         allow.trigger_name IS NULL
         OR pn.nspname <> 'kai'
         OR p.proname <> 'set_updated_at'
         OR pg_get_triggerdef(tg.oid) <> format('CREATE TRIGGER %I BEFORE UPDATE ON kai.%I FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at()', tg.tgname, r.relname)
       )
  ) THEN
    RAISE EXCEPTION 'an unexpected user trigger exists on a relocation candidate; only the exact production-supported BEFORE UPDATE kai.set_updated_at() trigger set is allowed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai_cutover_allowed_updated_at_trigger allow
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_trigger tg
         JOIN pg_class r ON r.oid = tg.tgrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
         JOIN pg_proc p ON p.oid = tg.tgfoid
         JOIN pg_namespace pn ON pn.oid = p.pronamespace
        WHERE n.nspname = 'kai'
          AND r.relname = allow.table_name
          AND tg.tgname = allow.trigger_name
          AND NOT tg.tgisinternal
          AND pn.nspname = 'kai'
          AND p.proname = 'set_updated_at'
          AND pg_get_triggerdef(tg.oid) = format('CREATE TRIGGER %I BEFORE UPDATE ON kai.%I FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at()', tg.tgname, r.relname)
     )
  ) THEN
    RAISE EXCEPTION 'the expected production-supported updated_at trigger set is incomplete or has a non-matching signature';
  END IF;
  UPDATE kai_cutover_allowed_updated_at_trigger allow
     SET relation_oid = r.oid
    FROM pg_class r JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai' AND r.relname = allow.table_name;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN kai_cutover_signature s ON position('kai.' || s.table_name in coalesce(p.prosrc, '')) > 0
     WHERE n.nspname = 'kai'
  ) THEN
    RAISE EXCEPTION 'a kai schema function body references a relocation candidate by schema-qualified name; relocation would silently change what it resolves to, so this bundle refuses to relocate';
  END IF;

  -- Enumerate the incoming foreign keys that will follow their parent into the
  -- preserved schema, so the operator sees them in the run log rather than
  -- discovering them later.
  FOR sig IN
    SELECT dn.nspname || '.' || dr.relname AS dependent, pc.conname,
           fn.nspname || '.' || fr.relname AS referenced
      FROM pg_constraint pc
      JOIN pg_class dr ON dr.oid = pc.conrelid
      JOIN pg_namespace dn ON dn.oid = dr.relnamespace
      JOIN pg_class fr ON fr.oid = pc.confrelid
      JOIN pg_namespace fn ON fn.oid = fr.relnamespace
     WHERE pc.contype = 'f'
       AND fn.nspname = 'kai'
       AND fr.relname IN (SELECT table_name FROM kai_cutover_signature)
       AND NOT (dn.nspname = 'kai' AND dr.relname IN (SELECT table_name FROM kai_cutover_signature))
     ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'kai legacy-generation cutover: retained dependent % keeps foreign key % into relocated %',
      sig.dependent, sig.conname, sig.referenced;
  END LOOP;
END $cutover_precheck$;

-- --------------------------------------------------------------------------
-- 3. Preserve the proven-legacy objects.
--
--    Mechanism: ALTER TABLE ... SET SCHEMA, re-selected against the now-complete
--    evidence rather than inherited from the first pass. It is the correct
--    mechanism for this graph because, for every one of the thirteen objects, it
--    provably preserves what must be preserved:
--      * rows        - SET SCHEMA rewrites no heap and touches no tuple
--      * identifiers - the relation OID, primary key values and every column
--                      value are unchanged
--      * constraints and indexes - not dropped, not recreated, not revalidated;
--                      they move with the table
--      * legacy-to-legacy foreign keys - both endpoints move, and the keys bind
--                      by OID, so every one keeps working across the move
--      * intended legacy-to-shared foreign keys - the captured edges into
--                      kai.intake_files, kai.organizations, kai.engagements and
--                      kai.users keep referencing those shared tables, which
--                      this bundle never moves
--      * dependent-table foreign keys - kai.claim_evidence_links,
--                      kai.funder_requirements and kai.funders keep pointing at
--                      exactly the same rows, now addressed under the preserved
--                      schema
--      * trigger and function behaviour - section 2 has already proven there are
--                      no user triggers on these tables and no kai function body
--                      that resolves any of these names, so nothing can change
--                      meaning under the move
--    The mechanism cannot make an old record appear canonical: the relocated
--    tables keep their legacy names inside the preserved schema and no canonical
--    reader ever addresses that schema.
--
--    Order matters only for readability here - SET SCHEMA has no ordering
--    requirement, because no key is dropped at any point.
-- --------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS kai_legacy_20260817;

COMMENT ON SCHEMA kai_legacy_20260817 IS
  'Preserved pre-Sprint2 KAI data generation, relocated intact (rows, identifiers, constraints, indexes and foreign keys unmodified) by the 2026-08-17 legacy-generation cutover so the canonical P1 contract could take the kai.* names. Never read by canonical application code. Never translated into canonical rows.';

DO $cutover_relocate$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'evidence_items', 'source_locators',
    'intake_promotion_decisions', 'intake_source_candidates',
    'intake_sensitivity_profiles',
    'data_quality_findings', 'data_dictionary_mappings', 'data_dictionary_fields',
    'data_dictionaries',
    'source_versions', 'sources',
    'intake_parser_runs', 'intake_file_profiles'
  ] LOOP
    IF to_regclass('kai.' || target) IS NOT NULL
       AND to_regclass('kai_legacy_20260817.' || target) IS NULL THEN
      EXECUTE format('ALTER TABLE kai.%I SET SCHEMA kai_legacy_20260817', target);
      RAISE NOTICE 'kai legacy-generation cutover: preserved kai.% as kai_legacy_20260817.%', target, target;
    END IF;
  END LOOP;
END $cutover_relocate$;

DO $cutover_trigger_relocation_assert$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM kai_cutover_allowed_updated_at_trigger allow
      JOIN pg_class r ON r.oid = allow.relation_oid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      LEFT JOIN pg_trigger tg
        ON tg.tgrelid = r.oid AND tg.tgname = allow.trigger_name AND NOT tg.tgisinternal
      LEFT JOIN pg_proc p ON p.oid = tg.tgfoid
      LEFT JOIN pg_namespace pn ON pn.oid = p.pronamespace
     WHERE allow.relation_oid IS NOT NULL
       AND (
         n.nspname <> 'kai_legacy_20260817'
         OR r.relname <> allow.table_name
         OR tg.oid IS NULL
         OR pn.nspname <> 'kai'
         OR p.proname <> 'set_updated_at'
         OR pg_get_triggerdef(tg.oid) <> format('CREATE TRIGGER %I BEFORE UPDATE ON kai_legacy_20260817.%I FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at()', allow.trigger_name, allow.table_name)
       )
  ) THEN
    RAISE EXCEPTION 'allowed updated_at trigger did not remain attached to its preserved legacy relation after relocation';
  END IF;
END $cutover_trigger_relocation_assert$;

-- --------------------------------------------------------------------------
-- 5. Install the required canonical objects at the freed kai.* names.
--
--    The DDL below is extracted from this repository's own current canonical
--    migration files, which are NOT edited and NOT executed as production steps
--    by this cutover. Each extract is verbatim except that the source file's own
--    BEGIN;/COMMIT; are removed (this bundle is one transaction) and its
--    ALTER TABLE kai.upload_lifecycle_audit constraint REPLACEMENTS are removed
--    (section 4 explains why, and asserts the requirement additively instead).
--    The eight ALTER TABLE ... ADD CONSTRAINT statements that the source files
--    write without a DROP CONSTRAINT IF EXISTS have been made idempotent so a
--    converged rerun is a genuine no-op; no constraint definition is otherwise
--    altered.
--
--    Empty canonical P2-01 source_locators/evidence_items objects are installed
--    after relocation because those names are used by accepted mounted P2
--    operations. No legacy P2 row is translated into them.
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 4. Shared objects: proven-safe additive changes only. These come BEFORE the
--    canonical DDL below, because the canonical P1-07 and P1-08 definitions
--    guard by name on review_queue_items_p1_06_queue_type_check and
--    review_queue_items_p1_06_queue_status_check existing first - and the shared
--    production review_queue_items table, which is never replaced, does not
--    carry them.
--
--    kai.review_queue_items is live today under queue_type =
--    'intake_file_review' via already-wired repository code
--    (Backend/kai/db/kaiIntakeQueries.js insertReviewQueueItem /
--    updateReviewQueueItemStatusIfCurrent, reached from
--    Backend/kai/routes/sprint2IntakeApi.js), so it is never relocated and never
--    replaced. Its production shape (capture 1) carries unnamed CHECK
--    constraints whose vocabularies already include every literal the canonical
--    P1-06/07/08 code writes; those existing constraints are left exactly as
--    they are. Only the two constraints the canonical P1-07/P1-08 contract
--    requires BY NAME are added, over the identical vocabulary the existing
--    unnamed constraints already enforce - so no existing row of any queue_type
--    can be rejected unless it already violated its own table's existing CHECK,
--    in which case this bundle fails closed rather than accept it.
--
--    Deliberately NOT added to the shared table: the canonical P1-06
--    review_queue_items_p1_06_required_action_check (which would demand a
--    non-null required_action on every existing 'sensitivity_review' row) and
--    every other canonical P1-06 CHECK. Adding those would revalidate live
--    production rows against a contract they were never written under.
-- --------------------------------------------------------------------------
DO $cutover_shared$
DECLARE
  priority_default text;
BEGIN
  -- Gate-A-only upload_lifecycle_audit operation vocabulary is a supported
  -- starting state. The atomic cutover below widens it to the accepted
  -- cumulative P1 destination contract; an already-cumulative shape is accepted
  -- for deterministic rerun.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'upload_lifecycle_audit' AND c.contype = 'c'
       AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
       AND pg_get_constraintdef(c.oid) LIKE '%''reserve_upload''%'
       AND pg_get_constraintdef(c.oid) LIKE '%''start_upload''%'
       AND pg_get_constraintdef(c.oid) LIKE '%''complete_object_version''%'
       AND pg_get_constraintdef(c.oid) LIKE '%''confirm_upload''%'
       AND pg_get_constraintdef(c.oid) LIKE '%''block_upload''%'
       AND pg_get_constraintdef(c.oid) LIKE '%''abandon_upload''%'
       AND pg_get_constraintdef(c.oid) LIKE '%''expire_upload''%'
       AND pg_get_constraintdef(c.oid) LIKE '%''policy_decision_compare_and_set''%'
       AND (
         pg_get_constraintdef(c.oid) NOT LIKE '%''parser_run_recorded''%'
         OR (
           pg_get_constraintdef(c.oid) LIKE '%''parser_run_recorded''%'
           AND pg_get_constraintdef(c.oid) LIKE '%''file_profile_persisted''%'
           AND pg_get_constraintdef(c.oid) LIKE '%''data_dictionary_draft_persisted''%'
           AND pg_get_constraintdef(c.oid) LIKE '%''intake_sensitivity_profile_persisted''%'
           AND pg_get_constraintdef(c.oid) LIKE '%''sensitivity_review_queue_item_created''%'
           AND pg_get_constraintdef(c.oid) LIKE '%''intake_source_candidate_persisted''%'
           AND pg_get_constraintdef(c.oid) LIKE '%''source_promotion_decision_persisted''%'
         )
       )
  ) THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit operation CHECK is neither the supported Gate-A starting vocabulary nor the cumulative P1 destination vocabulary';
  END IF;

  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO priority_default
    FROM pg_attrdef d
    JOIN pg_class r ON r.oid = d.adrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = d.adnum
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND a.attname = 'priority';

  IF EXISTS (
    SELECT 1 FROM pg_attribute a
      JOIN pg_class r ON r.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      JOIN pg_type ty ON ty.oid = a.atttypid
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND a.attname = 'priority' AND ty.typnamespace = n.oid
       AND ty.typname = 'priority_enum' AND ty.typtype = 'e'
       AND priority_default = '''medium''::kai.priority_enum'
       AND ARRAY(
         SELECT e.enumlabel::text FROM pg_enum e
          WHERE e.enumtypid = ty.oid ORDER BY e.enumsortorder
       ) = ARRAY['mandatory','immediate_fix','high','medium','low','backlog','not_applicable','unknown']::text[]
  ) THEN
    ALTER TABLE kai.review_queue_items
      ALTER COLUMN priority DROP DEFAULT;
    ALTER TABLE kai.review_queue_items
      ALTER COLUMN priority TYPE text USING priority::text;
    ALTER TABLE kai.review_queue_items
      ALTER COLUMN priority SET DEFAULT 'medium';
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema = 'kai' AND c.table_name = 'review_queue_items'
       AND c.column_name = 'priority' AND c.data_type = 'text'
       AND c.column_default = '''medium''::text'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items.priority is not the supported production enum starting shape or the converged text compatibility shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_cutover_priority_compat_check'
  ) THEN
    ALTER TABLE kai.review_queue_items
      ADD CONSTRAINT review_queue_items_cutover_priority_compat_check
      CHECK (priority IN (
        'mandatory', 'immediate_fix', 'high', 'medium', 'low', 'backlog',
        'not_applicable', 'unknown', 'normal'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%source_candidate_review%'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items.queue_type CHECK does not already permit source_candidate_review; refusing to guess a compatible shape';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review%'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items.queue_type CHECK does not already permit sensitivity_review; refusing to guess a compatible shape';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p1_06_queue_type_check'
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
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p1_06_queue_status_check'
  ) THEN
    ALTER TABLE kai.review_queue_items
      ADD CONSTRAINT review_queue_items_p1_06_queue_status_check
      CHECK (queue_status IN ('open', 'in_progress', 'blocked', 'waiting_on_client', 'waiting_on_gk', 'resolved', 'cancelled'));
  END IF;
END $cutover_shared$;

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_operation_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
    CHECK (operation IN (
      'reserve_upload',
      'start_upload',
      'complete_object_version',
      'confirm_upload',
      'block_upload',
      'abandon_upload',
      'expire_upload',
      'policy_decision_compare_and_set',
      'parser_run_recorded',
      'file_profile_persisted',
      'data_dictionary_draft_persisted',
      'intake_sensitivity_profile_persisted',
      'sensitivity_review_queue_item_created',
      'intake_source_candidate_persisted',
      'source_promotion_decision_persisted'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND kai.gate_a_p0_jsonb_metadata_only(metadata)
      AND (
        operation <> 'policy_decision_compare_and_set'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_policy_status'
          AND metadata ? 'policy_decision_outcome'
          AND metadata ? 'object_version_bound'
          AND metadata ? 'verified_checksum_bound'
          AND metadata ? 'verified_size_bytes_bound'
          AND metadata ? 'declared_mime'
          AND metadata ? 'extension'
          AND metadata ? 'replay_contract_version'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'sanitized_result'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_policy_status',
            'policy_decision_outcome',
            'object_version_bound',
            'verified_checksum_bound',
            'verified_size_bytes_bound',
            'declared_mime',
            'extension',
            'replay_contract_version',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'parser_run_recorded'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'parser_name'
          AND metadata ? 'parser_version'
          AND metadata ? 'checksum_bound'
          AND metadata ? 'parser_status'
          AND metadata ? 'retry_count'
          AND metadata ? 'error_code'
          AND metadata ? 'error_message_safe'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'parser_name',
            'parser_version',
            'checksum_bound',
            'parser_status',
            'retry_count',
            'error_code',
            'error_message_safe',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'file_profile_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'parser_name'
          AND metadata ? 'parser_version'
          AND metadata ? 'checksum_bound'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'profile'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'parser_name',
            'parser_version',
            'checksum_bound',
            'profile_canonical_sha256',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'data_dictionary_draft_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'dictionary_status'
          AND metadata ? 'field_count'
          AND metadata ? 'mapping_count'
          AND metadata ? 'finding_count'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'profile'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_profile_id',
            'profile_canonical_sha256',
            'dictionary_status',
            'field_count',
            'mapping_count',
            'finding_count',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'intake_sensitivity_profile_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_profile_id'
          AND metadata ? 'data_dictionary_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'human_review_required'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_profile_id',
            'data_dictionary_id',
            'profile_canonical_sha256',
            'human_review_required',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'sensitivity_review_queue_item_created'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'queue_type'
          AND metadata ? 'target_object_type'
          AND metadata ? 'target_object_id'
          AND metadata ? 'queue_status'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'queue_type',
            'target_object_type',
            'target_object_id',
            'queue_status',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'intake_source_candidate_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'intake_sensitivity_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'proposed_source_type'
          AND metadata ? 'candidate_status'
          AND metadata ? 'queue_type'
          AND metadata ? 'target_object_type'
          AND metadata ? 'target_object_id'
          AND metadata ? 'queue_status'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'intake_sensitivity_profile_id',
            'profile_canonical_sha256',
            'proposed_source_type',
            'candidate_status',
            'queue_type',
            'target_object_type',
            'target_object_id',
            'queue_status',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'source_promotion_decision_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'intake_source_candidate_id'
          AND metadata ? 'intake_sensitivity_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'reviewed_source_type'
          AND metadata ? 'decision_status'
          AND metadata ? 'candidate_status'
          AND metadata ? 'queue_status'
          AND metadata ? 'source_id'
          AND metadata ? 'source_version_id'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'storage_uri'
          AND NOT metadata ? 'signed_url'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'intake_source_candidate_id',
            'intake_sensitivity_profile_id',
            'profile_canonical_sha256',
            'reviewed_source_type',
            'decision_status',
            'candidate_status',
            'queue_status',
            'source_id',
            'source_version_id',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
    );

-- =====================================================================
-- Canonical DDL extracted from migrations/kai_sprint2_p1_parser_run_and_file_profile.sql
-- (P1-02 parser run + file profile).
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before P1-02 parser-run/file-profile migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-02 parser-run/file-profile migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-02 parser-run/file-profile migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.intake_parser_runs (
  parser_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  checksum text NOT NULL,
  parser_status text NOT NULL DEFAULT 'queued',
  retry_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message_safe text,
  output_profile_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_parser_runs_p1_identity_unique
    UNIQUE (organization_id, intake_file_id, parser_name, parser_version, checksum),
  CONSTRAINT intake_parser_runs_p1_run_identity_unique
    UNIQUE (parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum),
  CONSTRAINT intake_parser_runs_p1_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_parser_runs_p1_parser_name_check
    CHECK (length(parser_name) BETWEEN 1 AND 128 AND parser_name = lower(btrim(parser_name)) AND parser_name ~ '^[a-z0-9_]+$'),
  CONSTRAINT intake_parser_runs_p1_parser_version_check
    CHECK (length(parser_version) BETWEEN 1 AND 64 AND parser_version = lower(btrim(parser_version)) AND parser_version ~ '^[a-z0-9._-]+$'),
  CONSTRAINT intake_parser_runs_p1_checksum_check
    CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT intake_parser_runs_p1_parser_status_check
    CHECK (parser_status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT intake_parser_runs_p1_retry_count_check
    CHECK (retry_count BETWEEN 0 AND 3),
  CONSTRAINT intake_parser_runs_p1_error_code_check
    CHECK (error_code IS NULL OR (length(error_code) BETWEEN 1 AND 64 AND error_code = lower(btrim(error_code)) AND error_code ~ '^[a-z0-9_]+$')),
  CONSTRAINT intake_parser_runs_p1_error_message_safe_check
    CHECK (
      error_message_safe IS NULL
      OR (
        length(error_message_safe) BETWEEN 1 AND 500
        AND error_message_safe !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|  at [A-Za-z])'
      )
    ),
  CONSTRAINT intake_parser_runs_p1_state_fact_consistency_check
    CHECK (
      (parser_status = 'queued' AND completed_at IS NULL AND output_profile_id IS NULL AND error_code IS NULL AND error_message_safe IS NULL)
      OR (parser_status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL AND output_profile_id IS NULL AND error_code IS NULL AND error_message_safe IS NULL)
      OR (parser_status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND output_profile_id IS NOT NULL AND error_code IS NULL AND error_message_safe IS NULL)
      OR (parser_status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_code IS NOT NULL AND error_message_safe IS NOT NULL AND output_profile_id IS NULL)
      OR (parser_status = 'cancelled' AND completed_at IS NOT NULL AND output_profile_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_intake_parser_runs_p1_tenant_file
  ON kai.intake_parser_runs (organization_id, intake_file_id);

CREATE TABLE IF NOT EXISTS kai.intake_file_profiles (
  file_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  parser_run_id uuid NOT NULL,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  checksum text NOT NULL,
  profile jsonb NOT NULL,
  profile_canonical_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_file_profiles_p1_identity_unique
    UNIQUE (organization_id, intake_file_id, parser_name, parser_version, checksum),
  CONSTRAINT intake_file_profiles_p1_run_identity_unique
    UNIQUE (file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum),
  CONSTRAINT intake_file_profiles_p1_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_file_profiles_p1_parser_run_fk
    FOREIGN KEY (parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
    REFERENCES kai.intake_parser_runs (parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
    ON DELETE RESTRICT,
  CONSTRAINT intake_file_profiles_p1_parser_name_check
    CHECK (length(parser_name) BETWEEN 1 AND 128 AND parser_name = lower(btrim(parser_name)) AND parser_name ~ '^[a-z0-9_]+$'),
  CONSTRAINT intake_file_profiles_p1_parser_version_check
    CHECK (length(parser_version) BETWEEN 1 AND 64 AND parser_version = lower(btrim(parser_version)) AND parser_version ~ '^[a-z0-9._-]+$'),
  CONSTRAINT intake_file_profiles_p1_checksum_check
    CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT intake_file_profiles_p1_profile_object_check
    CHECK (jsonb_typeof(profile) = 'object'),
  CONSTRAINT intake_file_profiles_p1_profile_metadata_only_check
    CHECK (kai.gate_a_p0_jsonb_metadata_only(profile)),
  CONSTRAINT intake_file_profiles_p1_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS ix_intake_file_profiles_p1_tenant_file
  ON kai.intake_file_profiles (organization_id, intake_file_id);

CREATE INDEX IF NOT EXISTS ix_intake_file_profiles_p1_parser_run
  ON kai.intake_file_profiles (parser_run_id);

DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'intake_parser_runs' AND pc.conname = 'intake_parser_runs_p1_output_profile_fk'
  ) THEN
    ALTER TABLE kai.intake_parser_runs
    ADD CONSTRAINT intake_parser_runs_p1_output_profile_fk
    FOREIGN KEY (output_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
    REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
    ON DELETE RESTRICT;
  END IF;
END $idem$;

-- =====================================================================
-- Canonical DDL extracted from migrations/kai_sprint2_p1_04_data_dictionary_and_quality.sql
-- (P1-04 data dictionary + quality).
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before P1-04 data-dictionary/quality migration';
  END IF;
  IF to_regclass('kai.intake_file_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_file_profiles is required before P1-04 data-dictionary/quality migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-04 data-dictionary/quality migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-04 data-dictionary/quality migration';
  END IF;
END $$;

-- Backward-compatible extension of the existing frozen P1-02 substrate: a composite
-- parent key that lets P1-04 bind immutable dictionary lineage to the exact stored
-- profile identity and its already-immutable canonical hash. No existing constraint
-- on kai.intake_file_profiles is altered or dropped.
DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'intake_file_profiles' AND pc.conname = 'intake_file_profiles_p1_04_lineage_unique'
  ) THEN
    ALTER TABLE kai.intake_file_profiles
    ADD CONSTRAINT intake_file_profiles_p1_04_lineage_unique
    UNIQUE (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256);
  END IF;
END $idem$;

CREATE TABLE IF NOT EXISTS kai.data_dictionaries (
  data_dictionary_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL,
  dictionary_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_dictionaries_p1_04_bundle_identity_unique
    UNIQUE (organization_id, file_profile_id),
  CONSTRAINT data_dictionaries_p1_04_lineage_unique
    UNIQUE (data_dictionary_id, organization_id, intake_file_id, file_profile_id),
  CONSTRAINT data_dictionaries_p1_04_child_fk_unique
    UNIQUE (data_dictionary_id, organization_id, file_profile_id),
  CONSTRAINT data_dictionaries_p1_04_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT data_dictionaries_p1_04_profile_lineage_fk
    FOREIGN KEY (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT data_dictionaries_p1_04_status_check
    CHECK (dictionary_status = 'draft'),
  CONSTRAINT data_dictionaries_p1_04_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS ix_data_dictionaries_p1_04_tenant_file
  ON kai.data_dictionaries (organization_id, intake_file_id);

CREATE TABLE IF NOT EXISTS kai.data_dictionary_fields (
  data_dictionary_field_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_dictionary_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  profile_field_key text NOT NULL,
  field_label_safe text NOT NULL,
  data_type text NOT NULL,
  business_meaning text NOT NULL DEFAULT 'unknown',
  entity_level text NOT NULL DEFAULT 'unknown',
  quality_notes_safe text,
  -- Nullable with no default on purpose: absence of an explicit committed
  -- profile-provided confidence is stored as NULL, never as a fabricated certainty.
  mapping_confidence numeric(3,2),
  review_status text NOT NULL DEFAULT 'needs_gk_review',
  sensitivity text NOT NULL DEFAULT 'unknown',
  allowed_use text NOT NULL DEFAULT 'internal',
  consent_status text NOT NULL DEFAULT 'unknown',
  consent_scope text NOT NULL DEFAULT 'none',
  llm_use_allowed boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  human_review_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_dictionary_fields_p1_04_identity_unique
    UNIQUE (data_dictionary_id, profile_field_key),
  CONSTRAINT data_dictionary_fields_p1_04_lineage_unique
    UNIQUE (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key),
  CONSTRAINT data_dictionary_fields_p1_04_dictionary_fk
    FOREIGN KEY (data_dictionary_id, organization_id, file_profile_id)
    REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id, file_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT data_dictionary_fields_p1_04_field_key_check
    CHECK (length(profile_field_key) BETWEEN 1 AND 128 AND profile_field_key = lower(btrim(profile_field_key)) AND profile_field_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT data_dictionary_fields_p1_04_label_safe_check
    CHECK (
      length(field_label_safe) BETWEEN 1 AND 200
      AND field_label_safe !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    ),
  CONSTRAINT data_dictionary_fields_p1_04_data_type_check
    CHECK (length(data_type) BETWEEN 1 AND 64 AND data_type = lower(btrim(data_type)) AND data_type ~ '^[a-z0-9_]+$'),
  CONSTRAINT data_dictionary_fields_p1_04_business_meaning_check
    CHECK (
      business_meaning = 'unknown'
      OR (
        length(business_meaning) BETWEEN 1 AND 200
        AND business_meaning !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
      )
    ),
  CONSTRAINT data_dictionary_fields_p1_04_entity_level_check
    CHECK (
      entity_level = 'unknown'
      OR (length(entity_level) BETWEEN 1 AND 64 AND entity_level = lower(btrim(entity_level)) AND entity_level ~ '^[a-z0-9_]+$')
    ),
  CONSTRAINT data_dictionary_fields_p1_04_quality_notes_safe_check
    CHECK (
      quality_notes_safe IS NULL
      OR (
        length(quality_notes_safe) BETWEEN 1 AND 500
        AND quality_notes_safe !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
      )
    ),
  -- The only accepted mapping_confidence values are NULL (unknown) or an explicit
  -- finite value inside the authoritative inclusive range [0, 1]. numeric 'NaN' sorts
  -- above every number, so it fails this comparison; numeric 'Infinity' is refused
  -- earlier still, by the numeric(3,2) precision of the column itself.
  CONSTRAINT data_dictionary_fields_p1_04_mapping_confidence_check
    CHECK (
      mapping_confidence IS NULL
      OR (mapping_confidence >= 0 AND mapping_confidence <= 1)
    ),
  CONSTRAINT data_dictionary_fields_p1_04_review_status_check
    CHECK (review_status = 'needs_gk_review'),
  CONSTRAINT data_dictionary_fields_p1_04_sensitivity_check
    CHECK (sensitivity = 'unknown'),
  CONSTRAINT data_dictionary_fields_p1_04_allowed_use_check
    CHECK (allowed_use = 'internal'),
  CONSTRAINT data_dictionary_fields_p1_04_consent_status_check
    CHECK (consent_status = 'unknown'),
  CONSTRAINT data_dictionary_fields_p1_04_consent_scope_check
    CHECK (consent_scope = 'none'),
  CONSTRAINT data_dictionary_fields_p1_04_llm_use_check
    CHECK (llm_use_allowed = false),
  CONSTRAINT data_dictionary_fields_p1_04_public_use_check
    CHECK (public_use_allowed = false),
  CONSTRAINT data_dictionary_fields_p1_04_funder_use_check
    CHECK (funder_use_allowed = false),
  CONSTRAINT data_dictionary_fields_p1_04_human_review_check
    CHECK (human_review_required = true)
);

CREATE INDEX IF NOT EXISTS ix_data_dictionary_fields_p1_04_dictionary
  ON kai.data_dictionary_fields (data_dictionary_id);

CREATE TABLE IF NOT EXISTS kai.data_dictionary_mappings (
  data_dictionary_mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_dictionary_field_id uuid NOT NULL,
  data_dictionary_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  profile_field_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_dictionary_mappings_p1_04_field_unique
    UNIQUE (data_dictionary_field_id),
  CONSTRAINT data_dictionary_mappings_p1_04_field_key_check
    CHECK (length(profile_field_key) BETWEEN 1 AND 128 AND profile_field_key = lower(btrim(profile_field_key)) AND profile_field_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT data_dictionary_mappings_p1_04_field_fk
    FOREIGN KEY (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key)
    REFERENCES kai.data_dictionary_fields (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_data_dictionary_mappings_p1_04_dictionary
  ON kai.data_dictionary_mappings (data_dictionary_id);

CREATE TABLE IF NOT EXISTS kai.data_quality_findings (
  data_quality_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_dictionary_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  profile_field_key text NOT NULL DEFAULT 'file_level',
  finding_type text NOT NULL,
  finding_status text NOT NULL DEFAULT 'open',
  finding_detail_safe text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_quality_findings_p1_04_identity_unique
    UNIQUE (data_dictionary_id, finding_type, profile_field_key),
  CONSTRAINT data_quality_findings_p1_04_dictionary_fk
    FOREIGN KEY (data_dictionary_id, organization_id, file_profile_id)
    REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id, file_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT data_quality_findings_p1_04_type_check
    CHECK (finding_type IN (
      'missingness',
      'duplicate_rows',
      'type_inconsistency',
      'invalid_date',
      'formula_like_content',
      'safe_profiler_warning'
    )),
  CONSTRAINT data_quality_findings_p1_04_status_check
    CHECK (finding_status = 'open'),
  CONSTRAINT data_quality_findings_p1_04_field_key_check
    CHECK (length(profile_field_key) BETWEEN 1 AND 128 AND profile_field_key = lower(btrim(profile_field_key)) AND profile_field_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT data_quality_findings_p1_04_detail_safe_check
    CHECK (
      length(finding_detail_safe) BETWEEN 1 AND 500
      AND finding_detail_safe !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    )
);

CREATE INDEX IF NOT EXISTS ix_data_quality_findings_p1_04_dictionary
  ON kai.data_quality_findings (data_dictionary_id);

-- =====================================================================
-- Canonical DDL extracted from migrations/kai_sprint2_p1_05_intake_sensitivity_profile.sql
-- (P1-05 intake sensitivity profile).
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF to_regclass('kai.intake_file_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_file_profiles is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF to_regclass('kai.data_dictionaries') IS NULL THEN
    RAISE EXCEPTION 'kai.data_dictionaries is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_file_profiles'
       AND c.conname = 'intake_file_profiles_p1_04_lineage_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_file_profiles_p1_04_lineage_unique is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'data_dictionaries'
       AND c.conname = 'data_dictionaries_p1_04_lineage_unique'
  ) THEN
    RAISE EXCEPTION 'kai.data_dictionaries_p1_04_lineage_unique is required before P1-05 intake-sensitivity-profile migration';
  END IF;
END $$;

-- P1-05 owner decision: one authoritative sensitivity/allowed-use profile row per
-- organization_id + file_profile_id + data_dictionary_id. This is the foundation table
-- and schema/repository/service scaffold only: every dimension below is a fail-closed
-- 'unknown' placeholder. No currently authorized profiler, validator, review service, or
-- producer contract emits a classification, consent, sensitivity, or permission fact, so
-- this package never reads kai.intake_file_profiles.profile (machine-generated profiling
-- metadata, not authoritative classification or consent input) or infers a dimension from
-- raw content, filenames, field names, or absence. No column here executes retention,
-- deletes data, changes storage lifecycle, activates a job, or grants any approval or
-- external-release authority. review_status/review_requirements are not persisted:
-- the only committed fact about review is the fail-closed human_review_required flag.
CREATE TABLE IF NOT EXISTS kai.intake_sensitivity_profiles (
  intake_sensitivity_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  data_dictionary_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL,

  -- Phase 5 semantic dimensions. Each is its own column and its own 3-state
  -- (or allowed/not_allowed/unknown) CHECK-enforced enum. 'unknown' is a real,
  -- distinct, queryable value: it never collapses into false/absent/clear/safe/
  -- permitted/not-applicable. Every dimension defaults to 'unknown' and is replaced
  -- only when the repository-loaded committed profile lineage states an explicit
  -- safe fact for that exact dimension.
  pii_status text NOT NULL DEFAULT 'unknown',
  minor_data_status text NOT NULL DEFAULT 'unknown',
  health_housing_justice_immigration_status text NOT NULL DEFAULT 'unknown',
  indigenous_governance_status text NOT NULL DEFAULT 'unknown',
  staff_notes_status text NOT NULL DEFAULT 'unknown',
  story_testimonial_status text NOT NULL DEFAULT 'unknown',
  small_cell_risk_status text NOT NULL DEFAULT 'unknown',
  financial_records_status text NOT NULL DEFAULT 'unknown',
  consent_basis_status text NOT NULL DEFAULT 'unknown',
  allowed_use_status text NOT NULL DEFAULT 'unknown',

  -- Enforced fail-closed restrictions for this foundation package: unconditional
  -- pinned values, exactly like P1-04's own per-field CHECK (x = 'fixed_value')
  -- idiom. These are restrictions this package enforces, not approvals or completed
  -- classifications: public/funder/LLM/product-learning use is never permitted here,
  -- and human review is always still required.
  llm_processing_allowed boolean NOT NULL DEFAULT false,
  product_learning_allowed boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  human_review_required boolean NOT NULL DEFAULT true,

  -- Retention posture is a labeled restriction/unresolved-state fact only - never a
  -- retention execution, deletion, lifecycle change, or job activation. Pinned to a
  -- single fail-closed value for this foundation package, exactly analogous to how
  -- P1-04 pinned dictionary_status to 'draft'.
  retention_posture text NOT NULL DEFAULT 'restricted_pending_review',

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intake_sensitivity_profiles_p1_05_identity_unique
    UNIQUE (organization_id, file_profile_id, data_dictionary_id),
  CONSTRAINT intake_sensitivity_profiles_p1_05_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_sensitivity_profiles_p1_05_profile_lineage_fk
    FOREIGN KEY (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT intake_sensitivity_profiles_p1_05_dictionary_lineage_fk
    FOREIGN KEY (data_dictionary_id, organization_id, intake_file_id, file_profile_id)
    REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id, intake_file_id, file_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_sensitivity_profiles_p1_05_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$'),

  CONSTRAINT intake_sensitivity_profiles_p1_05_pii_status_check
    CHECK (pii_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_minor_data_status_check
    CHECK (minor_data_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_hhji_status_check
    CHECK (health_housing_justice_immigration_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_indig_gov_status_check
    CHECK (indigenous_governance_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_staff_notes_status_check
    CHECK (staff_notes_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_story_testimonial_check
    CHECK (story_testimonial_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_small_cell_risk_status_check
    CHECK (small_cell_risk_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_fin_records_status_check
    CHECK (financial_records_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_consent_basis_status_check
    CHECK (consent_basis_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_allowed_use_status_check
    CHECK (allowed_use_status IN ('unknown', 'allowed', 'not_allowed')),

  CONSTRAINT intake_sensitivity_profiles_p1_05_llm_processing_check
    CHECK (llm_processing_allowed = false),
  CONSTRAINT intake_sensitivity_profiles_p1_05_product_learning_check
    CHECK (product_learning_allowed = false),
  CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check
    CHECK (public_use_allowed = false),
  CONSTRAINT intake_sensitivity_profiles_p1_05_funder_use_check
    CHECK (funder_use_allowed = false),
  CONSTRAINT intake_sensitivity_profiles_p1_05_human_review_check
    CHECK (human_review_required = true),
  CONSTRAINT intake_sensitivity_profiles_p1_05_retention_posture_check
    CHECK (retention_posture = 'restricted_pending_review')
);

CREATE INDEX IF NOT EXISTS ix_intake_sensitivity_profiles_p1_05_tenant_file
  ON kai.intake_sensitivity_profiles (organization_id, intake_file_id);

CREATE INDEX IF NOT EXISTS ix_intake_sensitivity_profiles_p1_05_dictionary
  ON kai.intake_sensitivity_profiles (data_dictionary_id);

-- =====================================================================
-- Canonical DDL extracted from migrations/kai_sprint2_p1_06_review_queue.sql
-- (P1-06 review queue).
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('kai.intake_sensitivity_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles is required before P1-06 review-queue migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-06 review-queue migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-06 review-queue migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_profiles'
       AND c.conname = 'intake_sensitivity_profiles_p1_05_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles_p1_05_identity_unique is required before P1-06 review-queue migration';
  END IF;
END $$;

-- P1-06 owner decision: this is the first tracked creation of the canonical,
-- already-production-used kai.review_queue_items table (Backend/kai/db/kaiIntakeQueries.js
-- and Backend/kai/services/kaiReviewQueueService.js already code against this exact
-- column list; scripts/kai-sprint2-ddl-vocabulary-status-check.sql already asserts the
-- queue_type/queue_status vocabularies below as required). This migration creates the
-- full canonical table - not a P1-06-only narrow subset - so every existing and future
-- queue_type keeps working unmodified. P1-06 itself only ever writes queue_type =
-- 'sensitivity_review', queue_status = 'open', priority = 'normal' rows: the wider
-- vocabulary below exists because the table is shared, not because P1-06 uses it.
CREATE TABLE IF NOT EXISTS kai.review_queue_items (
  review_queue_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  queue_type text NOT NULL,
  target_object_type text NOT NULL,
  target_object_id uuid NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  queue_status text NOT NULL DEFAULT 'open',
  review_status text NOT NULL DEFAULT 'needs_gk_review',
  blocked_reason text,
  assigned_to uuid,
  due_at timestamptz,
  summary text NOT NULL,
  required_action text,
  queue_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT review_queue_items_p1_06_queue_type_check
    CHECK (queue_type IN (
      'intake_file_review',
      'source_candidate_review',
      'sensitivity_review',
      'data_dictionary_review',
      'evidence_review',
      'claim_review',
      'client_followup',
      'conflict_resolution',
      'generated_content_review',
      'export_review'
    )),
  CONSTRAINT review_queue_items_p1_06_queue_status_check
    CHECK (queue_status IN (
      'open',
      'in_progress',
      'blocked',
      'waiting_on_client',
      'waiting_on_gk',
      'resolved',
      'cancelled'
    )),
  CONSTRAINT review_queue_items_p1_06_review_status_check
    CHECK (review_status IN ('proposed', 'needs_gk_review', 'resolved')),
  CONSTRAINT review_queue_items_p1_06_priority_check
    CHECK (priority IN ('low', 'normal', 'medium', 'high', 'urgent')),
  CONSTRAINT review_queue_items_p1_06_created_by_type_check
    CHECK (created_by_type IN ('human', 'system')),
  CONSTRAINT review_queue_items_p1_06_target_object_type_check
    CHECK (length(target_object_type) BETWEEN 1 AND 128),
  CONSTRAINT review_queue_items_p1_06_summary_check
    CHECK (length(summary) BETWEEN 1 AND 2000),
  CONSTRAINT review_queue_items_p1_06_required_action_check
    CHECK (required_action IS NULL OR length(required_action) BETWEEN 1 AND 2000),
  CONSTRAINT review_queue_items_p1_06_sensrev_required_action_check
    CHECK (
      queue_type <> 'sensitivity_review'
      OR (
        required_action IS NOT NULL
        AND length(btrim(required_action)) BETWEEN 1 AND 2000
      )
    ),
  CONSTRAINT review_queue_items_p1_06_blocked_reason_check
    CHECK (blocked_reason IS NULL OR length(blocked_reason) BETWEEN 1 AND 2000),
  CONSTRAINT review_queue_items_p1_06_queue_metadata_object_check
    CHECK (jsonb_typeof(queue_metadata) = 'object')
);

-- P1-06 idempotency identity for the 'sensitivity_review' queue_type only: a partial
-- unique index, not a table-wide constraint, so other queue_types already assumed by
-- kaiIntakeQueries.js/kaiReviewQueueService.js (for example a re-opened
-- 'intake_file_review' item for the same intake_file after an earlier one resolved)
-- keep their own legitimate multi-row-per-target behavior unmodified.
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p1_06_sensitivity_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'sensitivity_review';

CREATE INDEX IF NOT EXISTS ix_review_queue_items_p1_06_tenant_queue
  ON kai.review_queue_items (organization_id, queue_type, queue_status);

-- Row-level `updated_at` maintenance: the existing production
-- updateReviewQueueItemStatusIfCurrent query (Backend/kai/db/kaiIntakeQueries.js) never
-- sets updated_at itself, so the canonical table maintains it with a trigger, exactly
-- like any other server-maintained bookkeeping column in this schema.
CREATE OR REPLACE FUNCTION kai.review_queue_items_p1_06_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_queue_items_p1_06_touch_updated_at ON kai.review_queue_items;
CREATE TRIGGER trg_review_queue_items_p1_06_touch_updated_at
  BEFORE UPDATE ON kai.review_queue_items
  FOR EACH ROW
  EXECUTE FUNCTION kai.review_queue_items_p1_06_touch_updated_at();

-- P1-06 does not add a polymorphic or conditional foreign key from
-- review_queue_items.target_object_id: the table already carries queue_types
-- ('intake_file_review', 'data_dictionary_review', 'evidence_review', 'claim_review',
-- and others) whose target_object_id points at different target tables, so a single
-- table-wide FOREIGN KEY on that shared column cannot be expressed for one queue_type
-- without breaking the others. Instead, the P1-06 repository
-- (Backend/kai/dictionary/postgresReviewQueueRepository.js) authoritatively verifies,
-- inside the same transaction as the insert, that the referenced
-- kai.intake_sensitivity_profiles row exists and is tenant-matched before writing a
-- 'sensitivity_review' item against it.

-- =====================================================================
-- Canonical DDL extracted from migrations/kai_sprint2_p1_07_intake_source_candidate.sql
-- (P1-07 intake source candidate).
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.intake_file_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_file_profiles is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.data_dictionaries') IS NULL THEN
    RAISE EXCEPTION 'kai.data_dictionaries is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.intake_sensitivity_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_file_profiles'
       AND c.conname = 'intake_file_profiles_p1_04_lineage_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_file_profiles_p1_04_lineage_unique is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'data_dictionaries'
       AND c.conname = 'data_dictionaries_p1_04_lineage_unique'
  ) THEN
    RAISE EXCEPTION 'kai.data_dictionaries_p1_04_lineage_unique is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_profiles'
       AND c.conname = 'intake_sensitivity_profiles_p1_05_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles_p1_05_identity_unique is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p1_06_queue_type_check'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_type_check is required before P1-07 intake-source-candidate migration';
  END IF;
END $$;

-- P1-07 owner decision: kai.intake_sensitivity_profiles carries no unique constraint
-- that spans its own primary key together with the tenant/lineage tuple it belongs
-- to (only intake_sensitivity_profiles_p1_05_identity_unique on
-- (organization_id, file_profile_id, data_dictionary_id), which does not include the
-- id). A composite foreign key from kai.intake_source_candidates that ties its
-- intake_sensitivity_profile_id to the SAME row's organization_id/file_profile_id/
-- data_dictionary_id (rather than merely to any two independently-existing tuples)
-- requires a unique constraint on that exact 4-column set. Adding it here, in P1-07's
-- own forward migration, follows the accepted P1-06 precedent of extending an
-- earlier package's table (kai.upload_lifecycle_audit) from a later package's
-- migration without editing the earlier package's migration file. The new column
-- order is trivially unique because intake_sensitivity_profile_id is already the
-- table's primary key.
DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'intake_sensitivity_profiles' AND pc.conname = 'intake_sensitivity_profiles_p1_07_candidate_lineage_unique'
  ) THEN
    ALTER TABLE kai.intake_sensitivity_profiles
    ADD CONSTRAINT intake_sensitivity_profiles_p1_07_candidate_lineage_unique
    UNIQUE (intake_sensitivity_profile_id, organization_id, file_profile_id, data_dictionary_id);
  END IF;
END $idem$;

-- P1-07 foundation table: one metadata-only, review-gated source-candidate stub per
-- committed P1-05 sensitivity/allowed-use profile. No source or source_version is
-- created here, and no column in this table can express a promoted, approved,
-- finalized, or export-ready state - candidate_status is pinned to
-- 'needs_gk_review' for this foundation package, exactly like P1-05 pinned its own
-- fail-closed columns. No currently authorized producer contract emits an explicit
-- source-type classification (fresh inspection of the repository found none), so
-- proposed_source_type is pinned to the existing repository-authorized 'unknown'
-- representation rather than fabricated to satisfy a non-null column; a later,
-- separately authorized package may loosen this pin once a real producer contract
-- exists.
CREATE TABLE IF NOT EXISTS kai.intake_source_candidates (
  intake_source_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  data_dictionary_id uuid NOT NULL,
  intake_sensitivity_profile_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL,

  proposed_source_type text NOT NULL DEFAULT 'unknown',
  candidate_status text NOT NULL DEFAULT 'needs_gk_review',

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intake_source_candidates_p1_07_identity_unique
    UNIQUE (organization_id, intake_sensitivity_profile_id),
  CONSTRAINT intake_source_candidates_p1_07_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_p1_07_profile_lineage_fk
    FOREIGN KEY (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_p1_07_dictionary_lineage_fk
    FOREIGN KEY (data_dictionary_id, organization_id, intake_file_id, file_profile_id)
    REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id, intake_file_id, file_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_p1_07_sensitivity_lineage_fk
    FOREIGN KEY (intake_sensitivity_profile_id, organization_id, file_profile_id, data_dictionary_id)
    REFERENCES kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, file_profile_id, data_dictionary_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_p1_07_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT intake_source_candidates_p1_07_proposed_source_type_check
    CHECK (proposed_source_type = 'unknown'),
  CONSTRAINT intake_source_candidates_p1_07_candidate_status_check
    CHECK (candidate_status = 'needs_gk_review'),
  CONSTRAINT intake_source_candidates_p1_07_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_intake_source_candidates_p1_07_tenant_file
  ON kai.intake_source_candidates (organization_id, intake_file_id);

CREATE INDEX IF NOT EXISTS ix_intake_source_candidates_p1_07_sensitivity_profile
  ON kai.intake_source_candidates (intake_sensitivity_profile_id);

-- P1-07 idempotency identity for the 'source_candidate_review' queue_type only: a
-- partial unique index, not a table-wide constraint, so every other queue_type
-- already sharing kai.review_queue_items keeps its own legitimate cardinality
-- unmodified. This mirrors the P1-06 precedent exactly
-- (ux_review_queue_items_p1_06_sensitivity_review_identity) and is added through
-- this forward migration only; the accepted P1-06 migration is not edited.
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p1_07_source_candidate_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'source_candidate_review';

-- =====================================================================
-- Canonical DDL extracted from migrations/kai_sprint2_p1_08_source_promotion.sql
-- (P1-08 source promotion).
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('kai.intake_source_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_source_candidates is required before P1-08 source-promotion migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P1-08 source-promotion migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-08 source-promotion migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-08 source-promotion migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_source_candidates'
       AND c.conname = 'intake_source_candidates_p1_07_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_source_candidates_p1_07_identity_unique is required before P1-08 source-promotion migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p1_06_queue_status_check'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_status_check is required before P1-08 source-promotion migration';
  END IF;
END $$;

-- P1-08 owner decision: kai.intake_source_candidates.candidate_status is widened
-- from its P1-07 single-value pin ('needs_gk_review' only) to also accept
-- 'promoted' and 'rejected', following the accepted P1-07 precedent of widening an
-- earlier package's CHECK-pinned vocabulary through a later package's forward
-- migration (P1-07 did this to the shared kai.upload_lifecycle_audit
-- operation/metadata CHECKs) rather than editing the accepted P1-07 migration
-- file. No other value is added. 'rejected' is a P1-08 CORRECTION addition: the
-- original single-outcome model only widened to 'promoted'; the corrected
-- three-outcome model also needs a terminal candidate_status for a rejected
-- decision. kai.review_queue_items.queue_status already includes both
-- 'resolved' and 'waiting_on_client' in the accepted P1-06 vocabulary (the P1-06
-- migration created the table with the full canonical, already-shared
-- queue_status list), and review_queue_items.required_action already exists as a
-- nullable P1-06 column, so this package widens no review_queue_items CHECK
-- constraint and adds no review_queue_items column.
ALTER TABLE kai.intake_source_candidates
  DROP CONSTRAINT IF EXISTS intake_source_candidates_p1_07_candidate_status_check,
  ADD CONSTRAINT intake_source_candidates_p1_07_candidate_status_check
    CHECK (candidate_status IN ('needs_gk_review', 'promoted', 'rejected'));

-- P1-08 owner decision: two new unique constraints on kai.intake_source_candidates,
-- added here for the same reason P1-07 added
-- intake_sensitivity_profiles_p1_07_candidate_lineage_unique to kai.intake_sensitivity_profiles
-- from its own forward migration - a composite foreign key from a P1-08 table
-- tying its columns to the SAME candidate row's tenant/lineage tuple requires a
-- unique constraint on that exact column set, and intake_source_candidate_id alone
-- (the table's primary key) is not a matching set for either FK below. Both are
-- trivially unique because intake_source_candidate_id is already the primary key.
DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'intake_source_candidates' AND pc.conname = 'intake_source_candidates_p1_08_identity_unique'
  ) THEN
    ALTER TABLE kai.intake_source_candidates
    ADD CONSTRAINT intake_source_candidates_p1_08_identity_unique
      UNIQUE (intake_source_candidate_id, organization_id);
  END IF;
END $idem$;

DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'intake_source_candidates' AND pc.conname = 'intake_source_candidates_p1_08_promotion_lineage_unique'
  ) THEN
    ALTER TABLE kai.intake_source_candidates
    ADD CONSTRAINT intake_source_candidates_p1_08_promotion_lineage_unique
      UNIQUE (intake_source_candidate_id, organization_id, intake_sensitivity_profile_id, profile_canonical_sha256);
  END IF;
END $idem$;

-- Same reasoning applied to kai.review_queue_items: review_queue_item_id is already
-- the primary key, so this additional two-column unique constraint is trivially
-- unique and exists only to be the exact matching target of the composite foreign
-- key added below on kai.intake_promotion_decisions. Added through this forward
-- migration only; the accepted P1-06 migration file is not edited.
DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'review_queue_items' AND pc.conname = 'review_queue_items_p1_08_identity_unique'
  ) THEN
    ALTER TABLE kai.review_queue_items
    ADD CONSTRAINT review_queue_items_p1_08_identity_unique
      UNIQUE (review_queue_item_id, organization_id);
  END IF;
END $idem$;

-- P1-08 foundation table: one human-authorized promotion decision per P1-07 source
-- candidate. reviewed_source_type is the explicit, human-established
-- classification this decision itself establishes - never inferred from a
-- filename, MIME type, field name, sample value, AI output, or external lookup -
-- and is pinned to a fixed, non-'unknown' vocabulary because no currently
-- authorized upstream producer contract emits an explicit source-type
-- classification (the same absence P1-07 found and disclosed for its own
-- proposed_source_type).
--
-- P1-08 CORRECTION: decision_status is now one of three owner-authorized
-- outcomes - 'needs_more_information', 'rejected', 'promoted' - reachable via
-- exactly the transitions null -> any of the three, and needs_more_information ->
-- rejected/promoted. There is no longer a transient 'decided' value: a decision
-- is recorded directly at whichever of the three outcomes was requested.
-- reviewed_source_type/source_id/source_version_id/promoted_at are therefore
-- nullable, and bound (all four non-null) only when decision_status = 'promoted';
-- they stay null for 'needs_more_information' and 'rejected'.
CREATE TABLE IF NOT EXISTS kai.intake_promotion_decisions (
  intake_promotion_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_source_candidate_id uuid NOT NULL,
  review_queue_item_id uuid NOT NULL,

  reviewed_source_type text,
  decision_status text NOT NULL,

  source_id uuid,
  source_version_id uuid,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,

  CONSTRAINT intake_promotion_decisions_p1_08_identity_unique
    UNIQUE (organization_id, intake_source_candidate_id),
  CONSTRAINT intake_promotion_decisions_p1_08_candidate_fk
    FOREIGN KEY (intake_source_candidate_id, organization_id)
    REFERENCES kai.intake_source_candidates (intake_source_candidate_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_promotion_decisions_p1_08_review_queue_item_fk
    FOREIGN KEY (review_queue_item_id, organization_id)
    REFERENCES kai.review_queue_items (review_queue_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_promotion_decisions_p1_08_reviewed_source_type_check
    CHECK (reviewed_source_type IS NULL OR reviewed_source_type IN (
      'organization_primary_record',
      'organization_secondary_record',
      'third_party_provided_record',
      'public_record'
    )),
  CONSTRAINT intake_promotion_decisions_p1_08_decision_status_check
    CHECK (decision_status IN ('needs_more_information', 'rejected', 'promoted')),
  CONSTRAINT intake_promotion_decisions_p1_08_promoted_binding_check
    CHECK (
      (decision_status IN ('needs_more_information', 'rejected')
        AND reviewed_source_type IS NULL AND source_id IS NULL AND source_version_id IS NULL AND promoted_at IS NULL)
      OR
      (decision_status = 'promoted'
        AND reviewed_source_type IS NOT NULL AND source_id IS NOT NULL AND source_version_id IS NOT NULL AND promoted_at IS NOT NULL)
    ),
  CONSTRAINT intake_promotion_decisions_p1_08_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_intake_promotion_decisions_p1_08_tenant_candidate
  ON kai.intake_promotion_decisions (organization_id, intake_source_candidate_id);

-- P1-08 foundation table: one deterministic source identity per organization,
-- keyed by source_code - a sha256 hex digest computed only from immutable,
-- already-committed lineage facts (organization_id, intake_sensitivity_profile_id,
-- profile_canonical_sha256, reviewed_source_type). Never derived from a filename,
-- MIME type, sample value, AI output, or external lookup.
CREATE TABLE IF NOT EXISTS kai.sources (
  source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_code text NOT NULL,
  reviewed_source_type text NOT NULL,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sources_p1_08_identity_unique
    UNIQUE (organization_id, source_code),
  CONSTRAINT sources_p1_08_id_org_unique
    UNIQUE (source_id, organization_id),
  CONSTRAINT sources_p1_08_source_code_check
    CHECK (source_code ~ '^[a-f0-9]{64}$'),
  CONSTRAINT sources_p1_08_reviewed_source_type_check
    CHECK (reviewed_source_type IN (
      'organization_primary_record',
      'organization_secondary_record',
      'third_party_provided_record',
      'public_record'
    )),
  CONSTRAINT sources_p1_08_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

-- P1-08 foundation table: one source_version per promoted P1-07 candidate
-- (organization_id + intake_source_candidate_id is this package's idempotency
-- identity), with a tenant-safe composite lineage foreign key back to the exact
-- committed candidate row it was promoted from, and at most one current version
-- per source (partial unique index below). This package promotes exactly one
-- candidate into exactly one source_version; it does not implement merging
-- multiple candidates into one source's version history.
CREATE TABLE IF NOT EXISTS kai.source_versions (
  source_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  intake_source_candidate_id uuid NOT NULL,
  intake_sensitivity_profile_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_versions_p1_08_candidate_identity_unique
    UNIQUE (organization_id, intake_source_candidate_id),
  CONSTRAINT source_versions_p1_08_id_org_unique
    UNIQUE (source_version_id, organization_id),
  CONSTRAINT source_versions_p1_08_source_fk
    FOREIGN KEY (source_id, organization_id)
    REFERENCES kai.sources (source_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_versions_p1_08_candidate_lineage_fk
    FOREIGN KEY (intake_source_candidate_id, organization_id, intake_sensitivity_profile_id, profile_canonical_sha256)
    REFERENCES kai.intake_source_candidates (intake_source_candidate_id, organization_id, intake_sensitivity_profile_id, profile_canonical_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT source_versions_p1_08_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_source_versions_p1_08_current_per_source
  ON kai.source_versions (source_id)
  WHERE is_current = true;

DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'intake_promotion_decisions' AND pc.conname = 'intake_promotion_decisions_p1_08_source_fk'
  ) THEN
    ALTER TABLE kai.intake_promotion_decisions
    ADD CONSTRAINT intake_promotion_decisions_p1_08_source_fk
      FOREIGN KEY (source_id, organization_id)
      REFERENCES kai.sources (source_id, organization_id)
      ON DELETE RESTRICT;
  END IF;
END $idem$;

DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'intake_promotion_decisions' AND pc.conname = 'intake_promotion_decisions_p1_08_source_version_fk'
  ) THEN
    ALTER TABLE kai.intake_promotion_decisions
    ADD CONSTRAINT intake_promotion_decisions_p1_08_source_version_fk
      FOREIGN KEY (source_version_id, organization_id)
      REFERENCES kai.source_versions (source_version_id, organization_id)
      ON DELETE RESTRICT;
  END IF;
END $idem$;

-- =====================================================================
-- Canonical DDL extracted from migrations/kai_sprint2_p2_01_evidence_lineage.sql
-- (P2-01 evidence lineage). Installs empty canonical P2-01 objects after the
-- preserved legacy tables have been relocated out of kai. This is schema only:
-- no legacy locator or evidence row is translated or copied.
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('kai.source_versions') IS NULL THEN
    RAISE EXCEPTION 'kai.source_versions is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-01 evidence-lineage migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'source_versions'
       AND c.conname = 'source_versions_p1_08_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.source_versions_p1_08_id_org_unique is required before P2-01 evidence-lineage migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.source_locators (
  source_locator_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  locator_type text NOT NULL,
  coordinates jsonb NOT NULL,
  locator_fingerprint text NOT NULL,

  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_locators_p2_01_identity_unique
    UNIQUE (organization_id, source_version_id, locator_fingerprint),
  CONSTRAINT source_locators_p2_01_id_org_unique
    UNIQUE (source_locator_id, organization_id),
  CONSTRAINT source_locators_p2_01_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_locators_p2_01_locator_type_check
    CHECK (locator_type = 'column'),
  CONSTRAINT source_locators_p2_01_coordinates_check
    CHECK (
      jsonb_typeof(coordinates) = 'object'
      AND coordinates ? 'column_name'
      AND coordinates - ARRAY['column_name'] = '{}'::jsonb
      AND jsonb_typeof(coordinates->'column_name') = 'string'
    ),
  CONSTRAINT source_locators_p2_01_fingerprint_check
    CHECK (locator_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_locators_p2_01_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_source_locators_p2_01_tenant_version
  ON kai.source_locators (organization_id, source_version_id);

DO $idem$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace nn ON nn.oid = r.relnamespace
     WHERE nn.nspname = 'kai' AND r.relname = 'source_versions' AND pc.conname = 'source_versions_p2_01_id_source_org_unique'
  ) THEN
    ALTER TABLE kai.source_versions
      ADD CONSTRAINT source_versions_p2_01_id_source_org_unique
      UNIQUE (source_version_id, source_id, organization_id);
  END IF;
END $idem$;

CREATE TABLE IF NOT EXISTS kai.evidence_items (
  evidence_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_locator_id uuid NOT NULL,
  evidence_type text NOT NULL,
  data_class text NOT NULL,
  sensitivity_level text NOT NULL,
  support_strength text NOT NULL,
  statement text NOT NULL,
  statement_fingerprint text NOT NULL,

  evidence_review_status text NOT NULL DEFAULT 'needs_gk_review',
  internal_only boolean NOT NULL DEFAULT true,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  llm_processing_allowed boolean NOT NULL DEFAULT false,
  product_learning_allowed boolean NOT NULL DEFAULT false,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidence_items_p2_01_identity_unique
    UNIQUE (organization_id, source_version_id, statement_fingerprint),
  CONSTRAINT evidence_items_p2_01_id_org_unique
    UNIQUE (evidence_item_id, organization_id),
  CONSTRAINT evidence_items_p2_01_source_version_fk
    FOREIGN KEY (source_version_id, source_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, source_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_items_p2_01_source_locator_fk
    FOREIGN KEY (source_locator_id, organization_id)
    REFERENCES kai.source_locators (source_locator_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type = 'dictionary_field_presence_fact'),
  CONSTRAINT evidence_items_p2_01_data_class_check
    CHECK (data_class = 'organization_committed_metadata'),
  CONSTRAINT evidence_items_p2_01_sensitivity_level_check
    CHECK (sensitivity_level = 'unknown'),
  CONSTRAINT evidence_items_p2_01_support_strength_check
    CHECK (support_strength = 'unassessed'),
  CONSTRAINT evidence_items_p2_01_statement_check
    CHECK (
      length(statement) BETWEEN 1 AND 500
      AND statement !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    ),
  CONSTRAINT evidence_items_p2_01_statement_fingerprint_check
    CHECK (statement_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_items_p2_01_review_status_check
    CHECK (evidence_review_status = 'needs_gk_review'),
  CONSTRAINT evidence_items_p2_01_internal_only_check
    CHECK (internal_only = true),
  CONSTRAINT evidence_items_p2_01_public_use_check
    CHECK (public_use_allowed = false),
  CONSTRAINT evidence_items_p2_01_funder_use_check
    CHECK (funder_use_allowed = false),
  CONSTRAINT evidence_items_p2_01_llm_processing_check
    CHECK (llm_processing_allowed = false),
  CONSTRAINT evidence_items_p2_01_product_learning_check
    CHECK (product_learning_allowed = false),
  CONSTRAINT evidence_items_p2_01_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_evidence_items_p2_01_tenant_version
  ON kai.evidence_items (organization_id, source_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p2_01_evidence_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'evidence_review';

-- --------------------------------------------------------------------------
-- 6. Legacy review-queue target treatment.
--
--    kai.review_queue_items stays shared and stays live. Some of its rows target
--    objects this bundle just relocated (source_candidate_review ->
--    intake_source_candidate, sensitivity_review ->
--    intake_sensitivity_profile, data_dictionary_review -> data_dictionary,
--    evidence_review -> evidence_item, and the file-profile / field / finding /
--    source / source_version target types). target_object_id carries no foreign
--    key - capture 1 proves review_queue_items has no FK on it, and the P1-06
--    migration explains why one cannot exist for a polymorphic target column -
--    so after the relocation those rows would still be returned by
--    listReviewCockpitQueueItems (Backend/kai/db/kaiReviewCockpitReadModels.js,
--    which selects queue rows by organization/queue_type/queue_status and never
--    joins the target table) and would be presented to a GK reviewer as
--    canonical work whose target no longer resolves.
--
--    Chosen treatment, established from those facts rather than preselected:
--    mark, do not move, do not resolve, do not retarget, do not delete. Each
--    affected row keeps its own identity, queue_type, target_object_type,
--    target_object_id, queue_status, review_status, summary, required_action,
--    assignment and timestamps exactly as they are, and additively gains a
--    queue_metadata key recording that its target was preserved into the legacy
--    schema. Nothing is approved, rejected, resolved or cancelled - this bundle
--    has no authority to decide any of those, and inventing one would be
--    fabricating a human decision.
--
--    Rows are selected by proving the target actually exists in the preserved
--    legacy table, so a row whose target was never a legacy-generation object is
--    left completely untouched. The marker is idempotent: a converged rerun
--    matches nothing.
--
--    Disclosed side effect: the canonical P1-06 updated_at trigger installed in
--    section 4 bumps updated_at on each marked row. That is server-maintained
--    bookkeeping on rows this bundle did in fact modify, not a change to any
--    business or review fact.
--
--    The reader-side half of this treatment is the corresponding narrow filter
--    in listReviewCockpitQueueItems, which excludes marked rows from canonical
--    cockpit work. That is a narrowing of the canonical read model to canonical
--    work only - it does not teach any canonical reader to tolerate a legacy
--    shape.
-- --------------------------------------------------------------------------
DO $cutover_queue$
DECLARE
  mapping        record;
  affected       integer;
  total_affected integer := 0;
BEGIN
  FOR mapping IN
    SELECT * FROM (VALUES
      ('intake_source_candidate',    'intake_source_candidates',    'intake_source_candidate_id'),
      ('intake_sensitivity_profile', 'intake_sensitivity_profiles', 'intake_sensitivity_profile_id'),
      ('data_dictionary',            'data_dictionaries',           'data_dictionary_id'),
      ('data_dictionary_field',      'data_dictionary_fields',      'data_dictionary_field_id'),
      ('data_quality_finding',       'data_quality_findings',       'data_quality_finding_id'),
      ('intake_file_profile',        'intake_file_profiles',        'intake_file_profile_id'),
      ('source',                     'sources',                     'source_id'),
      ('source_version',             'source_versions',             'source_version_id'),
      ('evidence_item',              'evidence_items',              'evidence_item_id')
    ) AS m(target_object_type, legacy_table, legacy_key)
  LOOP
    CONTINUE WHEN to_regclass('kai_legacy_20260817.' || mapping.legacy_table) IS NULL;

    EXECUTE format($fmt$
      UPDATE kai.review_queue_items q
         SET queue_metadata = q.queue_metadata || jsonb_build_object(
               'kai_legacy_generation_target',
               jsonb_build_object(
                 'cutover', '20260817',
                 'preserved_schema', 'kai_legacy_20260817',
                 'preserved_table', %L,
                 'target_object_type', q.target_object_type
               ))
       WHERE q.target_object_type = %L
         AND NOT (q.queue_metadata ? 'kai_legacy_generation_target')
         AND EXISTS (
           SELECT 1 FROM kai_legacy_20260817.%I legacy
            WHERE legacy.%I = q.target_object_id
         )
    $fmt$, mapping.legacy_table, mapping.target_object_type, mapping.legacy_table, mapping.legacy_key);

    GET DIAGNOSTICS affected = ROW_COUNT;
    total_affected := total_affected + affected;
    IF affected > 0 THEN
      RAISE NOTICE 'kai legacy-generation cutover: marked % review_queue_items row(s) whose % target was preserved into kai_legacy_20260817',
        affected, mapping.target_object_type;
    END IF;
  END LOOP;

  RAISE NOTICE 'kai legacy-generation cutover: % review_queue_items row(s) marked in total; none moved, resolved, retargeted or deleted.', total_affected;
END $cutover_queue$;

-- --------------------------------------------------------------------------
-- 7. Transaction-local structural assertions. Every one of these runs BEFORE
--    COMMIT, so any failure rolls the complete cutover back and leaves the
--    database exactly as it was found.
-- --------------------------------------------------------------------------
DO $cutover_assert$
DECLARE
  sig      record;
  detail   text;
  offender text;
BEGIN
  -- 7a. Every relocated legacy table is present at its preserved location, and
  --     absent from kai unless a canonical replacement now owns that name.
  FOR sig IN SELECT * FROM kai_cutover_signature ORDER BY table_name LOOP
    IF to_regclass('kai_legacy_20260817.' || sig.table_name) IS NULL THEN
      RAISE EXCEPTION 'assertion failed: kai_legacy_20260817.% is missing after relocation', sig.table_name;
    END IF;
  END LOOP;

  -- 7b. Every legacy table kept its own primary key, unique/check constraints,
  --     indexes and outgoing foreign-key edges under the preserved schema. If
  --     SET SCHEMA had dropped or revalidated anything, this fails.
  FOR sig IN SELECT * FROM kai_cutover_signature ORDER BY table_name LOOP
    SELECT string_agg(required_conname, ', ' ORDER BY required_conname) INTO detail
      FROM unnest(sig.legacy_constraints) AS required_conname
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_constraint pc
         JOIN pg_class r ON r.oid = pc.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'kai_legacy_20260817' AND r.relname = sig.table_name AND pc.conname = required_conname
     );
    IF detail IS NOT NULL THEN
      RAISE EXCEPTION 'assertion failed: relocated kai_legacy_20260817.% lost constraint(s): %', sig.table_name, detail;
    END IF;

    SELECT string_agg(ixname, ', ' ORDER BY ixname) INTO detail
      FROM unnest(sig.legacy_indexes) AS ixname
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_indexes
        WHERE schemaname = 'kai_legacy_20260817' AND tablename = sig.table_name AND indexname = ixname
     );
    IF detail IS NOT NULL THEN
      RAISE EXCEPTION 'assertion failed: relocated kai_legacy_20260817.% lost index(es): %', sig.table_name, detail;
    END IF;

    SELECT string_agg(edge, ', ' ORDER BY edge) INTO detail
      FROM unnest(sig.legacy_fk_edges) AS edge
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_constraint pc
         JOIN pg_class r ON r.oid = pc.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'kai_legacy_20260817' AND r.relname = sig.table_name
          AND pc.contype = 'f' AND pc.conname = split_part(edge, '->', 1)
     );
    IF detail IS NOT NULL THEN
      RAISE EXCEPTION 'assertion failed: relocated kai_legacy_20260817.% lost foreign key(s): %', sig.table_name, detail;
    END IF;
  END LOOP;

  -- 7c. The intended legacy-to-shared edges still point at the shared tables,
  --     which were never moved.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint pc
      JOIN pg_class r ON r.oid = pc.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      JOIN pg_class fr ON fr.oid = pc.confrelid
      JOIN pg_namespace fn ON fn.oid = fr.relnamespace
     WHERE n.nspname = 'kai_legacy_20260817' AND r.relname = 'intake_source_candidates'
       AND pc.conname = 'intake_source_candidates_intake_file_id_fkey'
       AND fn.nspname = 'kai' AND fr.relname = 'intake_files'
  ) THEN
    RAISE EXCEPTION 'assertion failed: the preserved legacy candidate table no longer references the shared kai.intake_files';
  END IF;

  -- 7d. Every retained dependent foreign key now references the preserved
  --     object, and none of them was silently repointed at a canonical table.
  FOR sig IN
    SELECT dn.nspname || '.' || dr.relname AS dependent, pc.conname,
           fn.nspname AS referenced_schema, fr.relname AS referenced_table
      FROM pg_constraint pc
      JOIN pg_class dr ON dr.oid = pc.conrelid
      JOIN pg_namespace dn ON dn.oid = dr.relnamespace
      JOIN pg_class fr ON fr.oid = pc.confrelid
      JOIN pg_namespace fn ON fn.oid = fr.relnamespace
     WHERE pc.contype = 'f'
       AND dn.nspname = 'kai'
       AND fr.relname IN (SELECT table_name FROM kai_cutover_signature)
       AND dr.relname NOT IN (SELECT table_name FROM kai_cutover_signature)
  LOOP
    IF sig.referenced_schema <> 'kai_legacy_20260817' THEN
      RAISE EXCEPTION 'assertion failed: retained dependent % foreign key % references %.% instead of the preserved legacy object',
        sig.dependent, sig.conname, sig.referenced_schema, sig.referenced_table;
    END IF;
  END LOOP;

  -- 7e. Required canonical P1 objects exist at the kai.* names, with the exact
  --     canonical signatures the current repository contract needs.
  FOR sig IN SELECT * FROM kai_cutover_signature ORDER BY table_name LOOP
    IF to_regclass('kai.' || sig.table_name) IS NULL THEN
      RAISE EXCEPTION 'assertion failed: canonical kai.% was not installed', sig.table_name;
    END IF;
    SELECT string_agg(spec, ', ' ORDER BY spec) INTO detail
      FROM unnest(sig.canonical_columns) AS spec
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'kai' AND c.table_name = sig.table_name
          AND c.column_name = split_part(spec, ':', 1)
          AND c.data_type = split_part(spec, ':', 2)
     );
    IF detail IS NOT NULL THEN
      RAISE EXCEPTION 'assertion failed: canonical kai.% is missing column(s): %', sig.table_name, detail;
    END IF;
    SELECT string_agg(required_conname, ', ' ORDER BY required_conname) INTO detail
      FROM unnest(sig.canonical_constraints) AS required_conname
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_constraint pc
         JOIN pg_class r ON r.oid = pc.conrelid
         JOIN pg_namespace n ON n.oid = r.relnamespace
        WHERE n.nspname = 'kai' AND r.relname = sig.table_name AND pc.conname = required_conname
     );
    IF detail IS NOT NULL THEN
      RAISE EXCEPTION 'assertion failed: canonical kai.% is missing constraint(s): %', sig.table_name, detail;
    END IF;
  END LOOP;

  -- 7f. The P2-01 objects are canonical schema-only installs. The legacy rows
  --     remain preserved under kai_legacy_20260817 and are not translated into
  --     the empty canonical tables by this cutover.
  IF EXISTS (SELECT 1 FROM kai.source_locators) OR EXISTS (SELECT 1 FROM kai.evidence_items) THEN
    RAISE EXCEPTION 'assertion failed: canonical kai.source_locators/kai.evidence_items must be empty immediately after cutover; P2 rows must be produced later by P2-01, not translated';
  END IF;

  -- 7g. No legacy row was translated, copied or relabelled into the canonical
  --     generation: no identity present in a preserved legacy table may also
  --     appear in its canonical namesake. This holds both on the first run
  --     (canonical tables are empty) and on a converged rerun (canonical rows
  --     produced later by the real producer chain carry their own new
  --     identities), so it is asserted unconditionally rather than as an
  --     emptiness check.
  IF EXISTS (
    SELECT 1 FROM kai.intake_source_candidates c
      JOIN kai_legacy_20260817.intake_source_candidates l
        ON l.intake_source_candidate_id = c.intake_source_candidate_id
  ) THEN
    RAISE EXCEPTION 'assertion failed: a preserved legacy candidate identity also exists in the canonical kai.intake_source_candidates; a legacy row was translated or relabelled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.sources c JOIN kai_legacy_20260817.sources l ON l.source_id = c.source_id
  ) THEN
    RAISE EXCEPTION 'assertion failed: a preserved legacy source identity also exists in the canonical kai.sources; a legacy row was translated or relabelled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.source_versions c
      JOIN kai_legacy_20260817.source_versions l ON l.source_version_id = c.source_version_id
  ) THEN
    RAISE EXCEPTION 'assertion failed: a preserved legacy source-version identity also exists in the canonical kai.source_versions; a legacy row was translated or relabelled';
  END IF;

  -- 7h. Shared contracts are intact and were not narrowed.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'intake_files'
       AND c.conname = 'intake_files_gate_a_upload_state_check'
  ) THEN
    RAISE EXCEPTION 'assertion failed: shared kai.intake_files lost its Gate A upload-state contract';
  END IF;
  IF to_regclass('kai.intake_files') IS NULL OR to_regclass('kai.upload_lifecycle_audit') IS NULL
     OR to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'assertion failed: a shared table is missing after the cutover';
  END IF;
  FOREACH offender IN ARRAY ARRAY[
    'intake_file_review', 'source_candidate_review', 'sensitivity_review',
    'data_dictionary_review', 'evidence_review', 'claim_review', 'client_followup',
    'conflict_resolution', 'generated_content_review', 'export_review'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) LIKE '%' || offender || '%'
    ) THEN
      RAISE EXCEPTION 'assertion failed: shared kai.review_queue_items queue_type vocabulary no longer permits %', offender;
    END IF;
  END LOOP;
  FOREACH offender IN ARRAY ARRAY[
    'parser_run_recorded',
    'file_profile_persisted',
    'data_dictionary_draft_persisted',
    'intake_sensitivity_profile_persisted',
    'sensitivity_review_queue_item_created',
    'intake_source_candidate_persisted',
    'source_promotion_decision_persisted'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'upload_lifecycle_audit' AND c.contype = 'c'
         AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
         AND pg_get_constraintdef(c.oid) LIKE '%' || offender || '%'
    ) THEN
      RAISE EXCEPTION 'assertion failed: shared kai.upload_lifecycle_audit operation vocabulary no longer permits %', offender;
    END IF;
  END LOOP;
  FOREACH offender IN ARRAY ARRAY[
    'mandatory', 'immediate_fix', 'high', 'medium', 'low', 'backlog',
    'not_applicable', 'unknown', 'normal'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
       WHERE c.table_schema = 'kai' AND c.table_name = 'review_queue_items'
         AND c.column_name = 'priority' AND c.data_type = 'text'
         AND c.column_default = '''medium''::text'
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
         AND c.conname = 'review_queue_items_cutover_priority_compat_check'
         AND pg_get_constraintdef(c.oid) LIKE '%' || quote_literal(offender) || '%'
    ) THEN
      RAISE EXCEPTION 'assertion failed: shared kai.review_queue_items.priority does not permit % after compatibility conversion', offender;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_class r ON r.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname IN (SELECT table_name FROM kai_cutover_signature)
       AND NOT tg.tgisinternal
  ) THEN
    RAISE EXCEPTION 'assertion failed: a canonical replacement table inherited or gained a legacy relocation trigger';
  END IF;

  -- 7i. No queue row whose target was preserved into the legacy schema can be
  --     read as canonical work: every one carries the marker, and no marked row
  --     had its status, target or identity changed into something else.
  IF EXISTS (
    SELECT 1 FROM kai.review_queue_items q
      JOIN kai_legacy_20260817.intake_source_candidates l
        ON l.intake_source_candidate_id = q.target_object_id
     WHERE q.target_object_type = 'intake_source_candidate'
       AND NOT (q.queue_metadata ? 'kai_legacy_generation_target')
  ) THEN
    RAISE EXCEPTION 'assertion failed: a review_queue_items row still targets a preserved legacy source candidate without the legacy-generation marker';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.review_queue_items q
     WHERE q.queue_metadata ? 'kai_legacy_generation_target'
       AND q.queue_metadata #>> ARRAY['kai_legacy_generation_target', 'preserved_schema'] <> 'kai_legacy_20260817'
  ) THEN
    RAISE EXCEPTION 'assertion failed: a legacy-generation queue marker does not record the preserved schema';
  END IF;

  RAISE NOTICE 'kai legacy-generation cutover: all transaction-local structural assertions passed.';
END $cutover_assert$;

COMMIT;
