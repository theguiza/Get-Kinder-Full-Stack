BEGIN;

-- Rolls back the P2-01M XLSX worksheet method. Safe only while no workbook
-- record count exists: it refuses while any measurement uses the XLSX method
-- or any locator is scoped to a worksheet, so no measured evidence, claim or
-- report lineage is orphaned or rewritten. After the first workbook count
-- this migration is irreversible by rollback; the application revision that
-- writes XLSX counts must be rolled back first, and the rows stay. CSV
-- measurements are untouched either way; both CHECKs are restored exactly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.evidence_measurements WHERE calculation_method = 'p1_xlsx_single_worksheet_data_rows_excluding_blank_v1')
     OR EXISTS (SELECT 1 FROM kai.source_locators WHERE locator_type = 'source_data_records' AND coordinates ? 'sheet_key') THEN
    RAISE EXCEPTION 'P2-01M XLSX worksheet method rollback refused: workbook record-count measurements exist';
  END IF;
END $$;

ALTER TABLE kai.source_locators
  DROP CONSTRAINT source_locators_p2_01_coordinates_check,
  ADD CONSTRAINT source_locators_p2_01_coordinates_check
    CHECK (
      (
        locator_type = 'column'
        AND jsonb_typeof(coordinates) = 'object'
        AND coordinates ? 'column_name'
        AND coordinates - ARRAY['column_name'] = '{}'::jsonb
        AND jsonb_typeof(coordinates->'column_name') = 'string'
      )
      OR (
        locator_type = 'source_data_records'
        AND coordinates = '{"scope": "data_records_after_header"}'::jsonb
      )
    );

ALTER TABLE kai.evidence_measurements
  DROP CONSTRAINT evidence_measurements_p2_01m_method_check,
  ADD CONSTRAINT evidence_measurements_p2_01m_method_check
    CHECK (calculation_method = 'p1_csv_profile_data_records_excluding_blank_v1');

COMMIT;
