BEGIN;

-- Rolls back P2-01M. Refuses while any measurement claim, evidence item, or
-- locator exists, so no measurement-derived record is silently orphaned or
-- rewritten; the field-presence vocabulary is restored exactly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.evidence_items WHERE evidence_type = 'source_record_count_measurement')
     OR EXISTS (SELECT 1 FROM kai.source_locators WHERE locator_type = 'source_data_records') THEN
    RAISE EXCEPTION 'P2-01M rollback refused: source record-count measurement evidence exists';
  END IF;
END $$;

DROP TABLE IF EXISTS kai.evidence_measurements;
DROP TABLE IF EXISTS kai.source_measurement_definitions;

ALTER TABLE kai.source_locators
  DROP CONSTRAINT IF EXISTS source_locators_p2_01_coordinates_check,
  ADD CONSTRAINT source_locators_p2_01_coordinates_check
    CHECK (
      jsonb_typeof(coordinates) = 'object'
      AND coordinates ? 'column_name'
      AND coordinates - ARRAY['column_name'] = '{}'::jsonb
      AND jsonb_typeof(coordinates->'column_name') = 'string'
    ),
  DROP CONSTRAINT IF EXISTS source_locators_p2_01_locator_type_check,
  ADD CONSTRAINT source_locators_p2_01_locator_type_check
    CHECK (locator_type = 'column');

ALTER TABLE kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01m_type_class_pairing_check,
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_data_class_check,
  ADD CONSTRAINT evidence_items_p2_01_data_class_check
    CHECK (data_class = 'organization_committed_metadata'),
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_evidence_type_check,
  ADD CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type = 'dictionary_field_presence_fact');

COMMIT;
