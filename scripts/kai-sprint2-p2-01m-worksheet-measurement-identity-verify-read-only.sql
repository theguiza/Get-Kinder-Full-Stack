-- KAI P2-01M worksheet measurement identity: verification after
--   migrations/kai_sprint2_p2_01m_worksheet_measurement_identity.sql
-- READ-ONLY. One SELECT statement; it changes nothing and inserts nothing.
-- The worksheet_key CHECK is proven by evaluating the live CHECK expression
-- against literal values (query_to_xml), not by inserting rows. Last row
-- OVERALL must be PASS. Run it in the pgAdmin Query Tool (Execute script, F5)
-- and read the Data Output grid.
WITH
live_checks AS (
  SELECT con.conname::text AS name,
         regexp_replace(btrim(regexp_replace(regexp_replace(pg_get_constraintdef(con.oid, true), '\m(kai|public)\.', '', 'g'), '\s+', ' ', 'g')), ' NOT VALID$', '') AS def
    FROM pg_constraint con
   WHERE con.conrelid IN (to_regclass('kai.evidence_measurements'), to_regclass('kai.source_measurement_definitions'))
),
columns AS (
  SELECT c.table_name::text, c.data_type::text, c.is_nullable::text
    FROM information_schema.columns c
   WHERE c.table_schema = 'kai' AND c.column_name = 'worksheet_key'
     AND c.table_name IN ('evidence_measurements', 'source_measurement_definitions')
),
identity_indexes(name, expected) AS (
  VALUES
    ('source_measurement_definitions_p2_01m_worksheet_identity_unique',
     'CREATE UNIQUE INDEX source_measurement_definitions_p2_01m_worksheet_identity_unique ON kai.source_measurement_definitions USING btree (organization_id, source_version_id, measurement_type, COALESCE(worksheet_key, ''''::text))'),
    ('evidence_measurements_p2_01m_worksheet_identity_unique',
     'CREATE UNIQUE INDEX evidence_measurements_p2_01m_worksheet_identity_unique ON kai.evidence_measurements USING btree (organization_id, source_version_id, measurement_type, COALESCE(worksheet_key, ''''::text))')
),
index_results AS (
  SELECT i.name, i.expected, pg_get_indexdef(to_regclass('kai.' || i.name)) AS observed
    FROM identity_indexes i
),
key_vectors(vector, calculation_method, worksheet_key, expected) AS (
  VALUES
    ('selected method with a worksheet', 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1', 'sheet_3', true),
    ('selected method without a worksheet', 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1', NULL, false),
    ('selected method with a worksheet name', 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1', 'Service_Events', false),
    ('CSV method whole version', 'p1_csv_profile_data_records_excluding_blank_v1', NULL, true),
    ('CSV method with a worksheet', 'p1_csv_profile_data_records_excluding_blank_v1', 'sheet_1', false),
    ('one-worksheet method whole version', 'p1_xlsx_single_worksheet_data_rows_excluding_blank_v1', NULL, true)
),
key_results AS (
  SELECT v.vector, v.expected,
         (xpath('/row/ok/text()', query_to_xml(format('SELECT %s AS ok FROM (VALUES (%L::text, %L::text)) AS t(calculation_method, worksheet_key)',
           substr(l.def, 7), v.calculation_method, v.worksheet_key), false, true, '')))[1]::text = 'true' AS observed
    FROM key_vectors v JOIN live_checks l ON l.name = 'evidence_measurements_p2_01m_worksheet_key_check'
),
triggers(name, relation) AS (
  VALUES
    ('evidence_measurements_worksheet_identity_check', 'kai.evidence_measurements'),
    ('source_measurement_definitions_worksheet_identity_check', 'kai.source_measurement_definitions'),
    ('evidence_measurements_selected_worksheet_locator_check', 'kai.evidence_measurements')
),
-- Row reads name worksheet_key, so they run (through query_to_xml) only once
-- both columns exist; before the migration they report absent.
row_reads AS (
  SELECT
    CASE WHEN (SELECT count(*) FROM columns) = 2 THEN (xpath('/row/n/text()', query_to_xml($q$
      SELECT count(*) AS n
        FROM kai.evidence_measurements m
        JOIN kai.source_measurement_definitions d
          ON d.organization_id = m.organization_id
         AND d.source_measurement_definition_id = m.source_measurement_definition_id
        JOIN kai.evidence_items e
          ON e.organization_id = m.organization_id
         AND e.evidence_item_id = m.evidence_item_id
        JOIN kai.source_locators sl
          ON sl.organization_id = e.organization_id
         AND sl.source_locator_id = e.source_locator_id
       WHERE d.worksheet_key IS DISTINCT FROM m.worksheet_key
          OR (m.calculation_method = 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1') <> (m.worksheet_key IS NOT NULL)
          OR (m.worksheet_key IS NOT NULL AND sl.coordinates->>'sheet_key' IS DISTINCT FROM m.worksheet_key)
    $q$, false, true, '')))[1]::text END AS disagreements,
    CASE WHEN (SELECT count(*) FROM columns) = 2 THEN (xpath('/row/rows/text()', query_to_xml($q$
      SELECT coalesce(string_agg(calculation_method || '/' || coalesce(worksheet_key, 'whole_version') || '=' || n, '; ' ORDER BY calculation_method, worksheet_key), 'none') AS rows
        FROM (SELECT calculation_method, worksheet_key, count(*)::text AS n FROM kai.evidence_measurements GROUP BY 1, 2) m
    $q$, false, true, '')))[1]::text END AS by_method
),
checks(seq, check_id, status, expected, observed, detail) AS (
  SELECT 10, 'W1.worksheet_key_columns',
         CASE WHEN (SELECT count(*) FROM columns WHERE data_type = 'text' AND is_nullable = 'YES') = 2 THEN 'PASS' ELSE 'FAIL' END,
         'nullable text worksheet_key on both tables',
         coalesce((SELECT string_agg(table_name || '=' || data_type || '/' || is_nullable, '; ' ORDER BY table_name) FROM columns), '(absent)'),
         'information_schema.columns'
  UNION ALL
  SELECT 20, 'W2.identity_index_' || r.name,
         CASE WHEN r.observed = r.expected AND (SELECT indisunique FROM pg_index WHERE indexrelid = to_regclass('kai.' || r.name)) THEN 'PASS' ELSE 'FAIL' END,
         'unique (organization, version, type, worksheet)', coalesce(r.observed, '(absent)'), 'pg_get_indexdef'
    FROM index_results r
  UNION ALL
  SELECT 30, 'W3.one_per_version_constraints_removed',
         CASE WHEN NOT EXISTS (SELECT 1 FROM live_checks WHERE name IN ('source_measurement_definitions_p2_01m_identity_unique', 'evidence_measurements_p2_01m_identity_unique')) THEN 'PASS' ELSE 'FAIL' END,
         'neither UNIQUE (organization_id, source_version_id, measurement_type) remains',
         coalesce((SELECT string_agg(name, '; ') FROM live_checks WHERE name LIKE '%p2_01m_identity_unique'), 'none'), 'pg_constraint'
  UNION ALL
  SELECT 40, 'W4.worksheet_key_vectors',
         CASE WHEN (SELECT count(*) FROM key_results) = 6 AND (SELECT bool_and(observed IS NOT DISTINCT FROM expected) FROM key_results)
                AND EXISTS (SELECT 1 FROM live_checks WHERE name = 'source_measurement_definitions_p2_01m_worksheet_key_check') THEN 'PASS' ELSE 'FAIL' END,
         'a worksheet key exactly for the selected-worksheet method; definition key CHECK present',
         coalesce((SELECT string_agg(vector || '=' || coalesce(observed::text, 'absent'), '; ' ORDER BY vector) FROM key_results), '(constraint absent)'),
         'evidence_measurements_p2_01m_worksheet_key_check evaluated against literal values'
  UNION ALL
  SELECT 50, 'W5.trigger_' || t.name,
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgname = t.name AND tg.tgrelid = to_regclass(t.relation) AND tg.tgenabled = 'O') THEN 'PASS' ELSE 'FAIL' END,
         'present and enabled', coalesce((SELECT tg.tgenabled::text FROM pg_trigger tg WHERE tg.tgname = t.name AND tg.tgrelid = to_regclass(t.relation)), '(absent)'), t.relation
    FROM triggers t
  UNION ALL
  SELECT 60, 'W6.persisted_rows_agree',
         CASE WHEN (SELECT disagreements FROM row_reads) = '0' THEN 'PASS' ELSE 'FAIL' END,
         '0 measurements whose worksheet disagrees with method, definition, or locator', coalesce((SELECT disagreements FROM row_reads), '(columns absent)'), 'kai.evidence_measurements'
  UNION ALL
  SELECT 70, 'W7.measurement_rows_by_method_and_worksheet', 'PASS', 'informational',
         coalesce((SELECT by_method FROM row_reads), '(columns absent)'),
         'existing measurement rows (the migration writes only their new worksheet_key)'
)
SELECT seq, check_id, status, expected, observed, detail FROM checks
UNION ALL
SELECT 99, 'OVERALL', CASE WHEN bool_and(status = 'PASS') AND count(*) = 10 THEN 'PASS' ELSE 'FAIL' END,
       '10 checks PASS', count(*) FILTER (WHERE status = 'PASS')::text || ' of ' || count(*)::text || ' PASS', 'read-only'
  FROM checks
ORDER BY seq, check_id;
