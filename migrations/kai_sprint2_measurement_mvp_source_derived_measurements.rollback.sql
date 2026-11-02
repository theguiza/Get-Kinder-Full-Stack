BEGIN;

-- Refuse reversal once any source-derived measurement, interpretation or
-- evidence exists: removing the tables or the vocabulary would orphan or
-- invalidate them. On an unused installation, drop the three tables and
-- restore the P2-01M evidence, pairing and locator CHECKs exactly. No
-- record-count measurement, evidence, locator or claim row is touched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.source_derived_measurements)
    OR EXISTS (SELECT 1 FROM kai.evidence_items WHERE evidence_type = 'source_derived_measurement')
    OR EXISTS (SELECT 1 FROM kai.source_locators WHERE locator_type = 'source_derived_measurement_fields') THEN
    RAISE EXCEPTION 'source-derived measurement rollback refused: source-derived measurements, evidence or locators exist';
  END IF;
END $$;

DROP TABLE IF EXISTS kai.evidence_derived_measurements;
DROP TABLE IF EXISTS kai.source_derived_measurement_interpretations;
DROP TABLE IF EXISTS kai.source_derived_measurements;
DROP FUNCTION IF EXISTS kai.source_derived_measurement_append_only();

ALTER TABLE kai.evidence_items
  DROP CONSTRAINT evidence_items_p2_01_evidence_type_check,
  ADD CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type IN ('dictionary_field_presence_fact', 'source_record_count_measurement')),
  DROP CONSTRAINT evidence_items_p2_01m_type_class_pairing_check,
  ADD CONSTRAINT evidence_items_p2_01m_type_class_pairing_check
    CHECK (
      (evidence_type = 'dictionary_field_presence_fact' AND data_class = 'organization_committed_metadata')
      OR (evidence_type = 'source_record_count_measurement' AND data_class = 'source_derived_aggregate')
    );

ALTER TABLE kai.source_locators
  DROP CONSTRAINT source_locators_p2_01_locator_type_check,
  ADD CONSTRAINT source_locators_p2_01_locator_type_check
    CHECK (locator_type IN ('column', 'source_data_records')),
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
