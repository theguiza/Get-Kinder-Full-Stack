-- Run this entire SELECT in pgAdmin's Query Tool against the KAI database.
-- Catalog reads only: no application rows, writes, temporary objects or DDL.
-- OVERALL = PASS means the schema prerequisites checked below are present.
-- FAIL identifies a missing/incompatible prerequisite and its migration.
-- This is not an exhaustive schema comparison or proof of deployed app behavior.
-- The reporting-barrier fix a72413e6 added NO migration or approval requirement.
-- No migration-history ledger is defined in this repository: check actual state.
-- Document CHECK fingerprints reuse the existing PostgreSQL 16 packet pins;
-- on another PostgreSQL major, inspect a definition difference before treating
-- it as an unapplied migration. Never blindly replay the migration chain.
WITH required_tables(table_name, required_columns, migration) AS (
  VALUES
    ('organizations', 'organization_id', 'existing organization foundation'),
    ('users', 'user_id', 'existing user foundation'),
    ('organization_memberships', 'organization_id,user_id', 'existing membership foundation'),
    ('engagements', 'engagement_id,organization_id', 'existing engagement foundation'),
    ('intake_files', 'intake_file_id,organization_id', 'existing intake foundation / Gate A'),
    ('upload_lifecycle_audit', 'organization_id,operation', 'kai_sprint2_gate_a_p0_upload_lifecycle.sql'),
    ('upload_policy_decision_replay', 'organization_id', 'kai_sprint2_gate_a_p0_policy_decision_replay.sql'),
    ('intake_parser_runs', 'organization_id,parser_run_id', 'kai_sprint2_p1_parser_run_and_file_profile.sql'),
    ('intake_file_profiles', 'file_profile_id,organization_id', 'kai_sprint2_p1_parser_run_and_file_profile.sql'),
    ('data_dictionaries', 'organization_id', 'kai_sprint2_p1_04_data_dictionary_and_quality.sql'),
    ('data_dictionary_fields', 'organization_id', 'kai_sprint2_p1_04_data_dictionary_and_quality.sql'),
    ('data_quality_findings', 'organization_id', 'kai_sprint2_p1_04_data_dictionary_and_quality.sql'),
    ('intake_sensitivity_profiles', 'organization_id', 'kai_sprint2_p1_05_intake_sensitivity_profile.sql'),
    ('intake_sensitivity_review_decisions', 'organization_id', 'kai_sprint2_b1a_02_phase5_allowed_use_decision_ledger.sql'),
    ('intake_source_candidates', 'organization_id', 'kai_sprint2_p1_07_intake_source_candidate.sql'),
    ('intake_promotion_decisions', 'organization_id', 'kai_sprint2_p1_08_source_promotion.sql'),
    ('sources', 'source_id,organization_id', 'kai_sprint2_p1_08_source_promotion.sql'),
    ('source_versions', 'source_version_id,organization_id,is_current', 'kai_sprint2_p1_08_source_promotion.sql'),
    ('source_locators', 'source_locator_id,organization_id,locator_type,coordinates', 'kai_sprint2_p2_01_evidence_lineage.sql'),
    ('evidence_items', 'evidence_item_id,organization_id,evidence_type,data_class,statement,evidence_review_status,support_strength', 'kai_sprint2_p2_01_evidence_lineage.sql'),
    ('claims', 'claim_id,organization_id,evidence_item_id,statement,claim_review_status,claim_strength', 'kai_sprint2_p2_03_claim_proposal.sql'),
    ('claim_evidence_links', 'claim_id,evidence_item_id,organization_id', 'kai_sprint2_p2_03_claim_proposal.sql'),
    ('gap_log_items', 'organization_id,claim_id,dimension_key,assessment_status', 'kai_sprint2_p2_04_claim_gap_followup.sql'),
    ('client_followup_items', 'organization_id,claim_id', 'kai_sprint2_p2_04_claim_gap_followup.sql'),
    ('conflict_groups', 'organization_id', 'kai_sprint2_p2_05_conflict_review_candidate.sql'),
    ('review_queue_items', 'organization_id,queue_type,target_object_id,queue_status,review_status', 'kai_sprint2_p1_06_review_queue.sql'),
    ('coverage_review_decisions', 'organization_id', 'kai_sprint2_p2_10_coverage_review_decision.sql'),
    ('evidence_review_decisions', 'organization_id,evidence_item_id', 'kai_sprint2_p2_12_human_review_decision_ledger.sql'),
    ('claim_review_decisions', 'organization_id,claim_id', 'kai_sprint2_p2_12_human_review_decision_ledger.sql'),
    ('generation_runs', 'generation_run_id,organization_id,engagement_id,idempotency_key,content_type,requested_audience', 'kai_sprint2_p3_01_generated_content_drafts.sql + kai_sprint2_p14_01_generation_run_engagement_binding.sql'),
    ('generated_content_drafts', 'generated_content_draft_id,generation_run_id,organization_id,content_type,requested_audience,validator_results', 'kai_sprint2_p3_01_generated_content_drafts.sql'),
    ('generated_content_blocks', 'generated_content_block_id,generated_content_draft_id,organization_id,ordinal,text', 'kai_sprint2_p3_01_generated_content_drafts.sql'),
    ('generated_content_citations', 'generated_content_block_id,organization_id,claim_id,evidence_item_id', 'kai_sprint2_p3_01_generated_content_drafts.sql'),
    ('intake_p1_downstream_attempts', 'organization_id', 'kai_sprint2_p1_downstream_recovery_state.sql'),
    ('source_measurement_definitions', 'source_measurement_definition_id,organization_id,source_version_id,worksheet_key', 'kai_sprint2_p2_01m_source_record_count_measurement.sql + kai_sprint2_p2_01m_worksheet_measurement_identity.sql'),
    ('evidence_measurements', 'evidence_item_id,organization_id,source_version_id,worksheet_key,calculation_method', 'kai_sprint2_p2_01m_source_record_count_measurement.sql + kai_sprint2_p2_01m_worksheet_measurement_identity.sql'),
    ('source_derived_measurements', 'source_derived_measurement_id,organization_id,source_version_id,worksheet_key,measurement_family,calculation_method,basis_version,measured_value,numerator,denominator,percentage,component_counts', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurement_interpretations', 'organization_id,source_derived_measurement_id', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('evidence_derived_measurements', 'organization_id,evidence_item_id,source_derived_measurement_id', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurement_sources', 'organization_id,source_derived_measurement_id,source_version_id,source_role', 'kai_sprint2_measurement_mvp_cross_source_reach.sql'),
    ('cross_source_reconciliation_jobs', 'reconciliation_job_id,organization_id,primary_source_version_id,reference_source_version_id,request_fingerprint,mapping,job_state,attempt_count,claim_token,claim_expires_at,next_eligible_at,measurement_ids', 'kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql')
), required_types(table_name, column_name, expected_type, migration) AS (
  VALUES
    ('source_locators', 'coordinates', 'jsonb', 'kai_sprint2_p2_01_evidence_lineage.sql'),
    ('generation_runs', 'engagement_id', 'uuid', 'kai_sprint2_p14_01_generation_run_engagement_binding.sql'),
    ('generated_content_blocks', 'text', 'text', 'kai_sprint2_p3_01_generated_content_drafts.sql'),
    ('generated_content_drafts', 'validator_results', 'jsonb', 'kai_sprint2_p3_01_generated_content_drafts.sql'),
    ('source_measurement_definitions', 'worksheet_key', 'text', 'kai_sprint2_p2_01m_worksheet_measurement_identity.sql'),
    ('evidence_measurements', 'worksheet_key', 'text', 'kai_sprint2_p2_01m_worksheet_measurement_identity.sql'),
    ('source_derived_measurements', 'measured_value', 'bigint', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurements', 'numerator', 'bigint', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurements', 'denominator', 'bigint', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurements', 'percentage', 'numeric(5,2)', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurements', 'component_counts', 'jsonb', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('cross_source_reconciliation_jobs', 'mapping', 'jsonb', 'kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql'),
    ('cross_source_reconciliation_jobs', 'measurement_ids', 'uuid[]', 'kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql')
), document_checks(table_name, constraint_name, expected_md5) AS (
  VALUES
    ('evidence_items', 'evidence_items_p2_01_evidence_type_check', 'aea45899884478a1fbdf6b870103d2f0'),
    ('evidence_items', 'evidence_items_p2_01_data_class_check', 'ddb26bb785cf6c4adf30a5e229e4f0f4'),
    ('evidence_items', 'evidence_items_p2_01m_type_class_pairing_check', 'fa3cc6ef6bfcc0f8218978fca9051299'),
    ('source_locators', 'source_locators_p2_01_locator_type_check', '20a79952e407a69bf7d7d46b6cc2bc45'),
    ('source_locators', 'source_locators_p2_01_coordinates_check', 'd5265a33039490287a63225d0c246401')
), measurement_checks(constraint_name, expected_md5) AS (
  -- Same descriptor fingerprints as the existing Cedar Bridge preflight.
  VALUES
    ('source_derived_measurements_method_family_check', 'fef8ba84fb253dd2a058488e3a6de7b8'),
    ('source_derived_measurements_arithmetic_check', '9c7d96417506956fe1956ec8fd15e71e')
), vocabulary_checks(table_name, constraint_name, required_terms, migration) AS (
  VALUES
    ('generation_runs', 'generation_runs_p3_01_content_type_check', 'evidence_summary,impact_narrative,readiness_assessment,data_gap_memo', 'kai_sprint2_p14_14_generated_content_type_evolution.sql'),
    ('generated_content_drafts', 'generated_content_drafts_p3_01_content_type_check', 'evidence_summary,impact_narrative,readiness_assessment,data_gap_memo', 'kai_sprint2_p14_14_generated_content_type_evolution.sql'),
    ('evidence_measurements', 'evidence_measurements_p2_01m_method_check', 'p1_csv_profile_data_records_excluding_blank_v1,p1_xlsx_single_worksheet_data_rows_excluding_blank_v1,p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1', 'kai_sprint2_p2_01m_xlsx_selected_worksheet_record_count_method.sql'),
    ('source_derived_measurements', 'source_derived_measurements_method_family_check', 'paired_outcome_change,tabular_count,tabular_rate,cross_source_reach', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql + kai_sprint2_measurement_mvp_cross_source_reach.sql'),
    ('cross_source_reconciliation_jobs', 'cross_source_reconciliation_jobs_state_check', 'queued,in_progress,retry_scheduled,succeeded,failed,exhausted', 'kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql')
), required_indexes(table_name, index_name, migration) AS (
  VALUES
    ('source_measurement_definitions', 'source_measurement_definitions_p2_01m_worksheet_identity_unique', 'kai_sprint2_p2_01m_worksheet_measurement_identity.sql'),
    ('evidence_measurements', 'evidence_measurements_p2_01m_worksheet_identity_unique', 'kai_sprint2_p2_01m_worksheet_measurement_identity.sql'),
    ('source_derived_measurements', 'source_derived_measurements_identity_unique', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurement_interpretations', 'source_derived_measurement_interpretations_history_unique', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('evidence_derived_measurements', 'evidence_derived_measurements_statement_unique', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('cross_source_reconciliation_jobs', 'cross_source_reconciliation_jobs_request_unique', 'kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql'),
    ('generation_runs', 'generation_runs_p3_01_identity_unique', 'kai_sprint2_p3_01_generated_content_drafts.sql')
), required_triggers(table_name, trigger_name, migration) AS (
  VALUES
    ('evidence_measurements', 'evidence_measurements_worksheet_identity_check', 'kai_sprint2_p2_01m_worksheet_measurement_identity.sql'),
    ('source_measurement_definitions', 'source_measurement_definitions_worksheet_identity_check', 'kai_sprint2_p2_01m_worksheet_measurement_identity.sql'),
    ('evidence_measurements', 'evidence_measurements_selected_worksheet_locator_check', 'kai_sprint2_p2_01m_xlsx_selected_worksheet_record_count_method.sql'),
    ('source_derived_measurements', 'trg_source_derived_measurements_append_only', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurement_interpretations', 'trg_source_derived_measurement_interpretations_append_only', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('evidence_derived_measurements', 'trg_evidence_derived_measurements_append_only', 'kai_sprint2_measurement_mvp_source_derived_measurements.sql'),
    ('source_derived_measurement_sources', 'trg_source_derived_measurement_sources_append_only', 'kai_sprint2_measurement_mvp_cross_source_reach.sql'),
    ('source_derived_measurement_sources', 'trg_source_derived_measurement_sources_admitted', 'kai_sprint2_measurement_mvp_cross_source_reach.sql')
), checks(check_id, status, detail, related_migration) AS (
  SELECT 'table.' || r.table_name,
         CASE WHEN c.relkind IN ('r', 'p') THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN c.relkind IN ('r', 'p') THEN 'Table exists' ELSE 'Missing table kai.' || r.table_name END,
         r.migration
    FROM required_tables r LEFT JOIN pg_catalog.pg_class c ON c.oid = to_regclass('kai.' || r.table_name)
  UNION ALL
  SELECT 'columns.' || r.table_name, CASE WHEN m.missing IS NULL THEN 'PASS' ELSE 'FAIL' END,
         coalesce('Missing columns: ' || m.missing, 'Listed columns exist'), r.migration
    FROM required_tables r CROSS JOIN LATERAL (
      SELECT string_agg(col, ', ' ORDER BY col) AS missing
        FROM unnest(string_to_array(r.required_columns, ',')) AS col
       WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = to_regclass('kai.' || r.table_name) AND a.attname = col AND a.attnum > 0 AND NOT a.attisdropped)
    ) m
  UNION ALL
  SELECT 'type.' || r.table_name || '.' || r.column_name,
         CASE WHEN pg_catalog.format_type(a.atttypid, a.atttypmod) = r.expected_type THEN 'PASS' ELSE 'FAIL' END,
         'Expected ' || r.expected_type || '; observed ' || coalesce(pg_catalog.format_type(a.atttypid, a.atttypmod), 'missing'), r.migration
    FROM required_types r LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid = to_regclass('kai.' || r.table_name) AND a.attname = r.column_name AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'document.' || r.constraint_name,
         CASE WHEN c.contype = 'c' AND c.convalidated AND NOT c.condeferrable
                    AND md5(pg_catalog.pg_get_constraintdef(c.oid)) = r.expected_md5 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN c.oid IS NULL THEN 'Missing CHECK'
              WHEN NOT c.convalidated THEN 'CHECK exists but is NOT VALID'
              ELSE pg_catalog.pg_get_constraintdef(c.oid) END,
         'kai_sprint2_document_statement_evidence.sql'
    FROM document_checks r LEFT JOIN pg_catalog.pg_constraint c
      ON c.conrelid = to_regclass('kai.' || r.table_name) AND c.conname = r.constraint_name
  UNION ALL
  SELECT 'measurement.' || r.constraint_name,
         CASE WHEN c.contype = 'c' AND md5(jsonb_build_array(pg_catalog.pg_get_constraintdef(c.oid), c.convalidated, c.condeferrable)::text) = r.expected_md5
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(pg_catalog.pg_get_constraintdef(c.oid), 'Missing CHECK'),
         'kai_sprint2_measurement_mvp_source_derived_measurements.sql + kai_sprint2_measurement_mvp_cross_source_reach.sql'
    FROM measurement_checks r LEFT JOIN pg_catalog.pg_constraint c
      ON c.conrelid = to_regclass('kai.source_derived_measurements') AND c.conname = r.constraint_name
  UNION ALL
  SELECT 'vocabulary.' || r.constraint_name,
         CASE WHEN c.contype = 'c' AND c.convalidated AND NOT EXISTS (
           SELECT 1 FROM unnest(string_to_array(r.required_terms, ',')) AS term
            WHERE position(quote_literal(term) IN pg_catalog.pg_get_constraintdef(c.oid)) = 0
         ) THEN 'PASS' ELSE 'FAIL' END,
         coalesce(pg_catalog.pg_get_constraintdef(c.oid), 'Missing CHECK'), r.migration
    FROM vocabulary_checks r LEFT JOIN pg_catalog.pg_constraint c
      ON c.conrelid = to_regclass('kai.' || r.table_name) AND c.conname = r.constraint_name
  UNION ALL
  SELECT 'index.' || r.index_name,
         CASE WHEN i.indisunique AND i.indisvalid AND i.indisready AND i.indislive THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN i.indexrelid IS NULL THEN 'Missing unique index'
              ELSE pg_catalog.pg_get_indexdef(i.indexrelid) END, r.migration
    FROM required_indexes r LEFT JOIN pg_catalog.pg_index i
      ON i.indexrelid = to_regclass('kai.' || r.index_name) AND i.indrelid = to_regclass('kai.' || r.table_name)
  UNION ALL
  SELECT 'trigger.' || r.trigger_name,
         CASE WHEN t.tgenabled IN ('O', 'A') AND NOT t.tgisinternal THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN t.oid IS NULL THEN 'Missing trigger'
              ELSE pg_catalog.pg_get_triggerdef(t.oid) || '; enabled=' || t.tgenabled::text END, r.migration
    FROM required_triggers r LEFT JOIN pg_catalog.pg_trigger t
      ON t.tgrelid = to_regclass('kai.' || r.table_name) AND t.tgname = r.trigger_name
)
SELECT check_id, status, detail, related_migration
  FROM (
    SELECT 'OVERALL' AS check_id, CASE WHEN bool_and(status = 'PASS') THEN 'PASS' ELSE 'FAIL' END AS status,
           count(*) FILTER (WHERE status = 'FAIL')::text || ' failed out of ' || count(*)::text || ' schema checks' AS detail,
           'Related migrations are diagnostic references, not instructions to rerun them' AS related_migration FROM checks
    UNION ALL
    SELECT * FROM checks
    UNION ALL
    SELECT 'INFO.connection', 'INFO', 'database=' || current_database() || '; PostgreSQL=' || current_setting('server_version'), ''
    UNION ALL
    SELECT 'INFO.scope', 'INFO', 'Catalog prerequisites only; no approval records required; app deployment and report generation need an application smoke test', ''
  ) result
 ORDER BY CASE WHEN check_id = 'OVERALL' THEN 0 WHEN status = 'FAIL' THEN 1 WHEN status = 'INFO' THEN 3 ELSE 2 END, check_id;
