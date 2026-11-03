BEGIN;

-- KAI Measurement MVP: cross-source linked reach - a measurement calculated
-- from two promoted source versions (service events linked to a participant
-- register) - in the same source-derived measurement tables. Additive only:
--   * kai.source_derived_measurements admits one more family,
--     cross_source_reach (method kai_cross_source_linked_reach_v1, basis
--     kai_cross_source_reconciliation_v1, no worksheet), and its arithmetic
--     CHECK gains that family's reconciliation funnel. Every existing branch
--     of both CHECKs is kept verbatim, so every existing row stays valid.
--   * kai.source_derived_measurement_sources: every source version a
--     cross-source measurement combines - its primary version (the
--     measurement's and its evidence item's own source_version_id) and its
--     reference version - each with the profile it was calculated from and
--     the fields it read. Append-only; a trigger admits rows only for a
--     cross_source_reach measurement, the primary row only for its own
--     version and the reference row only for another.
-- kai.evidence_items, kai.source_locators, the interpretation and evidence
-- link tables, the record-count tables and every existing row are not read,
-- rewritten or re-keyed. The evidence of a cross-source measurement uses the
-- existing source_derived_measurement evidence type and fields locator.

DO $$
BEGIN
  IF to_regclass('kai.source_derived_measurements') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'kai.source_derived_measurements'::regclass AND conname = 'source_derived_measurements_method_family_check'
    ) THEN
    RAISE EXCEPTION 'the source-derived measurement migration is required before the cross-source reach migration';
  END IF;
END $$;

ALTER TABLE kai.source_derived_measurements
  DROP CONSTRAINT source_derived_measurements_method_family_check,
  ADD CONSTRAINT source_derived_measurements_method_family_check
    CHECK (
      (measurement_family = 'paired_outcome_change' AND calculation_method = 'p1_xlsx_paired_baseline_followup_numeric_change_v1'
        AND basis_version = 'kai_xlsx_paired_outcome_basis_v1' AND worksheet_key IS NOT NULL)
      OR (measurement_family = 'tabular_count'
        AND calculation_method IN ('kai_tabular_conditional_record_count_v1', 'kai_tabular_conditional_distinct_key_count_v1')
        AND basis_version = 'kai_tabular_measurement_basis_v1')
      OR (measurement_family = 'tabular_rate' AND calculation_method = 'kai_tabular_conditional_record_rate_v1'
        AND basis_version = 'kai_tabular_measurement_basis_v1')
      OR (measurement_family = 'cross_source_reach' AND calculation_method = 'kai_cross_source_linked_reach_v1'
        AND basis_version = 'kai_cross_source_reconciliation_v1' AND worksheet_key IS NULL)
    ),
  DROP CONSTRAINT source_derived_measurements_arithmetic_check,
  ADD CONSTRAINT source_derived_measurements_arithmetic_check
    CHECK (
      measured_value >= 0
      AND numerator = measured_value
      AND (
        (measurement_family = 'tabular_count' AND denominator IS NULL AND percentage IS NULL
          AND measured_value <= (component_counts->>'matching_record_count')::bigint)
        OR (measurement_family IN ('paired_outcome_change', 'tabular_rate') AND denominator > 0
          AND numerator <= denominator
          AND percentage = round(numerator * 100.0 / denominator, 2))
        OR (measurement_family = 'cross_source_reach' AND denominator IS NULL AND percentage IS NULL
          AND jsonb_typeof(definition->'measured_component') = 'string'
          AND measured_value = (component_counts->>(definition->>'measured_component'))::bigint
          AND (component_counts->>'excess_copy_record_count')::bigint
            = (component_counts->>'duplicate_member_record_count')::bigint - (component_counts->>'duplicate_group_count')::bigint
          AND (component_counts->>'distinct_event_count')::bigint
            = (component_counts->>'physical_record_count')::bigint - (component_counts->>'blank_event_identifier_record_count')::bigint
              - (component_counts->>'excess_copy_record_count')::bigint
          AND (component_counts->>'consistent_event_count')::bigint
            = (component_counts->>'distinct_event_count')::bigint - (component_counts->>'conflicting_event_identity_count')::bigint
          AND (component_counts->>'completed_event_count')::bigint <= (component_counts->>'consistent_event_count')::bigint
          AND (component_counts->>'in_period_completed_event_count')::bigint
            = (component_counts->>'completed_event_count')::bigint - (component_counts->>'completed_without_date_count')::bigint
              - (component_counts->>'completed_outside_period_count')::bigint
          AND (component_counts->>'eligible_encounter_count')::bigint
            = (component_counts->>'in_period_completed_event_count')::bigint
              - (component_counts->>'blank_participant_identifier_event_count')::bigint - (component_counts->>'unmatched_event_count')::bigint
          AND (component_counts->>'distinct_person_count')::bigint <= (component_counts->>'eligible_encounter_count')::bigint
          AND (component_counts->>'multi_group_person_count')::bigint <= (component_counts->>'distinct_person_count')::bigint)
      )
    );

CREATE TABLE IF NOT EXISTS kai.source_derived_measurement_sources (
  source_derived_measurement_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_role text NOT NULL,
  profile_canonical_sha256 text NOT NULL,
  field_keys jsonb NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_derived_measurement_sources_pkey
    PRIMARY KEY (source_derived_measurement_id, source_role),
  CONSTRAINT source_derived_measurement_sources_version_unique
    UNIQUE (source_derived_measurement_id, source_version_id),
  CONSTRAINT source_derived_measurement_sources_measurement_fk
    FOREIGN KEY (source_derived_measurement_id, organization_id)
    REFERENCES kai.source_derived_measurements (source_derived_measurement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_derived_measurement_sources_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_derived_measurement_sources_role_check
    CHECK (source_role IN ('primary', 'reference')),
  CONSTRAINT source_derived_measurement_sources_profile_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_derived_measurement_sources_field_keys_check
    CHECK (jsonb_typeof(field_keys) = 'array' AND jsonb_array_length(field_keys) BETWEEN 1 AND 8)
);

-- A contributing-source row belongs to a cross-source measurement; the
-- primary row is that measurement's own version and profile, the reference
-- row another version.
CREATE OR REPLACE FUNCTION kai.source_derived_measurement_source_admitted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  measurement record;
BEGIN
  SELECT measurement_family, source_version_id, profile_canonical_sha256
    INTO measurement
    FROM kai.source_derived_measurements
   WHERE source_derived_measurement_id = NEW.source_derived_measurement_id
     AND organization_id = NEW.organization_id;
  IF NOT FOUND OR measurement.measurement_family <> 'cross_source_reach' THEN
    RAISE EXCEPTION 'a contributing source is recorded only for a cross-source measurement'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.source_role = 'primary') <> (NEW.source_version_id = measurement.source_version_id)
    OR (NEW.source_role = 'primary' AND NEW.profile_canonical_sha256 <> measurement.profile_canonical_sha256) THEN
    RAISE EXCEPTION 'the primary contributing source is the measurement''s own version and profile; a reference source is another version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_source_derived_measurement_sources_admitted ON kai.source_derived_measurement_sources;
CREATE TRIGGER trg_source_derived_measurement_sources_admitted
  BEFORE INSERT ON kai.source_derived_measurement_sources
  FOR EACH ROW EXECUTE FUNCTION kai.source_derived_measurement_source_admitted();
DROP TRIGGER IF EXISTS trg_source_derived_measurement_sources_append_only ON kai.source_derived_measurement_sources;
CREATE TRIGGER trg_source_derived_measurement_sources_append_only
  BEFORE UPDATE OR DELETE ON kai.source_derived_measurement_sources
  FOR EACH ROW EXECUTE FUNCTION kai.source_derived_measurement_append_only();

CREATE INDEX IF NOT EXISTS idx_source_derived_measurement_sources_version
  ON kai.source_derived_measurement_sources (organization_id, source_version_id);

COMMIT;
