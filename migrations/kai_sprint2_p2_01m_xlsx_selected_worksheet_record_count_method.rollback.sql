BEGIN;

-- Refuse reversal once a measurement uses the selected-worksheet method.
-- Existing CSV and single-worksheet measurements and worksheet locators stay
-- valid under the restored checks.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM kai.evidence_measurements
     WHERE calculation_method = 'p1_xlsx_selected_worksheet_data_rows_excluding_blank_v1'
  ) THEN
    RAISE EXCEPTION 'selected-worksheet method rollback refused: persisted measurements depend on the method';
  END IF;
END $$;

DROP TRIGGER IF EXISTS evidence_measurements_selected_worksheet_locator_check ON kai.evidence_measurements;
DROP FUNCTION IF EXISTS kai.enforce_selected_worksheet_measurement_locator();

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
