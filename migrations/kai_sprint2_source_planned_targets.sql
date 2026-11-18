BEGIN;
-- Owner-authorized local implementation; no deployed rows are rewritten.
ALTER TABLE kai.evidence_items
  DROP CONSTRAINT evidence_items_p2_01_evidence_type_check,
  ADD CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type IN ('dictionary_field_presence_fact', 'source_record_count_measurement', 'source_derived_measurement', 'source_document_statement', 'source_planned_target')),
  DROP CONSTRAINT evidence_items_p2_01_data_class_check,
  ADD CONSTRAINT evidence_items_p2_01_data_class_check
    CHECK (data_class IN ('organization_committed_metadata', 'source_derived_aggregate', 'source_document_excerpt')),
  DROP CONSTRAINT evidence_items_p2_01m_type_class_pairing_check,
  ADD CONSTRAINT evidence_items_p2_01m_type_class_pairing_check
    CHECK (
      (evidence_type = 'dictionary_field_presence_fact' AND data_class = 'organization_committed_metadata')
      OR (evidence_type = 'source_record_count_measurement' AND data_class = 'source_derived_aggregate')
      OR (evidence_type = 'source_derived_measurement' AND data_class = 'source_derived_aggregate')
      OR (evidence_type = 'source_planned_target' AND data_class = 'source_derived_aggregate')
      OR (evidence_type = 'source_document_statement' AND data_class = 'source_document_excerpt')
    );

ALTER TABLE kai.source_locators
  DROP CONSTRAINT source_locators_p2_01_locator_type_check,
  ADD CONSTRAINT source_locators_p2_01_locator_type_check
    CHECK (locator_type IN ('column', 'source_data_records', 'source_derived_measurement_fields', 'document_text_span', 'planning_target_row')),
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
        locator_type = 'planning_target_row'
        AND jsonb_typeof(coordinates) = 'object'
        AND coordinates ?& ARRAY['sheet_key','row_number']
        AND coordinates - ARRAY['sheet_key','row_number'] = '{}'::jsonb
        AND coordinates->>'sheet_key' ~ '^sheet_[1-9][0-9]{0,3}$'
        AND jsonb_typeof(coordinates->'row_number') = 'number'
        AND coordinates->>'row_number' ~ '^[1-9][0-9]{0,5}$'
        AND (coordinates->>'row_number')::int >= 2
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


-- A plan is independent of achieved measurements. Its accepted source facts
-- never change. Meaning/comparison decisions have a separate linear history.
CREATE TABLE kai.source_planned_targets (
  planned_target_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_locator_id uuid NOT NULL,
  supersedes_target_id uuid,
  worksheet_key text NOT NULL CHECK (worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'),
  row_number integer NOT NULL CHECK (row_number BETWEEN 2 AND 201),
  file_profile_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$'),
  source_checksum text NOT NULL CHECK (source_checksum ~ '^[a-f0-9]{64}$'),
  indicator text NOT NULL CHECK (length(indicator) BETWEEN 1 AND 100),
  planned_value numeric(14,2) NOT NULL CHECK (planned_value >= 0 AND planned_value <> 'NaN'::numeric),
  unit text NOT NULL CHECK (length(unit) BETWEEN 1 AND 100),
  unit_kind text NOT NULL CHECK (unit_kind IN ('count','percent')),
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  scope text CHECK (length(scope) BETWEEN 1 AND 100),
  source_comparison text CHECK (source_comparison IN ('at_least','at_most')),
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human' CHECK (created_by_type = 'human'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planned_target_id, organization_id),
  CHECK (supersedes_target_id IS NULL OR supersedes_target_id <> planned_target_id),
  FOREIGN KEY (supersedes_target_id, organization_id) REFERENCES kai.source_planned_targets (planned_target_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT source_planned_targets_row_unique UNIQUE (organization_id, source_version_id, worksheet_key, row_number),
  FOREIGN KEY (source_version_id, source_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, source_id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_locator_id, organization_id)
    REFERENCES kai.source_locators (source_locator_id, organization_id) ON DELETE RESTRICT,
  CHECK ((unit_kind = 'count' AND planned_value = trunc(planned_value)) OR (unit_kind = 'percent' AND planned_value <= 100))
);
CREATE UNIQUE INDEX source_planned_targets_successor ON kai.source_planned_targets (supersedes_target_id) WHERE supersedes_target_id IS NOT NULL;
CREATE INDEX source_planned_targets_project ON kai.source_planned_targets (organization_id, engagement_id);
CREATE TABLE kai.planned_target_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  planned_target_id uuid NOT NULL,
  supersedes_decision_id uuid,
  actual_measurement_id uuid,
  relationship_status text NOT NULL CHECK (relationship_status IN ('unresolved','confirmed','rejected')),
  comparison text CHECK (comparison IN ('at_least','at_most')),
  metric_confirmed boolean NOT NULL DEFAULT false,
  population_confirmed boolean NOT NULL DEFAULT false,
  date_basis_confirmed boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human' CHECK (created_by_type = 'human'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, organization_id),
  UNIQUE (decision_id, planned_target_id, organization_id),
  FOREIGN KEY (planned_target_id, organization_id) REFERENCES kai.source_planned_targets (planned_target_id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_decision_id, planned_target_id, organization_id) REFERENCES kai.planned_target_decisions (decision_id, planned_target_id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (actual_measurement_id, organization_id) REFERENCES kai.source_derived_measurements (source_derived_measurement_id, organization_id) ON DELETE RESTRICT,
  CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> decision_id),
  CHECK ((relationship_status = 'unresolved' AND actual_measurement_id IS NULL AND NOT metric_confirmed AND NOT population_confirmed AND NOT date_basis_confirmed)
    OR (relationship_status = 'rejected' AND actual_measurement_id IS NOT NULL AND NOT metric_confirmed AND NOT population_confirmed AND NOT date_basis_confirmed)
    OR (relationship_status = 'confirmed' AND actual_measurement_id IS NOT NULL AND metric_confirmed AND population_confirmed AND date_basis_confirmed))
);
CREATE UNIQUE INDEX planned_target_decisions_root ON kai.planned_target_decisions (planned_target_id) WHERE supersedes_decision_id IS NULL;
CREATE UNIQUE INDEX planned_target_decisions_successor ON kai.planned_target_decisions (supersedes_decision_id) WHERE supersedes_decision_id IS NOT NULL;
CREATE TABLE kai.evidence_planned_targets (
  evidence_item_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  planned_target_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  UNIQUE (decision_id),
  FOREIGN KEY (evidence_item_id, organization_id) REFERENCES kai.evidence_items (evidence_item_id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (decision_id, planned_target_id, organization_id) REFERENCES kai.planned_target_decisions (decision_id, planned_target_id, organization_id) ON DELETE RESTRICT
);
-- Cross-object facts require transaction-level enforcement beyond individual FKs.
CREATE FUNCTION kai.validate_planned_target_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p kai.source_planned_targets; a kai.source_derived_measurements;
BEGIN
  IF TG_TABLE_NAME = 'source_planned_targets' THEN
    IF NOT EXISTS (
      SELECT 1 FROM kai.source_versions v
      JOIN kai.intake_source_candidates c ON c.intake_source_candidate_id = v.intake_source_candidate_id AND c.organization_id = v.organization_id
      JOIN kai.intake_file_profiles f ON f.file_profile_id = c.file_profile_id AND f.organization_id = c.organization_id
      JOIN kai.intake_files i ON i.intake_file_id = f.intake_file_id AND i.organization_id = f.organization_id
      JOIN kai.intake_batches b ON b.intake_batch_id = i.intake_batch_id AND b.organization_id = i.organization_id
      JOIN kai.source_locators l ON l.source_locator_id = NEW.source_locator_id AND l.organization_id = NEW.organization_id
      WHERE v.source_version_id = NEW.source_version_id AND v.organization_id = NEW.organization_id
        AND b.engagement_id = NEW.engagement_id AND f.file_profile_id = NEW.file_profile_id
        AND v.profile_canonical_sha256 = NEW.profile_canonical_sha256 AND f.profile_canonical_sha256 = NEW.profile_canonical_sha256
        AND f.checksum = NEW.source_checksum AND l.source_version_id = NEW.source_version_id
        AND l.locator_type = 'planning_target_row'
        AND l.coordinates = jsonb_build_object('sheet_key',NEW.worksheet_key,'row_number',NEW.row_number)
    ) OR (NEW.supersedes_target_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kai.source_planned_targets old
      WHERE old.planned_target_id = NEW.supersedes_target_id AND old.organization_id = NEW.organization_id
        AND old.engagement_id = NEW.engagement_id AND old.source_id = NEW.source_id AND old.source_version_id <> NEW.source_version_id
        AND old.worksheet_key = NEW.worksheet_key AND old.row_number = NEW.row_number AND old.indicator = NEW.indicator
        AND old.unit = NEW.unit AND old.unit_kind = NEW.unit_kind AND old.scope IS NOT DISTINCT FROM NEW.scope
        AND old.period_start = NEW.period_start AND old.period_end = NEW.period_end)) THEN RAISE EXCEPTION 'planned target provenance mismatch' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'planned_target_decisions' AND NEW.actual_measurement_id IS NOT NULL THEN
    SELECT * INTO STRICT p FROM kai.source_planned_targets WHERE planned_target_id = NEW.planned_target_id AND organization_id = NEW.organization_id;
    SELECT * INTO STRICT a FROM kai.source_derived_measurements WHERE source_derived_measurement_id = NEW.actual_measurement_id AND organization_id = NEW.organization_id;
    IF NEW.relationship_status = 'confirmed' AND (
      NOT EXISTS (SELECT 1 FROM kai.source_versions v JOIN kai.intake_source_candidates c USING (intake_source_candidate_id, organization_id)
        JOIN kai.intake_file_profiles f USING (file_profile_id, organization_id)
        JOIN kai.intake_files i USING (intake_file_id, organization_id)
        JOIN kai.intake_batches b USING (intake_batch_id, organization_id)
        WHERE v.source_version_id = a.source_version_id AND b.engagement_id = p.engagement_id)
      OR p.unit_kind <> CASE WHEN a.measurement_family IN ('tabular_rate','paired_outcome_change') THEN 'percent' ELSE 'count' END
      OR NOT (EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(a.definition->'conditions','[]')) x
        WHERE x->>'kind' = 'period' AND x->>'scope' = 'within' AND x->>'period_start' = p.period_start::text AND x->>'period_end' = p.period_end::text)
        OR (a.definition->'period'->>'period_start' = p.period_start::text AND a.definition->'period'->>'period_end' = p.period_end::text)) IS TRUE
    ) THEN RAISE EXCEPTION 'planned target actual incompatible' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'evidence_planned_targets' THEN
    IF NOT EXISTS (SELECT 1 FROM kai.source_planned_targets p JOIN kai.evidence_items e ON e.evidence_item_id = NEW.evidence_item_id AND e.organization_id = p.organization_id
      WHERE p.planned_target_id = NEW.planned_target_id AND p.organization_id = NEW.organization_id
        AND e.source_version_id = p.source_version_id AND e.source_locator_id = p.source_locator_id AND e.evidence_type = 'source_planned_target')
    THEN RAISE EXCEPTION 'planned target evidence mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['source_planned_targets','planned_target_decisions','evidence_planned_targets'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON kai.%I FOR EACH ROW EXECUTE FUNCTION kai.source_derived_measurement_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON kai.%I FOR EACH ROW EXECUTE FUNCTION kai.validate_planned_target_integrity()', t || '_integrity', t);
  END LOOP;
END $$;

COMMIT;
