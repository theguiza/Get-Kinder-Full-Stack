BEGIN;

-- Rollback of kai_sprint2_service_event_measurements. Refused while any
-- service_events measurement exists (its evidence, claims, planned-target
-- decisions and reports depend on it); otherwise the method/family and
-- arithmetic CHECKs are restored exactly as the measurement calculation
-- completion and cross-source reach migrations left them, and the service
-- funnel CHECK is removed.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.source_derived_measurements
              WHERE measurement_family = 'service_events' OR calculation_method = 'kai_single_source_service_events_v1') THEN
    RAISE EXCEPTION 'service-event measurement rollback refused: service_events measurements exist';
  END IF;
END $$;

ALTER TABLE kai.source_derived_measurements
  DROP CONSTRAINT IF EXISTS source_derived_measurements_service_funnel_check,
  DROP CONSTRAINT source_derived_measurements_method_family_check,
  ADD CONSTRAINT source_derived_measurements_method_family_check
    CHECK (
      (measurement_family = 'paired_outcome_change' AND calculation_method = 'p1_xlsx_paired_baseline_followup_numeric_change_v1'
        AND basis_version = 'kai_xlsx_paired_outcome_basis_v1' AND worksheet_key IS NOT NULL)
      OR (measurement_family = 'tabular_count'
        AND calculation_method IN ('kai_tabular_conditional_record_count_v1', 'kai_tabular_conditional_distinct_key_count_v1')
        AND basis_version IN ('kai_tabular_measurement_basis_v1', 'kai_tabular_verified_bytes_v1'))
      OR (measurement_family = 'tabular_rate'
        AND calculation_method IN ('kai_tabular_conditional_record_rate_v1', 'kai_tabular_conditional_distinct_key_rate_v1')
        AND basis_version IN ('kai_tabular_measurement_basis_v1', 'kai_tabular_verified_bytes_v1'))
      OR (measurement_family = 'cross_source_reach' AND calculation_method = 'kai_cross_source_linked_reach_v1'
        AND basis_version = 'kai_cross_source_reconciliation_v1')
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

COMMIT;
