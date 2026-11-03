BEGIN;

-- Refuse reversal once any cross-source measurement or contributing source
-- exists. On an unused installation, drop the contributing-source table and
-- restore the source-derived measurement family and arithmetic CHECKs
-- exactly as the source-derived measurement migration created them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.source_derived_measurement_sources)
    OR EXISTS (SELECT 1 FROM kai.source_derived_measurements WHERE measurement_family = 'cross_source_reach') THEN
    RAISE EXCEPTION 'cross-source reach rollback refused: cross-source measurements or contributing sources exist';
  END IF;
END $$;

DROP TABLE IF EXISTS kai.source_derived_measurement_sources;
DROP FUNCTION IF EXISTS kai.source_derived_measurement_source_admitted();

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
      )
    );

COMMIT;
