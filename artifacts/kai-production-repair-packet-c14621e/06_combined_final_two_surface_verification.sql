-- Step F: read-only combined final two-surface verification.
-- Expected result: all rows return status PASS, then FINAL_TWO_SURFACES_VERIFIED.
-- Stop conditions: any FAIL row or raised exception. Do not declare repair complete.

WITH package_2a_columns AS (
  SELECT count(*) = 6 AS ok
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
),
package_2a_long_constraints AS (
  SELECT count(*) FILTER (
           WHERE conname LIKE 'engagement_requirement_sets_package_2a_id_org_engagement_set_un%'
             AND contype = 'u'
             AND convalidated
             AND pg_get_constraintdef(c.oid) = 'UNIQUE (engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id)'
         ) = 1
         AND count(*) FILTER (
           WHERE conname LIKE 'engagement_requirement_sets_package_2a_reviewed_effective_consi%'
             AND contype = 'c'
             AND convalidated
             AND pg_get_constraintdef(c.oid) = 'CHECK (((applicability_effective_state = ''pending_review''::text) OR ((applicability_status = ''confirmed''::text) AND (reviewed_by IS NOT NULL) AND (reviewed_by_role IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (target_context_identity IS NOT NULL))))'
         ) = 1 AS ok
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'engagement_requirement_sets'
),
package_2a_named_objects AS (
  SELECT to_regclass('kai.ux_engagement_requirement_sets_package_2a_current_identity') IS NOT NULL
     AND to_regclass('kai.ux_engagement_requirement_sets_package_2a_single_successor') IS NOT NULL
     AND to_regclass('kai.ix_engagement_requirement_sets_package_2a_current_lookup') IS NOT NULL
     AND to_regprocedure('kai.package_2a_reject_engagement_requirement_set_mutation()') IS NOT NULL
     AND EXISTS (
           SELECT 1
             FROM pg_trigger t
             JOIN pg_class r ON r.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'engagement_requirement_sets'
              AND t.tgname = 'trg_package_2a_engagement_requirement_sets_append_only'
              AND NOT t.tgisinternal
         ) AS ok
),
gate_a_index AS (
  SELECT (
           SELECT array_agg(a.attname ORDER BY k.ord)
             FROM pg_class i
             JOIN pg_namespace n ON n.oid = i.relnamespace
             JOIN pg_index ix ON ix.indexrelid = i.oid
             JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
             JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
            WHERE n.nspname = 'kai'
              AND i.relname = 'ix_upload_policy_decision_replay_gate_a_object_facts'
         ) = ARRAY[
           'organization_id',
           'intake_file_id',
           'object_version_id',
           'verified_checksum',
           'verified_size_bytes'
         ]::text[] AS ok
),
checks AS (
  SELECT 'package_2a_columns' AS check_name,
         CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS status,
         'Package 2A authority columns exist' AS detail
    FROM package_2a_columns
  UNION ALL
  SELECT 'package_2a_63_byte_safe_constraints',
         CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
         'Package 2A long constraint names match using proven PostgreSQL 63-byte-safe prefix handling'
    FROM package_2a_long_constraints
  UNION ALL
  SELECT 'package_2a_named_objects',
         CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
         'Package 2A indexes, append-only function, and trigger exist'
    FROM package_2a_named_objects
  UNION ALL
  SELECT 'gate_a_object_facts_index',
         CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
         'Gate-A object-facts index exists with exact ordered columns'
    FROM gate_a_index
)
SELECT 'F_COMBINED_FINAL_TWO_SURFACE_VERIFICATION' AS result_type, check_name, status, detail
FROM checks
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH package_2a_columns AS (
      SELECT count(*) = 6 AS ok
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
    ),
    package_2a_long_constraints AS (
      SELECT count(*) FILTER (
               WHERE conname LIKE 'engagement_requirement_sets_package_2a_id_org_engagement_set_un%'
                 AND contype = 'u'
                 AND convalidated
                 AND pg_get_constraintdef(c.oid) = 'UNIQUE (engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id)'
             ) = 1
             AND count(*) FILTER (
               WHERE conname LIKE 'engagement_requirement_sets_package_2a_reviewed_effective_consi%'
                 AND contype = 'c'
                 AND convalidated
                 AND pg_get_constraintdef(c.oid) = 'CHECK (((applicability_effective_state = ''pending_review''::text) OR ((applicability_status = ''confirmed''::text) AND (reviewed_by IS NOT NULL) AND (reviewed_by_role IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (target_context_identity IS NOT NULL))))'
             ) = 1 AS ok
        FROM pg_constraint c
        JOIN pg_class r ON r.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = r.relnamespace
       WHERE n.nspname = 'kai'
         AND r.relname = 'engagement_requirement_sets'
    ),
    package_2a_named_objects AS (
      SELECT to_regclass('kai.ux_engagement_requirement_sets_package_2a_current_identity') IS NOT NULL
         AND to_regclass('kai.ux_engagement_requirement_sets_package_2a_single_successor') IS NOT NULL
         AND to_regclass('kai.ix_engagement_requirement_sets_package_2a_current_lookup') IS NOT NULL
         AND to_regprocedure('kai.package_2a_reject_engagement_requirement_set_mutation()') IS NOT NULL
         AND EXISTS (
               SELECT 1
                 FROM pg_trigger t
                 JOIN pg_class r ON r.oid = t.tgrelid
                 JOIN pg_namespace n ON n.oid = r.relnamespace
                WHERE n.nspname = 'kai'
                  AND r.relname = 'engagement_requirement_sets'
                  AND t.tgname = 'trg_package_2a_engagement_requirement_sets_append_only'
                  AND NOT t.tgisinternal
             ) AS ok
    ),
    gate_a_index AS (
      SELECT (
               SELECT array_agg(a.attname ORDER BY k.ord)
                 FROM pg_class i
                 JOIN pg_namespace n ON n.oid = i.relnamespace
                 JOIN pg_index ix ON ix.indexrelid = i.oid
                 JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
                 JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
                WHERE n.nspname = 'kai'
                  AND i.relname = 'ix_upload_policy_decision_replay_gate_a_object_facts'
             ) = ARRAY[
               'organization_id',
               'intake_file_id',
               'object_version_id',
               'verified_checksum',
               'verified_size_bytes'
             ]::text[] AS ok
    ),
    checks AS (
      SELECT ok FROM package_2a_columns
      UNION ALL SELECT ok FROM package_2a_long_constraints
      UNION ALL SELECT ok FROM package_2a_named_objects
      UNION ALL SELECT ok FROM gate_a_index
    )
    SELECT 1 FROM checks WHERE NOT ok
  ) THEN
    RAISE EXCEPTION 'F_COMBINED_FINAL_TWO_SURFACE_VERIFICATION failed';
  END IF;
  RAISE NOTICE 'FINAL_TWO_SURFACES_VERIFIED';
END $$;
