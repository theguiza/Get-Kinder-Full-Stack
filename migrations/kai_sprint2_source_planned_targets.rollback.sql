BEGIN;
LOCK TABLE kai.source_planned_targets, kai.planned_target_decisions, kai.evidence_planned_targets, kai.evidence_items, kai.source_locators IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM kai.source_planned_targets) OR EXISTS (SELECT 1 FROM kai.planned_target_decisions)
 OR EXISTS (SELECT 1 FROM kai.evidence_planned_targets)
 OR EXISTS (SELECT 1 FROM kai.evidence_items WHERE evidence_type = 'source_planned_target')
 OR EXISTS (SELECT 1 FROM kai.source_locators WHERE locator_type = 'planning_target_row')
 THEN RAISE EXCEPTION 'source planned targets rollback refused: persisted plans, decisions, evidence or locators exist'; END IF;
END $$;
DROP TABLE kai.evidence_planned_targets;
DROP TABLE kai.planned_target_decisions;
DROP TABLE kai.source_planned_targets;
DROP FUNCTION kai.validate_planned_target_integrity();
ALTER TABLE kai.evidence_items
  DROP CONSTRAINT evidence_items_p2_01_evidence_type_check,
  ADD CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type IN ('dictionary_field_presence_fact', 'source_record_count_measurement', 'source_derived_measurement', 'source_document_statement')),
  DROP CONSTRAINT evidence_items_p2_01_data_class_check,
  ADD CONSTRAINT evidence_items_p2_01_data_class_check
    CHECK (data_class IN ('organization_committed_metadata', 'source_derived_aggregate', 'source_document_excerpt')),
  DROP CONSTRAINT evidence_items_p2_01m_type_class_pairing_check,
  ADD CONSTRAINT evidence_items_p2_01m_type_class_pairing_check
    CHECK (
      (evidence_type = 'dictionary_field_presence_fact' AND data_class = 'organization_committed_metadata')
      OR (evidence_type = 'source_record_count_measurement' AND data_class = 'source_derived_aggregate')
      OR (evidence_type = 'source_derived_measurement' AND data_class = 'source_derived_aggregate')
      OR (evidence_type = 'source_document_statement' AND data_class = 'source_document_excerpt')
    );

ALTER TABLE kai.source_locators
  DROP CONSTRAINT source_locators_p2_01_locator_type_check,
  ADD CONSTRAINT source_locators_p2_01_locator_type_check
    CHECK (locator_type IN ('column', 'source_data_records', 'source_derived_measurement_fields', 'document_text_span')),
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
      OR (
        locator_type = 'document_text_span'
        AND jsonb_typeof(coordinates) = 'object'
        AND coordinates->'method' = '"kai_document_statement_excerpt_v1"'::jsonb
        AND jsonb_typeof(coordinates->'excerpt_sha256') = 'string'
        AND coordinates->>'excerpt_sha256' ~ '^[a-f0-9]{64}$'
        AND jsonb_typeof(coordinates->'sentence_start') = 'number'
        AND jsonb_typeof(coordinates->'sentence_end') = 'number'
        AND coordinates->>'sentence_start' ~ '^[1-9][0-9]{0,5}$'
        AND coordinates->>'sentence_end' ~ '^[1-9][0-9]{0,5}$'
        AND (CASE WHEN coordinates->>'sentence_start' ~ '^[1-9][0-9]{0,5}$' AND coordinates->>'sentence_end' ~ '^[1-9][0-9]{0,5}$'
                  THEN (coordinates->>'sentence_end')::int >= (coordinates->>'sentence_start')::int ELSE false END)
        AND (
          (
            coordinates->'unit' = '"pdf_page_blocks"'::jsonb
            AND coordinates ?& ARRAY['unit', 'page_number', 'block_start', 'block_end', 'sentence_start', 'sentence_end', 'excerpt_sha256', 'method']
            AND coordinates - ARRAY['unit', 'page_number', 'block_start', 'block_end', 'sentence_start', 'sentence_end', 'excerpt_sha256', 'method'] = '{}'::jsonb
            AND jsonb_typeof(coordinates->'page_number') = 'number'
            AND jsonb_typeof(coordinates->'block_start') = 'number'
            AND jsonb_typeof(coordinates->'block_end') = 'number'
            AND coordinates->>'page_number' ~ '^[1-9][0-9]{0,5}$'
            AND coordinates->>'block_start' ~ '^[1-9][0-9]{0,5}$'
            AND coordinates->>'block_end' ~ '^[1-9][0-9]{0,5}$'
            AND (CASE WHEN coordinates->>'block_start' ~ '^[1-9][0-9]{0,5}$' AND coordinates->>'block_end' ~ '^[1-9][0-9]{0,5}$'
                      THEN (coordinates->>'block_end')::int >= (coordinates->>'block_start')::int ELSE false END)
          )
          OR (
            coordinates->'unit' = '"text_lines"'::jsonb
            AND coordinates ?& ARRAY['unit', 'line_start', 'line_end', 'sentence_start', 'sentence_end', 'excerpt_sha256', 'method']
            AND coordinates - ARRAY['unit', 'line_start', 'line_end', 'sentence_start', 'sentence_end', 'excerpt_sha256', 'method'] = '{}'::jsonb
            AND jsonb_typeof(coordinates->'line_start') = 'number'
            AND jsonb_typeof(coordinates->'line_end') = 'number'
            AND coordinates->>'line_start' ~ '^[1-9][0-9]{0,6}$'
            AND coordinates->>'line_end' ~ '^[1-9][0-9]{0,6}$'
            AND (CASE WHEN coordinates->>'line_start' ~ '^[1-9][0-9]{0,6}$' AND coordinates->>'line_end' ~ '^[1-9][0-9]{0,6}$'
                      THEN (coordinates->>'line_end')::int >= (coordinates->>'line_start')::int ELSE false END)
          )
        )
      )
    );

COMMIT;
