-- KAI final production database repair packet
-- Step A: read-only preflight. Execute first.
-- Expected result: all rows return status PASS, then PRE_FLIGHT_READY.
-- Stop conditions: any FAIL row or raised exception. Do not run forward SQL.

WITH checks AS (
  SELECT 'package_2a_required_tables_present' AS check_name,
         CASE WHEN to_regclass('kai.engagement_requirement_sets') IS NOT NULL
                AND to_regclass('kai.engagements') IS NOT NULL
                AND to_regclass('kai.requirement_sets') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END AS status,
         'kai.engagement_requirement_sets, kai.engagements, and kai.requirement_sets must exist' AS detail
  UNION ALL
  SELECT 'package_2a_not_already_or_partially_applied',
         CASE WHEN NOT EXISTS (
                SELECT 1
                  FROM information_schema.columns
                 WHERE table_schema = 'kai'
                   AND table_name = 'engagement_requirement_sets'
                   AND column_name IN (
                     'reviewed_by',
                     'reviewed_by_role',
                     'reviewed_at',
                     'applicability_effective_state',
                     'supersedes_engagement_requirement_set_id',
                     'target_context_identity'
                   )
              )
              AND to_regclass('kai.ux_engagement_requirement_sets_package_2a_current_identity') IS NULL
              AND to_regclass('kai.ux_engagement_requirement_sets_package_2a_single_successor') IS NULL
              AND to_regclass('kai.ix_engagement_requirement_sets_package_2a_current_lookup') IS NULL
              AND to_regprocedure('kai.package_2a_reject_engagement_requirement_set_mutation()') IS NULL
              THEN 'PASS' ELSE 'FAIL' END,
         'Package 2A target surface must not already be applied or partially applied'
  UNION ALL
  SELECT 'package_2a_legacy_identity_constraint_present',
         CASE WHEN EXISTS (
                SELECT 1
                  FROM pg_constraint c
                  JOIN pg_class r ON r.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = r.relnamespace
                 WHERE n.nspname = 'kai'
                   AND r.relname = 'engagement_requirement_sets'
                   AND c.conname = 'engagement_requirement_sets_b1_1_identity_unique'
                   AND c.contype = 'u'
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'legacy B1.1 identity constraint must be present before Package 2A forward migration'
  UNION ALL
  SELECT 'gate_a_required_table_present',
         CASE WHEN to_regclass('kai.upload_policy_decision_replay') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         'kai.upload_policy_decision_replay must exist'
  UNION ALL
  SELECT 'gate_a_object_facts_columns_present',
         CASE WHEN NOT EXISTS (
                SELECT 1
                  FROM (VALUES
                    ('organization_id', 'uuid', 'uuid'),
                    ('intake_file_id', 'uuid', 'uuid'),
                    ('object_version_id', 'text', 'text'),
                    ('verified_checksum', 'text', 'text'),
                    ('verified_size_bytes', 'bigint', 'int8')
                  ) AS expected(column_name, data_type, udt_name)
                 WHERE NOT EXISTS (
                       SELECT 1
                         FROM information_schema.columns c
                        WHERE c.table_schema = 'kai'
                          AND c.table_name = 'upload_policy_decision_replay'
                          AND c.column_name = expected.column_name
                          AND c.data_type = expected.data_type
                          AND c.udt_name = expected.udt_name
                     )
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'Gate-A object-facts index columns must already exist on kai.upload_policy_decision_replay'
  UNION ALL
  SELECT 'gate_a_object_facts_index_absent',
         CASE WHEN to_regclass('kai.ix_upload_policy_decision_replay_gate_a_object_facts') IS NULL
              THEN 'PASS' ELSE 'FAIL' END,
         'bounded Gate-A index repair expects only the object-facts index to be absent'
)
SELECT 'A_READ_ONLY_PREFLIGHT' AS result_type, check_name, status, detail
FROM checks
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH checks AS (
      SELECT CASE WHEN to_regclass('kai.engagement_requirement_sets') IS NOT NULL
                    AND to_regclass('kai.engagements') IS NOT NULL
                    AND to_regclass('kai.requirement_sets') IS NOT NULL
                  THEN 'PASS' ELSE 'FAIL' END AS status
      UNION ALL
      SELECT CASE WHEN NOT EXISTS (
                    SELECT 1
                      FROM information_schema.columns
                     WHERE table_schema = 'kai'
                       AND table_name = 'engagement_requirement_sets'
                       AND column_name IN (
                         'reviewed_by',
                         'reviewed_by_role',
                         'reviewed_at',
                         'applicability_effective_state',
                         'supersedes_engagement_requirement_set_id',
                         'target_context_identity'
                       )
                  )
                  AND to_regclass('kai.ux_engagement_requirement_sets_package_2a_current_identity') IS NULL
                  AND to_regclass('kai.ux_engagement_requirement_sets_package_2a_single_successor') IS NULL
                  AND to_regclass('kai.ix_engagement_requirement_sets_package_2a_current_lookup') IS NULL
                  AND to_regprocedure('kai.package_2a_reject_engagement_requirement_set_mutation()') IS NULL
                  THEN 'PASS' ELSE 'FAIL' END
      UNION ALL
      SELECT CASE WHEN EXISTS (
                    SELECT 1
                      FROM pg_constraint c
                      JOIN pg_class r ON r.oid = c.conrelid
                      JOIN pg_namespace n ON n.oid = r.relnamespace
                     WHERE n.nspname = 'kai'
                       AND r.relname = 'engagement_requirement_sets'
                       AND c.conname = 'engagement_requirement_sets_b1_1_identity_unique'
                       AND c.contype = 'u'
                  )
                  THEN 'PASS' ELSE 'FAIL' END
      UNION ALL
      SELECT CASE WHEN to_regclass('kai.upload_policy_decision_replay') IS NOT NULL
                  THEN 'PASS' ELSE 'FAIL' END
      UNION ALL
      SELECT CASE WHEN NOT EXISTS (
                    SELECT 1
                      FROM (VALUES
                        ('organization_id', 'uuid', 'uuid'),
                        ('intake_file_id', 'uuid', 'uuid'),
                        ('object_version_id', 'text', 'text'),
                        ('verified_checksum', 'text', 'text'),
                        ('verified_size_bytes', 'bigint', 'int8')
                      ) AS expected(column_name, data_type, udt_name)
                     WHERE NOT EXISTS (
                           SELECT 1
                             FROM information_schema.columns c
                            WHERE c.table_schema = 'kai'
                              AND c.table_name = 'upload_policy_decision_replay'
                              AND c.column_name = expected.column_name
                              AND c.data_type = expected.data_type
                              AND c.udt_name = expected.udt_name
                         )
                  )
                  THEN 'PASS' ELSE 'FAIL' END
      UNION ALL
      SELECT CASE WHEN to_regclass('kai.ix_upload_policy_decision_replay_gate_a_object_facts') IS NULL
                  THEN 'PASS' ELSE 'FAIL' END
    )
    SELECT 1 FROM checks WHERE status <> 'PASS'
  ) THEN
    RAISE EXCEPTION 'A_READ_ONLY_PREFLIGHT failed: stop before production mutation';
  END IF;
  RAISE NOTICE 'PRE_FLIGHT_READY';
END $$;
