-- Read-only catalog verification of kai_sprint2_service_event_measurements.
-- Run inside a READ ONLY transaction (for example pgAdmin: BEGIN READ ONLY;
-- <this file>; ROLLBACK;). It reads pg_catalog only: no table rows, no
-- writes. OVERALL is PASS only when the migration's postconditions hold
-- exactly as the repository defines them (PostgreSQL 16 definition text).
WITH expected(constraint_name, expected_md5, meaning) AS (
  VALUES
    ('source_derived_measurements_method_family_check', '10e72f5ab1d8df61654715f76c3a8d88', 'admits service_events with kai_single_source_service_events_v1 / kai_service_event_records_v1 beside every earlier method'),
    ('source_derived_measurements_arithmetic_check', 'a0d4c7ee9a51cfa712d42f7b6c893dc7', 'service measured value equals its measured component; count and linked-reach counts must be present'),
    ('source_derived_measurements_service_funnel_check', 'e0f990a969e7a5f8b1ac334782332901', 'the service funnel, finding basis, duplicate policy, status role and day-precision period (NULL-safe)')
), checks(check_id, status, detail) AS (
  SELECT 'constraint.' || e.constraint_name,
         CASE WHEN c.contype = 'c' AND c.convalidated AND NOT c.condeferrable
                   AND md5(jsonb_build_array(pg_catalog.pg_get_constraintdef(c.oid), c.convalidated, c.condeferrable)::text) = e.expected_md5
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN c.oid IS NULL THEN 'Missing CHECK: ' || e.meaning ELSE e.meaning END
    FROM expected e LEFT JOIN pg_catalog.pg_constraint c
      ON c.conrelid = to_regclass('kai.source_derived_measurements') AND c.conname = e.constraint_name
  UNION ALL
  SELECT 'trigger.contributing_sources_cross_source_only',
         CASE WHEN position('cross_source_reach' IN coalesce(pg_catalog.pg_get_functiondef(to_regprocedure('kai.source_derived_measurement_source_admitted()')), '')) > 0
              THEN 'PASS' ELSE 'FAIL' END,
         'A contributing source is still refused for any family but cross_source_reach (a service measurement is single source)'
  UNION ALL
  SELECT 'trigger.planned_target_actual_period',
         CASE WHEN to_regprocedure('kai.validate_planned_target_integrity()') IS NULL THEN 'PASS'
              WHEN position($q$a.definition->'period'->>'period_start'$q$ IN pg_catalog.pg_get_functiondef(to_regprocedure('kai.validate_planned_target_integrity()'))) > 0 THEN 'PASS'
              ELSE 'FAIL' END,
         'A confirmed planned-target actual is checked against definition.period (service measurements store their exact Project period there)'
)
SELECT check_id, status, detail FROM (
  SELECT 'OVERALL' AS check_id, CASE WHEN bool_and(status = 'PASS') THEN 'PASS' ELSE 'FAIL' END AS status,
         count(*) FILTER (WHERE status = 'FAIL')::text || ' failed out of ' || count(*)::text || ' checks' AS detail FROM checks
  UNION ALL SELECT * FROM checks
  UNION ALL SELECT 'INFO.connection', 'INFO', 'database=' || current_database() || '; PostgreSQL=' || current_setting('server_version')
) result
ORDER BY CASE WHEN check_id = 'OVERALL' THEN 0 WHEN status = 'FAIL' THEN 1 WHEN status = 'INFO' THEN 3 ELSE 2 END, check_id;
