-- Step E: read-only Gate-A post-forward verification.
-- Expected result: all rows return status PASS, then GATE_A_INDEX_ONLY_FORWARD_VERIFIED.
-- Stop conditions: any FAIL row or raised exception. Do not proceed to final verification.

WITH object_facts_index AS (
  SELECT c.oid AS index_oid,
         pg_get_indexdef(c.oid) AS indexdef
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'kai'
     AND c.relname = 'ix_upload_policy_decision_replay_gate_a_object_facts'
),
ordered_columns AS (
  SELECT a.attname AS column_name,
         k.ord
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    JOIN pg_index ix ON ix.indexrelid = i.oid
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'kai'
     AND i.relname = 'ix_upload_policy_decision_replay_gate_a_object_facts'
),
checks AS (
  SELECT 'object_facts_index_definition' AS check_name,
         CASE WHEN EXISTS (
                SELECT 1
                  FROM object_facts_index
                 WHERE indexdef = 'CREATE INDEX ix_upload_policy_decision_replay_gate_a_object_facts ON kai.upload_policy_decision_replay USING btree (organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes)'
              )
              THEN 'PASS' ELSE 'FAIL' END AS status,
         'Gate-A object-facts index definition must match bounded index-only repair' AS detail
  UNION ALL
  SELECT 'object_facts_index_ordered_columns',
         CASE WHEN (
                SELECT array_agg(column_name ORDER BY ord)
                  FROM ordered_columns
              ) = ARRAY[
                'organization_id',
                'intake_file_id',
                'object_version_id',
                'verified_checksum',
                'verified_size_bytes'
              ]::text[]
              THEN 'PASS' ELSE 'FAIL' END,
         'Gate-A object-facts index columns must match the proven ordered column list'
  UNION ALL
  SELECT 'replay_table_columns_still_present',
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
         'repair-referenced kai.upload_policy_decision_replay columns remain present'
)
SELECT 'E_GATE_A_POST_FORWARD_VERIFICATION' AS result_type, check_name, status, detail
FROM checks
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH object_facts_index AS (
      SELECT c.oid AS index_oid,
             pg_get_indexdef(c.oid) AS indexdef
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'kai'
         AND c.relname = 'ix_upload_policy_decision_replay_gate_a_object_facts'
    ),
    ordered_columns AS (
      SELECT a.attname AS column_name,
             k.ord
        FROM pg_class i
        JOIN pg_namespace n ON n.oid = i.relnamespace
        JOIN pg_index ix ON ix.indexrelid = i.oid
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
       WHERE n.nspname = 'kai'
         AND i.relname = 'ix_upload_policy_decision_replay_gate_a_object_facts'
    ),
    checks AS (
      SELECT EXISTS (
        SELECT 1
          FROM object_facts_index
         WHERE indexdef = 'CREATE INDEX ix_upload_policy_decision_replay_gate_a_object_facts ON kai.upload_policy_decision_replay USING btree (organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes)'
      ) AS ok
      UNION ALL
      SELECT (
        SELECT array_agg(column_name ORDER BY ord)
          FROM ordered_columns
      ) = ARRAY[
        'organization_id',
        'intake_file_id',
        'object_version_id',
        'verified_checksum',
        'verified_size_bytes'
      ]::text[]
      UNION ALL
      SELECT NOT EXISTS (
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
    )
    SELECT 1 FROM checks WHERE NOT ok
  ) THEN
    RAISE EXCEPTION 'E_GATE_A_POST_FORWARD_VERIFICATION failed: stop before final verification';
  END IF;
  RAISE NOTICE 'GATE_A_INDEX_ONLY_FORWARD_VERIFIED';
END $$;
