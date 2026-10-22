BEGIN;

-- KAI P2-01M: one source-derived measurement, the human-defined record count
-- of a promoted source version. Additive only:
--   * kai.evidence_items and kai.source_locators each gain exactly one new
--     allowed vocabulary value (a measurement evidence type, its aggregate
--     data class, and a whole-version data-records locator). Every existing
--     row keeps its value, and the existing pairing (field-presence fact ->
--     organization_committed_metadata -> column locator) is unchanged. Every
--     other governance CHECK (sensitivity, support strength, review status,
--     internal-only and audience pins) is untouched, so a measurement is
--     internal-only, GK-review-gated evidence exactly like a field fact.
--   * kai.source_measurement_definitions: the authoritative, human-supplied
--     meaning of one counted record for one source version (what a record is,
--     unit, definition, inclusion/exclusion rules, optional reporting period).
--     Immutable: one definition per source version and measurement type.
--   * kai.evidence_measurements: the computed value bound 1:1 to its evidence
--     item, its definition, its source version, and the exact P1 profile it was
--     derived from, with the arithmetic it was derived by.
-- No existing evidence, locator, or claim row is read, rewritten, or re-keyed.

DO $$
BEGIN
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before P2-01M source record-count measurement migration';
  END IF;
  IF to_regclass('kai.source_locators') IS NULL THEN
    RAISE EXCEPTION 'kai.source_locators is required before P2-01M source record-count measurement migration';
  END IF;
  IF to_regclass('kai.source_versions') IS NULL THEN
    RAISE EXCEPTION 'kai.source_versions is required before P2-01M source record-count measurement migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'evidence_items'
       AND c.conname = 'evidence_items_p2_01_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.evidence_items_p2_01_id_org_unique is required before P2-01M source record-count measurement migration';
  END IF;
END $$;

ALTER TABLE kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_evidence_type_check,
  ADD CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type IN ('dictionary_field_presence_fact', 'source_record_count_measurement')),
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_data_class_check,
  ADD CONSTRAINT evidence_items_p2_01_data_class_check
    CHECK (data_class IN ('organization_committed_metadata', 'source_derived_aggregate')),
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01m_type_class_pairing_check,
  ADD CONSTRAINT evidence_items_p2_01m_type_class_pairing_check
    CHECK (
      (evidence_type = 'dictionary_field_presence_fact' AND data_class = 'organization_committed_metadata')
      OR (evidence_type = 'source_record_count_measurement' AND data_class = 'source_derived_aggregate')
    );

ALTER TABLE kai.source_locators
  DROP CONSTRAINT IF EXISTS source_locators_p2_01_locator_type_check,
  ADD CONSTRAINT source_locators_p2_01_locator_type_check
    CHECK (locator_type IN ('column', 'source_data_records')),
  DROP CONSTRAINT IF EXISTS source_locators_p2_01_coordinates_check,
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

CREATE TABLE IF NOT EXISTS kai.source_measurement_definitions (
  source_measurement_definition_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  measurement_type text NOT NULL,
  counted_unit text NOT NULL,
  unit_label text NOT NULL,
  definition_text text NOT NULL,
  inclusion_rule text NOT NULL,
  exclusion_rule text NOT NULL,
  period_start date,
  period_end date,
  definition_fingerprint text NOT NULL,
  definition_status text NOT NULL,

  created_by uuid NOT NULL,
  created_by_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_measurement_definitions_p2_01m_identity_unique
    UNIQUE (organization_id, source_version_id, measurement_type),
  CONSTRAINT source_measurement_definitions_p2_01m_id_org_unique
    UNIQUE (source_measurement_definition_id, organization_id),
  CONSTRAINT source_measurement_definitions_p2_01m_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_measurement_definitions_p2_01m_measurement_type_check
    CHECK (measurement_type = 'source_record_count'),
  CONSTRAINT source_measurement_definitions_p2_01m_label_check
    CHECK (
      counted_unit ~ '^[A-Za-z][A-Za-z0-9 ''()-]{0,79}$'
      AND unit_label ~ '^[A-Za-z][A-Za-z0-9 ''()-]{0,79}$'
    ),
  CONSTRAINT source_measurement_definitions_p2_01m_text_check
    CHECK (
      length(definition_text) BETWEEN 1 AND 300
      AND length(inclusion_rule) BETWEEN 1 AND 300
      AND length(exclusion_rule) BETWEEN 1 AND 300
      AND (definition_text || ' ' || inclusion_rule || ' ' || exclusion_rule)
        !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    ),
  CONSTRAINT source_measurement_definitions_p2_01m_period_check
    CHECK (
      (period_start IS NULL AND period_end IS NULL)
      OR (period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start)
    ),
  CONSTRAINT source_measurement_definitions_p2_01m_fingerprint_check
    CHECK (definition_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_measurement_definitions_p2_01m_status_check
    CHECK (definition_status = 'human_confirmed'),
  CONSTRAINT source_measurement_definitions_p2_01m_created_by_type_check
    CHECK (created_by_type = 'human')
);

CREATE TABLE IF NOT EXISTS kai.evidence_measurements (
  evidence_item_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_measurement_definition_id uuid NOT NULL,
  measurement_type text NOT NULL,
  measured_value bigint NOT NULL,
  unit_label text NOT NULL,
  calculation_method text NOT NULL,
  profile_canonical_sha256 text NOT NULL,
  total_record_count bigint NOT NULL,
  blank_record_count bigint NOT NULL,
  duplicate_record_count bigint NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidence_measurements_p2_01m_identity_unique
    UNIQUE (organization_id, source_version_id, measurement_type),
  CONSTRAINT evidence_measurements_p2_01m_evidence_item_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_measurements_p2_01m_definition_fk
    FOREIGN KEY (source_measurement_definition_id, organization_id)
    REFERENCES kai.source_measurement_definitions (source_measurement_definition_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_measurements_p2_01m_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_measurements_p2_01m_measurement_type_check
    CHECK (measurement_type = 'source_record_count'),
  CONSTRAINT evidence_measurements_p2_01m_method_check
    CHECK (calculation_method = 'p1_csv_profile_data_records_excluding_blank_v1'),
  CONSTRAINT evidence_measurements_p2_01m_counts_check
    CHECK (
      total_record_count >= 0
      AND blank_record_count >= 0
      AND duplicate_record_count >= 0
      AND blank_record_count <= total_record_count
      AND measured_value = total_record_count - blank_record_count
    ),
  CONSTRAINT evidence_measurements_p2_01m_unit_label_check
    CHECK (unit_label ~ '^[A-Za-z][A-Za-z0-9 ''()-]{0,79}$'),
  CONSTRAINT evidence_measurements_p2_01m_profile_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$')
);

COMMIT;
