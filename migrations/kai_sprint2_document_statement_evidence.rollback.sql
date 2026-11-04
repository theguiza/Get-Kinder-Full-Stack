BEGIN;

-- Refuse reversal once any document-statement evidence or locator exists:
-- narrowing the vocabulary would invalidate them. On an unused installation,
-- restore the source-derived measurement migration's evidence, data-class,
-- pairing, locator-type and coordinate CHECKs exactly. No other row, table
-- or constraint is touched.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.evidence_items WHERE evidence_type = 'source_document_statement' OR data_class = 'source_document_excerpt')
    OR EXISTS (SELECT 1 FROM kai.source_locators WHERE locator_type = 'document_text_span') THEN
    RAISE EXCEPTION 'document-statement evidence rollback refused: document-statement evidence or locators exist';
  END IF;
END $$;

ALTER TABLE kai.evidence_items
  DROP CONSTRAINT evidence_items_p2_01_evidence_type_check,
  ADD CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type IN ('dictionary_field_presence_fact', 'source_record_count_measurement', 'source_derived_measurement')),
  DROP CONSTRAINT evidence_items_p2_01_data_class_check,
  ADD CONSTRAINT evidence_items_p2_01_data_class_check
    CHECK (data_class IN ('organization_committed_metadata', 'source_derived_aggregate')),
  DROP CONSTRAINT evidence_items_p2_01m_type_class_pairing_check,
  ADD CONSTRAINT evidence_items_p2_01m_type_class_pairing_check
    CHECK (
      (evidence_type = 'dictionary_field_presence_fact' AND data_class = 'organization_committed_metadata')
      OR (evidence_type = 'source_record_count_measurement' AND data_class = 'source_derived_aggregate')
      OR (evidence_type = 'source_derived_measurement' AND data_class = 'source_derived_aggregate')
    );

ALTER TABLE kai.source_locators
  DROP CONSTRAINT source_locators_p2_01_locator_type_check,
  ADD CONSTRAINT source_locators_p2_01_locator_type_check
    CHECK (locator_type IN ('column', 'source_data_records', 'source_derived_measurement_fields')),
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
      OR (
        locator_type = 'source_derived_measurement_fields'
        AND jsonb_typeof(coordinates) = 'object'
        AND coordinates - ARRAY['scope', 'sheet_key', 'field_keys'] = '{}'::jsonb
        AND coordinates->'scope' = '"derived_measurement_fields"'::jsonb
        AND (NOT coordinates ? 'sheet_key' OR coordinates->>'sheet_key' ~ '^sheet_[1-9][0-9]{0,3}$')
        AND jsonb_typeof(coordinates->'field_keys') = 'array'
        AND jsonb_array_length(coordinates->'field_keys') BETWEEN 0 AND 8
      )
    );

COMMIT;
