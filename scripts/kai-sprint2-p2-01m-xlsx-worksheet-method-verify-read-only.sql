-- KAI P2-01M XLSX worksheet methods: verification after
--   migrations/kai_sprint2_p2_01m_xlsx_selected_worksheet_record_count_method.sql
-- READ-ONLY. One SELECT statement; it changes nothing and inserts nothing.
-- The two widened CHECKs are proven by evaluating the live CHECK expressions
-- against literal values (query_to_xml), not by inserting rows; the four other
-- P2-01M vocabulary CHECKs must still match the definitions the P2-01M packet
-- verified (03V). Last row OVERALL must be PASS. Run it in the pgAdmin Query
-- Tool (Execute script, F5) and read the Data Output grid.
WITH
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
unchanged(name, md5) AS (
  VALUES
    ('evidence_items_p2_01_evidence_type_check', 'fb69f3652c5cb0d132b363e954b37214'),
    ('evidence_items_p2_01_data_class_check', '6995d02dd3cc654b66ea26d754ad7e08'),
    ('evidence_items_p2_01m_type_class_pairing_check', '27be1934508bbb0b85750bd963402ba8'),
    ('source_locators_p2_01_locator_type_check', '605d49b80446568e147b817150e6e2c5')
),
checks(seq, check_id, status, expected, observed, detail) AS (
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
         CASE WHEN md5(l.def) = u.md5 THEN 'PASS' ELSE 'FAIL' END,
         u.md5, coalesce(md5(l.def), '(absent)'), 'unchanged since the P2-01M migration'
    FROM unchanged u LEFT JOIN live l ON l.name = u.name
  UNION ALL
  SELECT 40, 'X4.measurement_rows_by_method', 'PASS', 'informational',
         coalesce((SELECT string_agg(calculation_method || '=' || n, '; ' ORDER BY calculation_method)
                     FROM (SELECT calculation_method, count(*)::text AS n FROM kai.evidence_measurements GROUP BY 1) m), 'none'),
         'existing measurement rows (the migration rewrites none)'
)
SELECT seq, check_id, status, expected, observed, detail FROM checks
UNION ALL
SELECT 99, 'OVERALL', CASE WHEN bool_and(status = 'PASS') AND count(*) = 7 THEN 'PASS' ELSE 'FAIL' END,
       '7 checks PASS', count(*) FILTER (WHERE status = 'PASS')::text || ' of ' || count(*)::text || ' PASS', 'read-only'
  FROM checks
ORDER BY seq, check_id;
