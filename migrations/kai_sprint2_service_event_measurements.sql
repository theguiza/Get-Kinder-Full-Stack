BEGIN;

-- KAI single-source service-delivery measurements (owner directive
-- 2026-11-19: complete service-delivery measurement). Additive and
-- re-runnable: every existing row stays valid and every existing branch of
-- each widened CHECK is kept exactly.
--
--   * kai.source_derived_measurements admits the family `service_events`
--     with method kai_single_source_service_events_v1 and basis
--     kai_service_event_records_v1: one service-record table (a CSV or one
--     worksheet) reconciled record by record from its verified upload, with no
--     participant register. It is neither a raw row count (tabular_count) nor
--     linked reach (cross_source_reach), and it records no contributing source
--     (the existing contributing-source trigger keeps refusing one).
--   * source_derived_measurements_service_funnel_check pins its funnel:
--     physical records -> identities (excess duplicate copies counted once,
--     conflicting identities excluded whole) -> completed / not completed ->
--     eligibility exclusions -> undated and out-of-period exclusions ->
--     in-scope encounters, with distinct entities bounded by them, the
--     finding basis, the duplicate policy, a status role and a day-precision
--     Project period (or none).
--   * The existing tabular-count and linked-reach arithmetic branches now
--     require their own counts to be present (a missing JSON key no longer
--     evaluates to NULL and passes), so a row of one method cannot be stored
--     as another. Every existing row already holds these counts.
--   * A planned-target decision may name such a measurement as its actual
--     through the existing trigger: it is a count (unit_kind count), and its
--     exact Project period is definition.period.

DO $$
BEGIN
  IF to_regclass('kai.source_derived_measurements') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'kai.source_derived_measurements'::regclass AND conname = 'source_derived_measurements_method_family_check'
         AND pg_get_constraintdef(oid) LIKE '%kai_tabular_conditional_distinct_key_rate_v1%'
    ) THEN
    RAISE EXCEPTION 'the measurement calculation completion migration is required before the service-event measurement migration';
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
        AND basis_version IN ('kai_tabular_measurement_basis_v1', 'kai_tabular_verified_bytes_v1'))
      OR (measurement_family = 'tabular_rate'
        AND calculation_method IN ('kai_tabular_conditional_record_rate_v1', 'kai_tabular_conditional_distinct_key_rate_v1')
        AND basis_version IN ('kai_tabular_measurement_basis_v1', 'kai_tabular_verified_bytes_v1'))
      OR (measurement_family = 'cross_source_reach' AND calculation_method = 'kai_cross_source_linked_reach_v1'
        AND basis_version = 'kai_cross_source_reconciliation_v1')
      OR (measurement_family = 'service_events' AND calculation_method = 'kai_single_source_service_events_v1'
        AND basis_version = 'kai_service_event_records_v1')
    ),
  DROP CONSTRAINT source_derived_measurements_arithmetic_check,
  ADD CONSTRAINT source_derived_measurements_arithmetic_check
    CHECK (
      measured_value >= 0
      AND numerator = measured_value
      AND (
        (measurement_family = 'tabular_count' AND denominator IS NULL AND percentage IS NULL
          AND component_counts ? 'matching_record_count' AND jsonb_typeof(component_counts->'matching_record_count') = 'number'
          AND measured_value <= (component_counts->>'matching_record_count')::bigint)
        OR (measurement_family IN ('paired_outcome_change', 'tabular_rate') AND denominator > 0
          AND numerator <= denominator
          AND percentage = round(numerator * 100.0 / denominator, 2))
        OR (measurement_family = 'cross_source_reach' AND denominator IS NULL AND percentage IS NULL
          AND jsonb_typeof(definition->'measured_component') = 'string'
          -- Every funnel count is present, so a row of another method cannot pass as linked reach.
          AND component_counts ?& ARRAY[
            'physical_record_count', 'blank_event_identifier_record_count', 'duplicate_group_count', 'duplicate_member_record_count',
            'excess_copy_record_count', 'conflicting_event_identity_count', 'distinct_event_count', 'consistent_event_count',
            'completed_event_count', 'completed_without_date_count', 'completed_outside_period_count', 'in_period_completed_event_count',
            'blank_participant_identifier_event_count', 'unmatched_event_count', 'eligible_encounter_count', 'distinct_person_count',
            'multi_group_person_count']
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
        -- NULL-safe: a missing key or value refuses the row instead of passing it.
        OR (measurement_family = 'service_events' AND COALESCE(denominator IS NULL AND percentage IS NULL
          AND definition->>'measured_component' IN ('eligible_encounter_count', 'group_encounter_count', 'distinct_entity_count', 'group_distinct_entity_count')
          AND jsonb_typeof(component_counts->(definition->>'measured_component')) = 'number'
          AND measured_value = (component_counts->>(definition->>'measured_component'))::bigint, false))
      )
    ),
  DROP CONSTRAINT IF EXISTS source_derived_measurements_service_funnel_check,
  ADD CONSTRAINT source_derived_measurements_service_funnel_check
    CHECK (
      measurement_family <> 'service_events'
      -- NULL-safe: any missing key or value refuses the row instead of passing it.
      OR COALESCE((
        component_counts ?& ARRAY[
          'physical_record_count', 'blank_event_identifier_record_count', 'duplicate_group_count', 'duplicate_member_record_count',
          'excess_copy_record_count', 'conflicting_event_identity_count', 'conflicting_record_count', 'distinct_event_count',
          'consistent_event_count', 'completed_status_record_count', 'completed_event_count', 'not_completed_event_count',
          'eligibility_excluded_event_count', 'eligible_completed_event_count', 'completed_without_date_count',
          'completed_outside_period_count', 'eligible_encounter_count', 'blank_entity_identifier_event_count', 'distinct_entity_count',
          'multi_programme_entity_count']
        AND (component_counts->>'excess_copy_record_count')::bigint
          = (component_counts->>'duplicate_member_record_count')::bigint - (component_counts->>'duplicate_group_count')::bigint
        AND (component_counts->>'distinct_event_count')::bigint
          = (component_counts->>'physical_record_count')::bigint - (component_counts->>'blank_event_identifier_record_count')::bigint
            - (component_counts->>'excess_copy_record_count')::bigint
        AND (component_counts->>'consistent_event_count')::bigint
          = (component_counts->>'distinct_event_count')::bigint - (component_counts->>'conflicting_event_identity_count')::bigint
        AND (component_counts->>'completed_event_count')::bigint + (component_counts->>'not_completed_event_count')::bigint
          = (component_counts->>'consistent_event_count')::bigint
        AND (component_counts->>'completed_event_count')::bigint <= (component_counts->>'completed_status_record_count')::bigint
        AND (component_counts->>'eligible_completed_event_count')::bigint
          = (component_counts->>'completed_event_count')::bigint - (component_counts->>'eligibility_excluded_event_count')::bigint
        AND (component_counts->>'eligible_encounter_count')::bigint
          = (component_counts->>'eligible_completed_event_count')::bigint - (component_counts->>'completed_without_date_count')::bigint
            - (component_counts->>'completed_outside_period_count')::bigint
        AND (component_counts->>'distinct_entity_count')::bigint
          <= (component_counts->>'eligible_encounter_count')::bigint - (component_counts->>'blank_entity_identifier_event_count')::bigint
        AND (component_counts->>'multi_programme_entity_count')::bigint <= (component_counts->>'distinct_entity_count')::bigint
        AND definition->>'finding_basis' IN ('service_encounters', 'source_values')
        AND definition->>'duplicate_policy' = 'consistent_copies_counted_once_conflicting_identities_excluded'
        AND jsonb_typeof(definition->'roles'->'status') = 'object'
        AND definition->'roles'->'status'->>'field_key' ~ '^field_[1-9][0-9]{0,3}$'
        AND (
          (jsonb_typeof(definition->'period') = 'null'
            AND (component_counts->>'completed_without_date_count')::bigint = 0
            AND (component_counts->>'completed_outside_period_count')::bigint = 0)
          OR (jsonb_typeof(definition->'period') = 'object'
            AND definition->'period'->>'period_source' = 'engagement_reporting_period'
            AND definition->'period'->>'precision' = 'day'
            AND definition->'period'->>'period_start' ~ '^\d{4}-\d{2}-\d{2}$'
            AND definition->'period'->>'period_end' ~ '^\d{4}-\d{2}-\d{2}$'
            AND definition->'period'->>'period_start' <= definition->'period'->>'period_end'
            AND jsonb_typeof(definition->'roles'->'service_date') = 'object')
        )
        -- A record-mode finding (no encounter identifier) has one identity per record.
        AND (jsonb_typeof(definition->'roles'->'encounter_identifier') = 'object'
          OR ((component_counts->>'distinct_event_count')::bigint = (component_counts->>'physical_record_count')::bigint
            AND (component_counts->>'duplicate_group_count')::bigint = 0
            AND (component_counts->>'conflicting_event_identity_count')::bigint = 0))
        -- Households, people or families are stated only with an entity identifier.
        AND (definition->>'metric' NOT IN ('distinct_entities_served', 'group_distinct_entities_served')
          OR jsonb_typeof(definition->'roles'->'entity_identifier') = 'object')
      ), false)
    );

COMMIT;
