BEGIN;

-- KAI P2-01M extension: the human-defined record count of a promoted
-- one-worksheet Excel workbook. Additive only:
--   * kai.evidence_measurements.calculation_method gains exactly one value,
--     'p1_xlsx_single_worksheet_data_rows_excluding_blank_v1' (the data rows
--     after the header row of the workbook's only worksheet, from the P1
--     worksheet record-count basis). The CSV method is unchanged.
--   * kai.source_locators' source_data_records coordinates gain exactly one
--     shape, {"scope": "data_records_after_header", "sheet_key": "sheet_<n>"},
--     the data records of one named worksheet. The whole-version CSV shape and
--     the column shape are unchanged.
-- Every other CHECK (evidence type, data class, their pairing, locator type,
-- counts arithmetic, labels, profile hash) is untouched. No existing row is
-- read, rewritten, or re-keyed.

DO $$
BEGIN
  IF to_regclass('kai.evidence_measurements') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_measurements (P2-01M) is required before the P2-01M XLSX worksheet method migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.evidence_measurements'::regclass AND conname = 'evidence_measurements_p2_01m_method_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.source_locators'::regclass AND conname = 'source_locators_p2_01_coordinates_check'
  ) THEN
    RAISE EXCEPTION 'the P2-01M method and locator coordinate CHECKs are required before the P2-01M XLSX worksheet method migration';
  END IF;
END $$;

ALTER TABLE kai.evidence_measurements
  DROP CONSTRAINT evidence_measurements_p2_01m_method_check,
  ADD CONSTRAINT evidence_measurements_p2_01m_method_check
    CHECK (calculation_method IN (
      'p1_csv_profile_data_records_excluding_blank_v1',
      'p1_xlsx_single_worksheet_data_rows_excluding_blank_v1'
    ));

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
      OR (
        locator_type = 'source_data_records'
        AND jsonb_typeof(coordinates) = 'object'
        AND coordinates - ARRAY['scope', 'sheet_key'] = '{}'::jsonb
        AND coordinates->'scope' = '"data_records_after_header"'::jsonb
        AND jsonb_typeof(coordinates->'sheet_key') = 'string'
        AND coordinates->>'sheet_key' ~ '^sheet_[1-9][0-9]{0,3}$'
      )
    );

COMMIT;
