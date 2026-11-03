-- KAI Measurement MVP: verification after
--   migrations/kai_sprint2_measurement_mvp_source_derived_measurements.sql
-- and, when applied, migrations/kai_sprint2_measurement_mvp_cross_source_reach.sql.
-- READ-ONLY. One SELECT statement; it changes nothing and inserts nothing.
-- Every CHECK is proven by evaluating the live CHECK expression against
-- literal values (query_to_xml), never by inserting rows, so a missing,
-- narrowed or weakened constraint fails. The record-count CHECKs are verified
-- separately by scripts/kai-sprint2-p2-01m-xlsx-worksheet-method-verify-read-only.sql.
-- Version-aware (D0): before the cross-source migration its family and
-- arithmetic branch must be refused and D7 is not applicable; after it they
-- must be admitted and its contributing-source table verified.
-- Last row OVERALL must be PASS. Run it in the pgAdmin Query Tool (F5).
WITH
schema_state AS (
  SELECT to_regclass('kai.source_derived_measurement_sources') IS NOT NULL AS cross_present
),
live AS (
  SELECT con.conname::text AS name,
         regexp_replace(btrim(regexp_replace(regexp_replace(pg_get_constraintdef(con.oid, true), '\m(kai|public)\.', '', 'g'), '\s+', ' ', 'g')), ' NOT VALID$', '') AS def
    FROM pg_constraint con
   WHERE con.contype = 'c'
     AND con.conrelid IN (to_regclass('kai.source_derived_measurements'), to_regclass('kai.source_derived_measurement_interpretations'),
                          to_regclass('kai.source_derived_measurement_sources'), to_regclass('kai.source_locators'))
),
-- Measurement rows: (constraint, vector, family, method, basis, worksheet, measured, numerator, denominator, percentage, counts, definition, expected_pre, expected_post)
measurement_vectors(name, vector, measurement_family, calculation_method, basis_version, worksheet_key, measured_value, numerator, denominator, percentage, component_counts, definition, expected_pre, expected_post) AS (
  VALUES
    ('source_derived_measurements_method_family_check', 'paired outcome on a worksheet', 'paired_outcome_change', 'p1_xlsx_paired_baseline_followup_numeric_change_v1', 'kai_xlsx_paired_outcome_basis_v1', 'sheet_1', '0', '0', NULL, NULL, '{}', '{}', true, true),
    ('source_derived_measurements_method_family_check', 'paired outcome without a worksheet', 'paired_outcome_change', 'p1_xlsx_paired_baseline_followup_numeric_change_v1', 'kai_xlsx_paired_outcome_basis_v1', NULL, '0', '0', NULL, NULL, '{}', '{}', false, false),
    ('source_derived_measurements_method_family_check', 'tabular record count', 'tabular_count', 'kai_tabular_conditional_record_count_v1', 'kai_tabular_measurement_basis_v1', NULL, '0', '0', NULL, NULL, '{}', '{}', true, true),
    ('source_derived_measurements_method_family_check', 'tabular distinct count', 'tabular_count', 'kai_tabular_conditional_distinct_key_count_v1', 'kai_tabular_measurement_basis_v1', NULL, '0', '0', NULL, NULL, '{}', '{}', true, true),
    ('source_derived_measurements_method_family_check', 'tabular rate', 'tabular_rate', 'kai_tabular_conditional_record_rate_v1', 'kai_tabular_measurement_basis_v1', NULL, '0', '0', NULL, NULL, '{}', '{}', true, true),
    ('source_derived_measurements_method_family_check', 'rate with a count method', 'tabular_rate', 'kai_tabular_conditional_record_count_v1', 'kai_tabular_measurement_basis_v1', NULL, '0', '0', NULL, NULL, '{}', '{}', false, false),
    ('source_derived_measurements_method_family_check', 'count with the paired basis', 'tabular_count', 'kai_tabular_conditional_record_count_v1', 'kai_xlsx_paired_outcome_basis_v1', NULL, '0', '0', NULL, NULL, '{}', '{}', false, false),
    ('source_derived_measurements_method_family_check', 'cross-source reach', 'cross_source_reach', 'kai_cross_source_linked_reach_v1', 'kai_cross_source_reconciliation_v1', NULL, '0', '0', NULL, NULL, '{}', '{}', false, true),
    ('source_derived_measurements_method_family_check', 'cross-source reach on a worksheet', 'cross_source_reach', 'kai_cross_source_linked_reach_v1', 'kai_cross_source_reconciliation_v1', 'sheet_1', '0', '0', NULL, NULL, '{}', '{}', false, false),
    ('source_derived_measurements_method_family_check', 'unknown family', 'tabular_sum', 'kai_tabular_conditional_record_count_v1', 'kai_tabular_measurement_basis_v1', NULL, '0', '0', NULL, NULL, '{}', '{}', false, false),
    ('source_derived_measurements_arithmetic_check', 'count within matching records', 'tabular_count', NULL, NULL, NULL, '5', '5', NULL, NULL, '{"matching_record_count": 5}', '{}', true, true),
    ('source_derived_measurements_arithmetic_check', 'count above matching records', 'tabular_count', NULL, NULL, NULL, '6', '6', NULL, NULL, '{"matching_record_count": 5}', '{}', false, false),
    ('source_derived_measurements_arithmetic_check', 'numerator differs from value', 'tabular_count', NULL, NULL, NULL, '5', '4', NULL, NULL, '{"matching_record_count": 5}', '{}', false, false),
    ('source_derived_measurements_arithmetic_check', 'count with a denominator', 'tabular_count', NULL, NULL, NULL, '5', '5', '9', NULL, '{"matching_record_count": 5}', '{}', false, false),
    ('source_derived_measurements_arithmetic_check', 'negative count', 'tabular_count', NULL, NULL, NULL, '-1', '-1', NULL, NULL, '{"matching_record_count": 5}', '{}', false, false),
    ('source_derived_measurements_arithmetic_check', 'rate rounded to two decimals', 'tabular_rate', NULL, NULL, NULL, '9', '9', '29', '31.03', '{}', '{}', true, true),
    ('source_derived_measurements_arithmetic_check', 'rate rounded wrongly', 'tabular_rate', NULL, NULL, NULL, '9', '9', '29', '31.00', '{}', '{}', false, false),
    ('source_derived_measurements_arithmetic_check', 'rate numerator above denominator', 'tabular_rate', NULL, NULL, NULL, '30', '30', '29', '103.45', '{}', '{}', false, false),
    ('source_derived_measurements_arithmetic_check', 'rate with zero denominator', 'tabular_rate', NULL, NULL, NULL, '0', '0', '0', NULL, '{}', '{}', false, false),
    ('source_derived_measurements_arithmetic_check', 'cross-source funnel', 'cross_source_reach', NULL, NULL, NULL, '80', '80', NULL, NULL,
      '{"physical_record_count": 246, "blank_event_identifier_record_count": 0, "duplicate_group_count": 2, "duplicate_member_record_count": 4, "excess_copy_record_count": 2, "conflicting_event_identity_count": 0, "distinct_event_count": 244, "consistent_event_count": 244, "completed_event_count": 228, "completed_without_date_count": 0, "completed_outside_period_count": 5, "in_period_completed_event_count": 223, "blank_participant_identifier_event_count": 0, "unmatched_event_count": 1, "eligible_encounter_count": 222, "distinct_person_count": 80, "multi_group_person_count": 10}',
      '{"measured_component": "distinct_person_count"}', false, true),
    ('source_derived_measurements_arithmetic_check', 'cross-source value not its component', 'cross_source_reach', NULL, NULL, NULL, '81', '81', NULL, NULL,
      '{"physical_record_count": 246, "blank_event_identifier_record_count": 0, "duplicate_group_count": 2, "duplicate_member_record_count": 4, "excess_copy_record_count": 2, "conflicting_event_identity_count": 0, "distinct_event_count": 244, "consistent_event_count": 244, "completed_event_count": 228, "completed_without_date_count": 0, "completed_outside_period_count": 5, "in_period_completed_event_count": 223, "blank_participant_identifier_event_count": 0, "unmatched_event_count": 1, "eligible_encounter_count": 222, "distinct_person_count": 80, "multi_group_person_count": 10}',
      '{"measured_component": "distinct_person_count"}', false, false),
    ('source_derived_measurements_arithmetic_check', 'cross-source unmatched not excluded', 'cross_source_reach', NULL, NULL, NULL, '223', '223', NULL, NULL,
      '{"physical_record_count": 246, "blank_event_identifier_record_count": 0, "duplicate_group_count": 2, "duplicate_member_record_count": 4, "excess_copy_record_count": 2, "conflicting_event_identity_count": 0, "distinct_event_count": 244, "consistent_event_count": 244, "completed_event_count": 228, "completed_without_date_count": 0, "completed_outside_period_count": 5, "in_period_completed_event_count": 223, "blank_participant_identifier_event_count": 0, "unmatched_event_count": 1, "eligible_encounter_count": 223, "distinct_person_count": 80, "multi_group_person_count": 10}',
      '{"measured_component": "eligible_encounter_count"}', false, false),
    ('source_derived_measurements_arithmetic_check', 'cross-source duplicates not collapsed', 'cross_source_reach', NULL, NULL, NULL, '222', '222', NULL, NULL,
      '{"physical_record_count": 246, "blank_event_identifier_record_count": 0, "duplicate_group_count": 2, "duplicate_member_record_count": 4, "excess_copy_record_count": 2, "conflicting_event_identity_count": 0, "distinct_event_count": 246, "consistent_event_count": 246, "completed_event_count": 228, "completed_without_date_count": 0, "completed_outside_period_count": 5, "in_period_completed_event_count": 223, "blank_participant_identifier_event_count": 0, "unmatched_event_count": 1, "eligible_encounter_count": 222, "distinct_person_count": 80, "multi_group_person_count": 10}',
      '{"measured_component": "eligible_encounter_count"}', false, false),
    ('source_derived_measurements_paired_counts_check', 'paired counts add up', 'paired_outcome_change', NULL, NULL, NULL, '25', '25', '38', '65.79',
      '{"increased_count": 25, "comparable_pair_count": 38, "unchanged_count": 10, "decreased_count": 3, "participant_count": 46, "excluded_participant_count": 8}', '{}', true, true),
    ('source_derived_measurements_paired_counts_check', 'paired components do not add up', 'paired_outcome_change', NULL, NULL, NULL, '25', '25', '38', '65.79',
      '{"increased_count": 25, "comparable_pair_count": 38, "unchanged_count": 9, "decreased_count": 3, "participant_count": 46, "excluded_participant_count": 8}', '{}', false, false),
    ('source_derived_measurements_paired_counts_check', 'paired participants do not add up', 'paired_outcome_change', NULL, NULL, NULL, '25', '25', '38', '65.79',
      '{"increased_count": 25, "comparable_pair_count": 38, "unchanged_count": 10, "decreased_count": 3, "participant_count": 45, "excluded_participant_count": 8}', '{}', false, false),
    ('source_derived_measurements_rate_counts_check', 'rate population adds up', 'tabular_rate', NULL, NULL, NULL, '9', '9', '29', '31.03',
      '{"population_record_count": 29, "numerator_record_count": 9, "other_population_record_count": 20}', '{}', true, true),
    ('source_derived_measurements_rate_counts_check', 'rate population does not add up', 'tabular_rate', NULL, NULL, NULL, '9', '9', '29', '31.03',
      '{"population_record_count": 29, "numerator_record_count": 9, "other_population_record_count": 19}', '{}', false, false)
),
measurement_results AS (
  SELECT v.name, v.vector, CASE WHEN s.cross_present THEN v.expected_post ELSE v.expected_pre END AS expected,
         (xpath('/row/ok/text()', query_to_xml(format(
           'SELECT coalesce(%s, true) AS ok FROM (VALUES (%L::text, %L::text, %L::text, %L::text, %L::bigint, %L::bigint, %L::bigint, %L::numeric, %L::jsonb, %L::jsonb))'
           || ' AS t(measurement_family, calculation_method, basis_version, worksheet_key, measured_value, numerator, denominator, percentage, component_counts, definition)',
           coalesce(substr(l.def, 7), 'false'), v.measurement_family, v.calculation_method, v.basis_version, v.worksheet_key, v.measured_value, v.numerator, v.denominator, v.percentage,
           v.component_counts, v.definition), false, true, '')))[1]::text = 'true' AS observed
    FROM measurement_vectors v CROSS JOIN schema_state s LEFT JOIN live l ON l.name = v.name
),
interpretation_vectors(name, vector, indicator_label, meaning_text, score_direction, evidence_basis, interpretation_status, created_by_type, expected) AS (
  VALUES
    ('source_derived_measurement_interpretations_label_check', 'label', 'People served', 'm', NULL, 'organization_record', 'human_stated', 'human', true),
    ('source_derived_measurement_interpretations_label_check', 'label starting with a digit', '80 people', 'm', NULL, 'organization_record', 'human_stated', 'human', false),
    ('source_derived_measurement_interpretations_text_check', 'meaning', 'People served', 'People with a completed session.', NULL, 'organization_record', 'human_stated', 'human', true),
    ('source_derived_measurement_interpretations_text_check', 'meaning with a URL', 'People served', 'See https://example.org', NULL, 'organization_record', 'human_stated', 'human', false),
    ('source_derived_measurement_interpretations_text_check', 'empty meaning', 'People served', '', NULL, 'organization_record', 'human_stated', 'human', false),
    ('source_derived_measurement_interpretations_direction_check', 'higher is better', 'Score', 'm', 'higher_is_better', 'self_reported', 'human_stated', 'human', true),
    ('source_derived_measurement_interpretations_direction_check', 'unknown direction', 'Score', 'm', 'better', 'self_reported', 'human_stated', 'human', false),
    ('source_derived_measurement_interpretations_basis_check', 'self-reported', 'Score', 'm', NULL, 'self_reported', 'human_stated', 'human', true),
    ('source_derived_measurement_interpretations_basis_check', 'verified', 'Score', 'm', NULL, 'verified', 'human_stated', 'human', false),
    ('source_derived_measurement_interpretations_status_check', 'stated by a person', 'Score', 'm', NULL, 'self_reported', 'human_stated', 'human', true),
    ('source_derived_measurement_interpretations_status_check', 'approved', 'Score', 'm', NULL, 'self_reported', 'approved', 'human', false),
    ('source_derived_measurement_interpretations_created_by_type_check', 'by the system', 'Score', 'm', NULL, 'self_reported', 'human_stated', 'system', false)
),
interpretation_results AS (
  SELECT v.name, v.vector, v.expected,
         (xpath('/row/ok/text()', query_to_xml(format(
           'SELECT coalesce(%s, true) AS ok FROM (VALUES (%L::text, %L::text, %L::text, %L::text, %L::text, %L::text))'
           || ' AS t(indicator_label, meaning_text, score_direction, evidence_basis, interpretation_status, created_by_type)',
           coalesce(substr(l.def, 7), 'false'), v.indicator_label, v.meaning_text, v.score_direction, v.evidence_basis, v.interpretation_status, v.created_by_type), false, true, '')))[1]::text = 'true' AS observed
    FROM interpretation_vectors v LEFT JOIN live l ON l.name = v.name
),
source_vectors(name, vector, source_role, profile_canonical_sha256, field_keys, expected) AS (
  VALUES
    ('source_derived_measurement_sources_role_check', 'primary', 'primary', repeat('a', 64), '["field_1"]', true),
    ('source_derived_measurement_sources_role_check', 'reference', 'reference', repeat('a', 64), '["field_1"]', true),
    ('source_derived_measurement_sources_role_check', 'other role', 'secondary', repeat('a', 64), '["field_1"]', false),
    ('source_derived_measurement_sources_profile_sha_check', 'profile sha', 'reference', repeat('a', 64), '["field_1"]', true),
    ('source_derived_measurement_sources_profile_sha_check', 'short sha', 'reference', 'abc', '["field_1"]', false),
    ('source_derived_measurement_sources_field_keys_check', 'one field', 'reference', repeat('a', 64), '["field_1"]', true),
    ('source_derived_measurement_sources_field_keys_check', 'no field', 'reference', repeat('a', 64), '[]', false),
    ('source_derived_measurement_sources_field_keys_check', 'not a list', 'reference', repeat('a', 64), '{"field": 1}', false)
),
source_results AS (
  SELECT v.name, v.vector, v.expected,
         (xpath('/row/ok/text()', query_to_xml(format(
           'SELECT coalesce(%s, true) AS ok FROM (VALUES (%L::text, %L::text, %L::jsonb)) AS t(source_role, profile_canonical_sha256, field_keys)',
           coalesce(substr(l.def, 7), 'false'), v.source_role, v.profile_canonical_sha256, v.field_keys), false, true, '')))[1]::text = 'true' AS observed
    FROM source_vectors v LEFT JOIN live l ON l.name = v.name
),
locator_vectors(vector, coordinates, expected) AS (
  VALUES
    ('derived fields locator', '{"scope": "derived_measurement_fields", "field_keys": ["field_1", "field_2"]}', true),
    ('derived fields locator on a worksheet', '{"scope": "derived_measurement_fields", "sheet_key": "sheet_2", "field_keys": ["field_6"]}', true),
    ('derived locator with a row', '{"scope": "derived_measurement_fields", "field_keys": ["field_1"], "row": 3}', false),
    ('derived locator by worksheet name', '{"scope": "derived_measurement_fields", "sheet_key": "Assessments", "field_keys": ["field_1"]}', false),
    ('derived locator with nine fields', '{"scope": "derived_measurement_fields", "field_keys": [1, 2, 3, 4, 5, 6, 7, 8, 9]}', false)
),
locator_results AS (
  SELECT v.vector, v.expected,
         (xpath('/row/ok/text()', query_to_xml(format('SELECT coalesce(%s, true) AS ok FROM (VALUES (%L::text, %L::jsonb)) AS t(locator_type, coordinates)',
           coalesce(substr(l.def, 7), 'false'), 'source_derived_measurement_fields', v.coordinates), false, true, '')))[1]::text = 'true' AS observed
    FROM locator_vectors v LEFT JOIN live l ON l.name = 'source_locators_p2_01_coordinates_check'
),
append_only AS (
  SELECT count(*) AS n
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal
     AND p.proname = 'source_derived_measurement_append_only'
     AND (t.tgtype & 2) = 2 AND (t.tgtype & 8) = 8 AND (t.tgtype & 16) = 16
     AND t.tgrelid IN (to_regclass('kai.source_derived_measurements'), to_regclass('kai.source_derived_measurement_interpretations'),
                       to_regclass('kai.evidence_derived_measurements'), to_regclass('kai.source_derived_measurement_sources'))
),
unique_indexes AS (
  SELECT count(*) AS n
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indisunique
     AND c.relname IN ('source_derived_measurements_identity_unique', 'source_derived_measurement_interpretations_history_unique', 'evidence_derived_measurements_statement_unique')
),
admission_trigger AS (
  SELECT count(*) AS n
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND p.proname = 'source_derived_measurement_source_admitted'
     AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4
     AND t.tgrelid = to_regclass('kai.source_derived_measurement_sources')
),
vector_status(name, status, observed) AS (
  SELECT 'measurement:' || name,
         CASE WHEN count(*) > 0 AND bool_and(observed IS NOT DISTINCT FROM expected) THEN 'PASS' ELSE 'FAIL' END,
         string_agg(vector || '=' || coalesce(observed::text, 'absent'), '; ' ORDER BY vector)
    FROM measurement_results GROUP BY name
  UNION ALL
  SELECT 'interpretation', CASE WHEN count(*) = 12 AND bool_and(observed IS NOT DISTINCT FROM expected) THEN 'PASS' ELSE 'FAIL' END,
         string_agg(vector || '=' || coalesce(observed::text, 'absent'), '; ' ORDER BY vector)
    FROM interpretation_results
  UNION ALL
  SELECT 'sources', CASE WHEN count(*) = 8 AND bool_and(observed IS NOT DISTINCT FROM expected) THEN 'PASS' ELSE 'FAIL' END,
         string_agg(vector || '=' || coalesce(observed::text, 'absent'), '; ' ORDER BY vector)
    FROM source_results
  UNION ALL
  SELECT 'locator', CASE WHEN count(*) = 5 AND bool_and(observed IS NOT DISTINCT FROM expected) THEN 'PASS' ELSE 'FAIL' END,
         string_agg(vector || '=' || coalesce(observed::text, 'absent'), '; ' ORDER BY vector)
    FROM locator_results
),
checks(seq, check_id, status, expected, observed, detail) AS (
  SELECT 5, 'D0.schema_state', 'PASS', 'informational',
         CASE WHEN (SELECT cross_present FROM schema_state) THEN 'after the cross-source reach migration' ELSE 'before the cross-source reach migration' END,
         'selects whether the cross-source family is admitted and D7 applies'
  UNION ALL
  SELECT 10, 'D1.tables_present',
         CASE WHEN to_regclass('kai.source_derived_measurements') IS NOT NULL AND to_regclass('kai.source_derived_measurement_interpretations') IS NOT NULL
                AND to_regclass('kai.evidence_derived_measurements') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'three source-derived measurement tables', concat_ws(',', to_regclass('kai.source_derived_measurements'), to_regclass('kai.source_derived_measurement_interpretations'), to_regclass('kai.evidence_derived_measurements')),
         'created by the source-derived measurement migration'
  UNION ALL
  SELECT 20 + row_number() OVER (ORDER BY name), 'D2.' || name, status, 'every vector as expected', observed, 'live CHECK evaluated against literal values'
    FROM vector_status WHERE name LIKE 'measurement:%'
  UNION ALL
  SELECT 30, 'D3.interpretation_vectors', status, 'labels, meanings, direction, evidence basis (never verified), human-stated only', observed, 'interpretation CHECKs evaluated against literal values'
    FROM vector_status WHERE name = 'interpretation'
  UNION ALL
  SELECT 40, 'D4.derived_locator_vectors', status, 'fields locator admitted; rows, worksheet names and more than eight fields refused', observed, 'source_locators_p2_01_coordinates_check'
    FROM vector_status WHERE name = 'locator'
  UNION ALL
  SELECT 50, 'D5.append_only_triggers',
         CASE WHEN (SELECT n FROM append_only) = CASE WHEN (SELECT cross_present FROM schema_state) THEN 4 ELSE 3 END THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN (SELECT cross_present FROM schema_state) THEN '4' ELSE '3' END, (SELECT n FROM append_only)::text,
         'BEFORE UPDATE OR DELETE append-only trigger on every source-derived measurement table'
  UNION ALL
  SELECT 60, 'D6.unique_identity_indexes', CASE WHEN (SELECT n FROM unique_indexes) = 3 THEN 'PASS' ELSE 'FAIL' END, '3', (SELECT n FROM unique_indexes)::text,
         'one measurement per identity, one linear interpretation history, one evidence item per measurement and interpretation'
  UNION ALL
  SELECT 70, 'D7.contributing_sources',
         CASE WHEN NOT (SELECT cross_present FROM schema_state) THEN 'PASS'
              WHEN (SELECT status FROM vector_status WHERE name = 'sources') = 'PASS' AND (SELECT n FROM admission_trigger) = 1 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN (SELECT cross_present FROM schema_state) THEN 'role, profile and field CHECKs and the admission trigger' ELSE 'not applicable before the cross-source migration' END,
         CASE WHEN (SELECT cross_present FROM schema_state) THEN coalesce((SELECT observed FROM vector_status WHERE name = 'sources'), '(absent)') || '; admission trigger=' || (SELECT n FROM admission_trigger) ELSE 'not applied' END,
         'kai.source_derived_measurement_sources'
  UNION ALL
  SELECT 80, 'D8.derived_rows', 'PASS', 'informational',
         coalesce((SELECT string_agg(measurement_family || '=' || n, '; ' ORDER BY measurement_family)
                     FROM (SELECT measurement_family, count(*)::text AS n FROM kai.source_derived_measurements GROUP BY 1) m), 'none'),
         'existing measurement rows by family'
)
SELECT seq, check_id, status, expected, observed, detail FROM checks
UNION ALL
SELECT 99, 'OVERALL', CASE WHEN bool_and(status = 'PASS') AND count(*) = 12 THEN 'PASS' ELSE 'FAIL' END,
       '12 checks PASS', count(*) FILTER (WHERE status = 'PASS')::text || ' of ' || count(*)::text || ' PASS', 'read-only'
  FROM checks
ORDER BY seq, check_id;
