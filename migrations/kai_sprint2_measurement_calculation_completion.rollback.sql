BEGIN;

-- Rollback of kai_sprint2_measurement_calculation_completion. Refused while
-- any row depends on what it admitted; otherwise every touched definition is
-- restored exactly as the cross-source reach and reconciliation job
-- migrations left it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.source_derived_measurements
              WHERE calculation_method = 'kai_tabular_conditional_distinct_key_rate_v1'
                 OR basis_version = 'kai_tabular_verified_bytes_v1'
                 OR (measurement_family = 'cross_source_reach' AND worksheet_key IS NOT NULL))
    OR EXISTS (SELECT 1 FROM kai.source_derived_measurement_sources WHERE worksheet_key IS NOT NULL)
    OR EXISTS (SELECT 1 FROM kai.cross_source_reconciliation_jobs
                WHERE job_kind <> 'cross_source_reach' OR primary_worksheet_key IS NOT NULL OR reference_worksheet_key IS NOT NULL) THEN
    RAISE EXCEPTION 'measurement calculation completion rollback refused: rows depend on it';
  END IF;
END $$;

ALTER TABLE kai.cross_source_reconciliation_jobs
  DROP CONSTRAINT cross_source_reconciliation_jobs_kind_check,
  DROP CONSTRAINT cross_source_reconciliation_jobs_profile_sha_check,
  DROP CONSTRAINT cross_source_reconciliation_jobs_worksheet_check,
  DROP CONSTRAINT cross_source_reconciliation_jobs_interpretation_check,
  DROP COLUMN job_kind,
  DROP COLUMN primary_worksheet_key,
  DROP COLUMN reference_worksheet_key,
  DROP COLUMN interpretation,
  ALTER COLUMN reference_source_version_id SET NOT NULL,
  ALTER COLUMN reference_profile_canonical_sha256 SET NOT NULL,
  ADD CONSTRAINT cross_source_reconciliation_jobs_distinct_versions_check
    CHECK (primary_source_version_id <> reference_source_version_id),
  ADD CONSTRAINT cross_source_reconciliation_jobs_profile_sha_check
    CHECK (primary_profile_canonical_sha256 ~ '^[a-f0-9]{64}$' AND reference_profile_canonical_sha256 ~ '^[a-f0-9]{64}$');

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

DROP INDEX IF EXISTS kai.source_derived_measurement_sources_version_worksheet_unique;
ALTER TABLE kai.source_derived_measurement_sources
  DROP CONSTRAINT source_derived_measurement_sources_worksheet_key_check,
  DROP COLUMN worksheet_key,
  ADD CONSTRAINT source_derived_measurement_sources_version_unique
    UNIQUE (source_derived_measurement_id, source_version_id);

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
  DROP CONSTRAINT source_derived_measurements_rate_counts_check,
  ADD CONSTRAINT source_derived_measurements_rate_counts_check
    CHECK (
      measurement_family <> 'tabular_rate'
      OR (
        (component_counts->>'population_record_count')::bigint = denominator
        AND (component_counts->>'numerator_record_count')::bigint = numerator
        AND (component_counts->>'other_population_record_count')::bigint = denominator - numerator
      )
    );

COMMIT;
