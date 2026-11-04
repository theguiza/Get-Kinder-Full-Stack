-- KAI P2-01M XLSX worksheet methods: verification after
--   migrations/kai_sprint2_p2_01m_xlsx_selected_worksheet_record_count_method.sql
-- READ-ONLY. One SELECT statement; it changes nothing and inserts nothing.
-- The two widened CHECKs are proven by evaluating the live CHECK expressions
-- against literal values (query_to_xml), not by inserting rows; the four other
-- P2-01M vocabulary CHECKs must still match the definitions the P2-01M packet
-- verified (03V). Last row OVERALL must be PASS. Run it in the pgAdmin Query
-- Tool (Execute script, F5) and read the Data Output grid.
-- Version-aware (X0): migrations/kai_sprint2_measurement_mvp_source_derived_measurements.sql
-- later widens three of those four CHECKs by one value each. Before it (no
-- kai.source_derived_measurements), all four must match their pinned text and
-- refuse the derived values. After it, the data-class CHECK must still match
-- its pinned text, and the three widened CHECKs are verified by behaviour:
-- every record-count value and pairing admitted, the one derived value and
-- pairing admitted, and every other value and pairing still refused. Its new
-- constraints are verified separately by
-- scripts/kai-measurement-mvp-derived-measurements-verify-read-only.sql.
-- Also version-aware for migrations/kai_sprint2_document_statement_evidence.sql,
-- which widens the data-class CHECK and the other three by one value each:
-- before it the data-class CHECK must match its pinned text; after it all four
-- are verified by behaviour (the document-statement value, class, pairing and
-- locator admitted; mismatched pairings and unknown values still refused).
WITH
schema_state AS (
  SELECT to_regclass('kai.source_derived_measurements') IS NOT NULL AS derived_present,
         EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = to_regclass('kai.evidence_items') AND conname = 'evidence_items_p2_01_evidence_type_check'
                    AND pg_get_constraintdef(oid) LIKE '%source_document_statement%') AS document_present
),
live AS (
  SELECT con.conname::text AS name,
         regexp_replace(btrim(regexp_replace(regexp_replace(pg_get_constraintdef(con.oid, true), '\m(kai|public)\.', '', 'g'), '\s+', ' ', 'g')), ' NOT VALID$', '') AS def
    FROM pg_constraint con
   WHERE con.conrelid IN (to_regclass('kai.evidence_measurements'), to_regclass('kai.source_locators'), to_regclass('kai.evidence_items'))
),
method_vectors(vector, calculation_method, expected) AS (
  VALUES
    ('CSV method', 'p1_csv_profile_data_records_excluding_blank_v1', true),
    ('XLSX worksheet method', 'p1_xlsx_single_worksheet_data_rows_excluding_blank_v1', true),
    ('XLSX selected worksheet method', 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1', true),
    ('unknown method', 'p1_xlsx_single_worksheet_data_rows_excluding_blank_v2', false),
    ('empty method', '', false)
),
locator_vectors(vector, locator_type, coordinates, expected) AS (
  VALUES
    ('column locator', 'column', '{"column_name": "field_1"}', true),
    ('whole-version CSV data records', 'source_data_records', '{"scope": "data_records_after_header"}', true),
    ('one worksheet''s data records', 'source_data_records', '{"scope": "data_records_after_header", "sheet_key": "sheet_1"}', true),
    ('worksheet by name', 'source_data_records', '{"scope": "data_records_after_header", "sheet_key": "Sessions"}', false),
    ('worksheet key zero', 'source_data_records', '{"scope": "data_records_after_header", "sheet_key": "sheet_0"}', false),
    ('worksheet with extra key', 'source_data_records', '{"scope": "data_records_after_header", "sheet_key": "sheet_1", "row": 2}', false),
    ('other scope', 'source_data_records', '{"scope": "all_rows", "sheet_key": "sheet_1"}', false),
    ('column locator with worksheet', 'column', '{"column_name": "field_1", "sheet_key": "sheet_1"}', false)
),
method_results AS (
  SELECT v.vector, v.expected,
         (xpath('/row/ok/text()', query_to_xml(format('SELECT %s AS ok FROM (VALUES (%L::text)) AS t(calculation_method)',
           substr(l.def, 7), v.calculation_method), false, true, '')))[1]::text = 'true' AS observed
    FROM method_vectors v JOIN live l ON l.name = 'evidence_measurements_p2_01m_method_check'
),
locator_results AS (
  SELECT v.vector, v.expected,
         (xpath('/row/ok/text()', query_to_xml(format('SELECT %s AS ok FROM (VALUES (%L::text, %L::jsonb)) AS t(locator_type, coordinates)',
           substr(l.def, 7), v.locator_type, v.coordinates), false, true, '')))[1]::text = 'true' AS observed
    FROM locator_vectors v JOIN live l ON l.name = 'source_locators_p2_01_coordinates_check'
),
unchanged(name, md5, widened_by_derived, widened_by_document) AS (
  VALUES
    ('evidence_items_p2_01_evidence_type_check', 'fb69f3652c5cb0d132b363e954b37214', true, true),
    ('evidence_items_p2_01_data_class_check', '6995d02dd3cc654b66ea26d754ad7e08', false, true),
    ('evidence_items_p2_01m_type_class_pairing_check', '27be1934508bbb0b85750bd963402ba8', true, true),
    ('source_locators_p2_01_locator_type_check', '605d49b80446568e147b817150e6e2c5', true, true)
),
-- Literal vectors for the four CHECKs the document-statement migration
-- widens: expected without it and with it.
document_vectors(name, vector, evidence_type, data_class, locator_type, expected_without, expected_with) AS (
  VALUES
    ('evidence_items_p2_01_evidence_type_check', 'document statement', 'source_document_statement', 'source_document_excerpt', 'column', false, true),
    ('evidence_items_p2_01_data_class_check', 'metadata class', 'dictionary_field_presence_fact', 'organization_committed_metadata', 'column', true, true),
    ('evidence_items_p2_01_data_class_check', 'aggregate class', 'source_record_count_measurement', 'source_derived_aggregate', 'column', true, true),
    ('evidence_items_p2_01_data_class_check', 'excerpt class', 'source_document_statement', 'source_document_excerpt', 'column', false, true),
    ('evidence_items_p2_01_data_class_check', 'unknown class', 'source_document_statement', 'raw_document_text', 'column', false, false),
    ('evidence_items_p2_01m_type_class_pairing_check', 'document as excerpt', 'source_document_statement', 'source_document_excerpt', 'column', false, true),
    ('evidence_items_p2_01m_type_class_pairing_check', 'document as metadata', 'source_document_statement', 'organization_committed_metadata', 'column', false, false),
    ('evidence_items_p2_01m_type_class_pairing_check', 'fact as excerpt', 'dictionary_field_presence_fact', 'source_document_excerpt', 'column', false, false),
    ('source_locators_p2_01_locator_type_check', 'document span locator', 'dictionary_field_presence_fact', 'organization_committed_metadata', 'document_text_span', false, true)
),
document_results AS (
  SELECT v.name, v.vector, CASE WHEN s.document_present THEN v.expected_with ELSE v.expected_without END AS expected,
         (xpath('/row/ok/text()', query_to_xml(format('SELECT coalesce(%s, true) AS ok FROM (VALUES (%L::text, %L::text, %L::text)) AS t(evidence_type, data_class, locator_type)',
           substr(l.def, 7), v.evidence_type, v.data_class, v.locator_type), false, true, '')))[1]::text = 'true' AS observed
    FROM document_vectors v CROSS JOIN schema_state s JOIN live l ON l.name = v.name
),
-- Literal vectors for the three CHECKs the derived-measurement migration
-- widens: expected before it (pre) and after it (post).
vocabulary_vectors(name, vector, evidence_type, data_class, locator_type, expected_pre, expected_post) AS (
  VALUES
    ('evidence_items_p2_01_evidence_type_check', 'field presence fact', 'dictionary_field_presence_fact', 'organization_committed_metadata', 'column', true, true),
    ('evidence_items_p2_01_evidence_type_check', 'record count', 'source_record_count_measurement', 'source_derived_aggregate', 'column', true, true),
    ('evidence_items_p2_01_evidence_type_check', 'derived measurement', 'source_derived_measurement', 'source_derived_aggregate', 'column', false, true),
    ('evidence_items_p2_01_evidence_type_check', 'unknown type', 'source_record_count', 'source_derived_aggregate', 'column', false, false),
    ('evidence_items_p2_01_evidence_type_check', 'empty type', '', 'source_derived_aggregate', 'column', false, false),
    ('evidence_items_p2_01m_type_class_pairing_check', 'fact as metadata', 'dictionary_field_presence_fact', 'organization_committed_metadata', 'column', true, true),
    ('evidence_items_p2_01m_type_class_pairing_check', 'count as aggregate', 'source_record_count_measurement', 'source_derived_aggregate', 'column', true, true),
    ('evidence_items_p2_01m_type_class_pairing_check', 'derived as aggregate', 'source_derived_measurement', 'source_derived_aggregate', 'column', false, true),
    ('evidence_items_p2_01m_type_class_pairing_check', 'count as metadata', 'source_record_count_measurement', 'organization_committed_metadata', 'column', false, false),
    ('evidence_items_p2_01m_type_class_pairing_check', 'fact as aggregate', 'dictionary_field_presence_fact', 'source_derived_aggregate', 'column', false, false),
    ('evidence_items_p2_01m_type_class_pairing_check', 'derived as metadata', 'source_derived_measurement', 'organization_committed_metadata', 'column', false, false),
    ('source_locators_p2_01_locator_type_check', 'column locator', 'dictionary_field_presence_fact', 'organization_committed_metadata', 'column', true, true),
    ('source_locators_p2_01_locator_type_check', 'data records locator', 'dictionary_field_presence_fact', 'organization_committed_metadata', 'source_data_records', true, true),
    ('source_locators_p2_01_locator_type_check', 'derived fields locator', 'dictionary_field_presence_fact', 'organization_committed_metadata', 'source_derived_measurement_fields', false, true),
    ('source_locators_p2_01_locator_type_check', 'row locator', 'dictionary_field_presence_fact', 'organization_committed_metadata', 'row', false, false)
),
vocabulary_results AS (
  SELECT v.name, v.vector, CASE WHEN s.derived_present THEN v.expected_post ELSE v.expected_pre END AS expected,
         (xpath('/row/ok/text()', query_to_xml(format('SELECT coalesce(%s, true) AS ok FROM (VALUES (%L::text, %L::text, %L::text)) AS t(evidence_type, data_class, locator_type)',
           substr(l.def, 7), v.evidence_type, v.data_class, v.locator_type), false, true, '')))[1]::text = 'true' AS observed
    FROM vocabulary_vectors v CROSS JOIN schema_state s JOIN live l ON l.name = v.name
),
checks(seq, check_id, status, expected, observed, detail) AS (
  SELECT 5, 'X0.schema_state', 'PASS', 'informational',
         CASE WHEN (SELECT derived_present FROM schema_state) THEN 'after the derived-measurement migration' ELSE 'before the derived-measurement migration' END
           || CASE WHEN (SELECT document_present FROM schema_state) THEN '; after the document-statement migration' ELSE '' END,
         'selects the pinned-text or behavioural verification of the three CHECKs that migration widens'
  UNION ALL
  SELECT 10, 'X1.method_vectors',
         CASE WHEN (SELECT count(*) FROM method_results) = 5 AND (SELECT bool_and(observed IS NOT DISTINCT FROM expected) FROM method_results) THEN 'PASS' ELSE 'FAIL' END,
         'CSV, single-worksheet XLSX and selected-worksheet XLSX methods admitted; any other refused',
         coalesce((SELECT string_agg(vector || '=' || coalesce(observed::text, 'absent'), '; ' ORDER BY vector) FROM method_results), '(constraint absent)'),
         'evidence_measurements_p2_01m_method_check evaluated against literal values'
  UNION ALL
  SELECT 20, 'X2.locator_vectors',
         CASE WHEN (SELECT count(*) FROM locator_results) = 8 AND (SELECT bool_and(observed IS NOT DISTINCT FROM expected) FROM locator_results) THEN 'PASS' ELSE 'FAIL' END,
         'column, whole-version and one-worksheet locators admitted; malformed worksheet scopes refused',
         coalesce((SELECT string_agg(vector || '=' || coalesce(observed::text, 'absent'), '; ' ORDER BY vector) FROM locator_results), '(constraint absent)'),
         'source_locators_p2_01_coordinates_check evaluated against literal values'
  UNION ALL
  SELECT 30, 'X3.unchanged_' || u.name,
         CASE
           WHEN l.def IS NULL THEN 'FAIL'
           -- Every vocabulary vector of this CHECK must hold in the current schema state.
           WHEN u.widened_by_derived AND NOT coalesce((SELECT count(*) = count(*) FILTER (WHERE r.observed IS NOT DISTINCT FROM r.expected) AND count(*) > 0
                                                   FROM vocabulary_results r WHERE r.name = u.name), false) THEN 'FAIL'
           -- Every document vector of this CHECK must hold in the current schema state.
           WHEN u.widened_by_document AND NOT coalesce((SELECT count(*) = count(*) FILTER (WHERE r.observed IS NOT DISTINCT FROM r.expected) AND count(*) > 0
                                                   FROM document_results r WHERE r.name = u.name), false) THEN 'FAIL'
           -- Pinned text until a migration that widens the CHECK is present.
           WHEN NOT ((u.widened_by_derived AND s.derived_present) OR (u.widened_by_document AND s.document_present)) AND md5(l.def) <> u.md5 THEN 'FAIL'
           ELSE 'PASS'
         END,
         CASE WHEN (u.widened_by_derived AND s.derived_present) OR (u.widened_by_document AND s.document_present)
              THEN 'record-count, derived and (when installed) document values admitted; every other value refused' ELSE u.md5 END,
         CASE WHEN (u.widened_by_derived AND s.derived_present) OR (u.widened_by_document AND s.document_present)
              THEN coalesce((SELECT string_agg(r.vector || '=' || coalesce(r.observed::text, 'absent'), '; ' ORDER BY r.vector)
                               FROM (SELECT vector, observed, name FROM vocabulary_results UNION ALL SELECT vector, observed, name FROM document_results) r WHERE r.name = u.name), '(constraint absent)')
              ELSE coalesce(md5(l.def), '(absent)') END,
         CASE WHEN u.widened_by_document AND s.document_present THEN 'widened by the document-statement migration; verified by behaviour'
              WHEN u.widened_by_derived AND s.derived_present THEN 'widened by the derived-measurement migration; verified by behaviour'
              ELSE 'unchanged since the P2-01M migration' END
    FROM unchanged u CROSS JOIN schema_state s LEFT JOIN live l ON l.name = u.name
  UNION ALL
  SELECT 40, 'X4.measurement_rows_by_method', 'PASS', 'informational',
         coalesce((SELECT string_agg(calculation_method || '=' || n, '; ' ORDER BY calculation_method)
                     FROM (SELECT calculation_method, count(*)::text AS n FROM kai.evidence_measurements GROUP BY 1) m), 'none'),
         'existing measurement rows (the migration rewrites none)'
)
SELECT seq, check_id, status, expected, observed, detail FROM checks
UNION ALL
SELECT 99, 'OVERALL', CASE WHEN bool_and(status = 'PASS') AND count(*) = 8 THEN 'PASS' ELSE 'FAIL' END,
       '8 checks PASS', count(*) FILTER (WHERE status = 'PASS')::text || ' of ' || count(*)::text || ' PASS', 'read-only'
  FROM checks
ORDER BY seq, check_id;
