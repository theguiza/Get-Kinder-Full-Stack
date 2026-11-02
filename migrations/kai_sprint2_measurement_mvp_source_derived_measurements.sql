BEGIN;

-- KAI Measurement MVP: source-derived measurements beyond the P2-01M record
-- count - the paired baseline/follow-up outcome change and content-aware
-- tabular counts and rates - in the existing Impact Evidence Library.
-- Additive only:
--   * kai.evidence_items gains one evidence type, source_derived_measurement,
--     paired with the existing source_derived_aggregate data class, and
--     kai.source_locators one locator type for the fields a measurement
--     reads. Every existing row keeps its value and every existing pairing is
--     unchanged; every other governance CHECK is untouched, so the evidence is
--     internal-only and review-gated exactly like a record count.
--   * kai.source_derived_measurements: the source-established arithmetic of
--     one measurement of one promoted source version (and worksheet), bound
--     to the exact P1 profile it was calculated from. No human definition is
--     required to retain it. Immutable.
--   * kai.source_derived_measurement_interpretations: a person's statement of
--     what the measured field means, append-only in one linear history per
--     measurement. It never changes a count.
--   * kai.evidence_derived_measurements: which measurement, under which
--     interpretation (or none), an evidence item states. At most one
--     evidence item per measurement and interpretation.
-- kai.evidence_measurements and kai.source_measurement_definitions, the
-- record-count arithmetic, and every existing evidence, locator and claim
-- row are not read, rewritten or re-keyed.

DO $$
BEGIN
  IF to_regclass('kai.evidence_measurements') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_measurements is required before the source-derived measurement migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.source_locators'::regclass AND conname = 'source_locators_p2_01_coordinates_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.evidence_items'::regclass AND conname = 'evidence_items_p2_01m_type_class_pairing_check'
  ) THEN
    RAISE EXCEPTION 'the P2-01M evidence pairing and locator coordinate CHECKs are required before the source-derived measurement migration';
  END IF;
END $$;

ALTER TABLE kai.evidence_items
  DROP CONSTRAINT evidence_items_p2_01_evidence_type_check,
  ADD CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type IN ('dictionary_field_presence_fact', 'source_record_count_measurement', 'source_derived_measurement')),
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

CREATE TABLE IF NOT EXISTS kai.source_derived_measurements (
  source_derived_measurement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  worksheet_key text,
  measurement_family text NOT NULL,
  calculation_method text NOT NULL,
  basis_version text NOT NULL,
  measurement_key text NOT NULL,
  definition jsonb NOT NULL,
  field_keys jsonb NOT NULL,
  measured_value bigint NOT NULL,
  numerator bigint NOT NULL,
  denominator bigint,
  percentage numeric(5, 2),
  component_counts jsonb NOT NULL,
  exclusions jsonb NOT NULL,
  row_locators jsonb,
  profile_canonical_sha256 text NOT NULL,

  created_by uuid NOT NULL,
  created_by_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_derived_measurements_id_org_unique
    UNIQUE (source_derived_measurement_id, organization_id),
  CONSTRAINT source_derived_measurements_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_derived_measurements_worksheet_key_check
    CHECK (worksheet_key IS NULL OR worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'),
  CONSTRAINT source_derived_measurements_method_family_check
    CHECK (
      (measurement_family = 'paired_outcome_change' AND calculation_method = 'p1_xlsx_paired_baseline_followup_numeric_change_v1'
        AND basis_version = 'kai_xlsx_paired_outcome_basis_v1' AND worksheet_key IS NOT NULL)
      OR (measurement_family = 'tabular_count'
        AND calculation_method IN ('kai_tabular_conditional_record_count_v1', 'kai_tabular_conditional_distinct_key_count_v1')
        AND basis_version = 'kai_tabular_measurement_basis_v1')
      OR (measurement_family = 'tabular_rate' AND calculation_method = 'kai_tabular_conditional_record_rate_v1'
        AND basis_version = 'kai_tabular_measurement_basis_v1')
    ),
  CONSTRAINT source_derived_measurements_key_check
    CHECK (measurement_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_derived_measurements_shape_check
    CHECK (
      jsonb_typeof(definition) = 'object'
      AND jsonb_typeof(field_keys) = 'array'
      AND jsonb_array_length(field_keys) BETWEEN 0 AND 8
      AND jsonb_typeof(component_counts) = 'object'
      AND jsonb_typeof(exclusions) = 'object'
      AND (row_locators IS NULL OR jsonb_typeof(row_locators) = 'object')
    ),
  CONSTRAINT source_derived_measurements_arithmetic_check
    CHECK (
      measured_value >= 0
      AND numerator = measured_value
      AND (
        (measurement_family = 'tabular_count' AND denominator IS NULL AND percentage IS NULL
          AND measured_value <= (component_counts->>'matching_record_count')::bigint)
        OR (measurement_family IN ('paired_outcome_change', 'tabular_rate') AND denominator > 0
          AND numerator <= denominator
          AND percentage = round(numerator * 100.0 / denominator, 2))
      )
    ),
  CONSTRAINT source_derived_measurements_paired_counts_check
    CHECK (
      measurement_family <> 'paired_outcome_change'
      OR (
        (component_counts->>'increased_count')::bigint = numerator
        AND (component_counts->>'comparable_pair_count')::bigint = denominator
        AND (component_counts->>'increased_count')::bigint + (component_counts->>'unchanged_count')::bigint
          + (component_counts->>'decreased_count')::bigint = denominator
        AND (component_counts->>'participant_count')::bigint = denominator + (component_counts->>'excluded_participant_count')::bigint
      )
    ),
  CONSTRAINT source_derived_measurements_rate_counts_check
    CHECK (
      measurement_family <> 'tabular_rate'
      OR (
        (component_counts->>'population_record_count')::bigint = denominator
        AND (component_counts->>'numerator_record_count')::bigint = numerator
        AND (component_counts->>'other_population_record_count')::bigint = denominator - numerator
      )
    ),
  CONSTRAINT source_derived_measurements_profile_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_derived_measurements_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- One authoritative measurement per source version, worksheet and identity.
CREATE UNIQUE INDEX IF NOT EXISTS source_derived_measurements_identity_unique
  ON kai.source_derived_measurements (organization_id, source_version_id, (COALESCE(worksheet_key, '')), measurement_key);

CREATE TABLE IF NOT EXISTS kai.source_derived_measurement_interpretations (
  interpretation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_derived_measurement_id uuid NOT NULL,
  supersedes_interpretation_id uuid,
  indicator_label text NOT NULL,
  meaning_text text NOT NULL,
  score_direction text,
  evidence_basis text NOT NULL,
  interpretation_status text NOT NULL,

  created_by uuid NOT NULL,
  created_by_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_derived_measurement_interpretations_measurement_unique
    UNIQUE (interpretation_id, source_derived_measurement_id),
  CONSTRAINT source_derived_measurement_interpretations_measurement_fk
    FOREIGN KEY (source_derived_measurement_id, organization_id)
    REFERENCES kai.source_derived_measurements (source_derived_measurement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_derived_measurement_interpretations_supersedes_fk
    FOREIGN KEY (supersedes_interpretation_id, source_derived_measurement_id)
    REFERENCES kai.source_derived_measurement_interpretations (interpretation_id, source_derived_measurement_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_derived_measurement_interpretations_label_check
    CHECK (indicator_label ~ '^[A-Za-z][A-Za-z0-9 ''()-]{0,79}$'),
  CONSTRAINT source_derived_measurement_interpretations_text_check
    CHECK (
      length(meaning_text) BETWEEN 1 AND 300
      AND (indicator_label || ' ' || meaning_text)
        !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    ),
  CONSTRAINT source_derived_measurement_interpretations_direction_check
    CHECK (score_direction IS NULL OR score_direction IN ('higher_is_better', 'lower_is_better', 'not_established')),
  CONSTRAINT source_derived_measurement_interpretations_basis_check
    CHECK (evidence_basis IN ('self_reported', 'organization_record', 'not_established')),
  CONSTRAINT source_derived_measurement_interpretations_status_check
    CHECK (interpretation_status = 'human_stated'),
  CONSTRAINT source_derived_measurement_interpretations_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- One linear history per measurement: one first interpretation, and each
-- interpretation superseded at most once.
CREATE UNIQUE INDEX IF NOT EXISTS source_derived_measurement_interpretations_history_unique
  ON kai.source_derived_measurement_interpretations (source_derived_measurement_id, (COALESCE(supersedes_interpretation_id::text, '')));

CREATE TABLE IF NOT EXISTS kai.evidence_derived_measurements (
  evidence_item_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_derived_measurement_id uuid NOT NULL,
  interpretation_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidence_derived_measurements_evidence_item_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_derived_measurements_measurement_fk
    FOREIGN KEY (source_derived_measurement_id, organization_id)
    REFERENCES kai.source_derived_measurements (source_derived_measurement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_derived_measurements_interpretation_fk
    FOREIGN KEY (interpretation_id, source_derived_measurement_id)
    REFERENCES kai.source_derived_measurement_interpretations (interpretation_id, source_derived_measurement_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_derived_measurements_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_derived_measurements_statement_unique
  ON kai.evidence_derived_measurements (source_derived_measurement_id, (COALESCE(interpretation_id::text, '')));

-- The three tables are append-only: a measurement, an interpretation and the
-- evidence a measurement is stated in are never rewritten or removed.
CREATE OR REPLACE FUNCTION kai.source_derived_measurement_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'source-derived measurement records are append-only (%)', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_source_derived_measurements_append_only ON kai.source_derived_measurements;
CREATE TRIGGER trg_source_derived_measurements_append_only
  BEFORE UPDATE OR DELETE ON kai.source_derived_measurements
  FOR EACH ROW EXECUTE FUNCTION kai.source_derived_measurement_append_only();
DROP TRIGGER IF EXISTS trg_source_derived_measurement_interpretations_append_only ON kai.source_derived_measurement_interpretations;
CREATE TRIGGER trg_source_derived_measurement_interpretations_append_only
  BEFORE UPDATE OR DELETE ON kai.source_derived_measurement_interpretations
  FOR EACH ROW EXECUTE FUNCTION kai.source_derived_measurement_append_only();
DROP TRIGGER IF EXISTS trg_evidence_derived_measurements_append_only ON kai.evidence_derived_measurements;
CREATE TRIGGER trg_evidence_derived_measurements_append_only
  BEFORE UPDATE OR DELETE ON kai.evidence_derived_measurements
  FOR EACH ROW EXECUTE FUNCTION kai.source_derived_measurement_append_only();

COMMIT;
