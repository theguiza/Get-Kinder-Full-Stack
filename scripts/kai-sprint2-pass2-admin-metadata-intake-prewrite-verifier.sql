-- A parse, planning, permission, missing-object, or execution error is
-- SQL_EXECUTION_FAILURE. It is never PASS and may prevent any result set.
WITH expected AS (
  SELECT
    'NCWS-P0-PASS2-METADATA-001'::text AS batch_code,
    'kai-p0-pass2-ncws-batch-001'::text AS batch_idempotency_key,
    'kai-p0-pass2-ncws-file-reservation-001'::text AS file_idempotency_key,
    'pass2_admin_metadata_intake_verification'::text AS p0_pass,
    'KAI_MVP_Sprint2_P0_Pass2_Production_Synthetic_Metadata_Write_Gate_Plan_v0.1.1'::text AS gate_plan,
    'a5d17c5a-c55f-43af-9b21-fe63aafe733f'::uuid AS organization_id,
    '2e426ea1-2be3-4e48-b80f-9783ddbacda0'::uuid AS engagement_id
),
required_columns AS (
  SELECT *
  FROM (VALUES
    ('PREWRITE_BATCH_CATALOG_COMPATIBLE', 'intake_batches', 'intake_batch_id'),
    ('PREWRITE_BATCH_CATALOG_COMPATIBLE', 'intake_batches', 'organization_id'),
    ('PREWRITE_BATCH_CATALOG_COMPATIBLE', 'intake_batches', 'engagement_id'),
    ('PREWRITE_BATCH_CATALOG_COMPATIBLE', 'intake_batches', 'batch_code'),
    ('PREWRITE_BATCH_CATALOG_COMPATIBLE', 'intake_batches', 'idempotency_key'),
    ('PREWRITE_BATCH_CATALOG_COMPATIBLE', 'intake_batches', 'batch_metadata'),
    ('PREWRITE_FILE_CATALOG_COMPATIBLE', 'intake_files', 'intake_file_id'),
    ('PREWRITE_FILE_CATALOG_COMPATIBLE', 'intake_files', 'intake_batch_id'),
    ('PREWRITE_FILE_CATALOG_COMPATIBLE', 'intake_files', 'organization_id'),
    ('PREWRITE_FILE_CATALOG_COMPATIBLE', 'intake_files', 'engagement_id'),
    ('PREWRITE_FILE_CATALOG_COMPATIBLE', 'intake_files', 'file_metadata'),
    ('PREWRITE_FILE_CATALOG_COMPATIBLE', 'intake_files', 'checksum')
  ) AS required(check_name, table_name, column_name)
),
catalog_columns AS (
  SELECT c.relname AS table_name,
         a.attname AS column_name
  FROM pg_catalog.pg_namespace n
  JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'kai'
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND a.attisdropped IS FALSE
),
catalog_checks AS (
  SELECT 'CHECK' AS result_type,
         r.check_name AS check_name,
         'catalog' AS object_name,
         CASE WHEN count(c.column_name) = count(*) THEN 'PASS' ELSE 'FAIL' END AS status,
         'Required relation and column compatibility was evaluated.' AS detail
  FROM required_columns r
  LEFT JOIN catalog_columns c
    ON c.table_name = r.table_name
   AND c.column_name = r.column_name
  GROUP BY r.check_name
),
required_indexes AS (
  SELECT *
  FROM (VALUES
    (
      'PREWRITE_INDEX_BATCH_ORG_IDEMPOTENCY_EXACT',
      'ux_intake_batches_org_idempotency_key',
      'intake_batches',
      ARRAY['organization_id', 'idempotency_key']::text[],
      NULL::text
    ),
    (
      'PREWRITE_INDEX_BATCH_ORG_CODE_EXACT',
      'ux_intake_batches_org_batch_code',
      'intake_batches',
      ARRAY['organization_id', 'batch_code']::text[],
      NULL::text
    ),
    (
      'PREWRITE_INDEX_FILE_ORG_CHECKSUM_DEFAULT_EXACT',
      'ux_intake_files_org_checksum_default',
      'intake_files',
      ARRAY['organization_id', 'checksum']::text[],
      '(checksum IS NOT NULL)'::text
    )
  ) AS required(check_name, index_name, table_name, key_columns, predicate_expression)
),
catalog_indexes AS (
  SELECT ni.nspname AS index_schema,
         nt.nspname AS table_schema,
         ic.relname AS index_name,
         tc.relname AS table_name,
         i.indisunique,
         i.indisvalid,
         i.indisready,
         i.indislive,
         i.indnatts,
         i.indnkeyatts,
         i.indexprs,
         array_agg(a.attname ORDER BY key_position.ordinality) AS key_columns,
         pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate_expression
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
  JOIN pg_catalog.pg_namespace ni ON ni.oid = ic.relnamespace
  JOIN pg_catalog.pg_class tc ON tc.oid = i.indrelid
  JOIN pg_catalog.pg_namespace nt ON nt.oid = tc.relnamespace
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS key_position(attnum, ordinality)
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = tc.oid
   AND a.attnum = key_position.attnum
  WHERE ic.relname IN (SELECT index_name FROM required_indexes)
  GROUP BY ni.nspname,
           nt.nspname,
           ic.relname,
           tc.relname,
           i.indisunique,
           i.indisvalid,
           i.indisready,
           i.indislive,
           i.indnatts,
           i.indnkeyatts,
           i.indexprs,
           i.indpred,
           i.indrelid
),
index_checks AS (
  SELECT 'CHECK' AS result_type,
         r.check_name AS check_name,
         r.index_name AS object_name,
         CASE WHEN c.index_schema = 'kai'
                    AND c.table_schema = 'kai'
                    AND c.table_name = r.table_name
                    AND c.indisunique IS TRUE
                    AND c.indisvalid IS TRUE
                    AND c.indisready IS TRUE
                    AND c.indislive IS TRUE
                    AND c.indnatts = c.indnkeyatts
                    AND c.indexprs IS NULL
                    AND c.key_columns = r.key_columns
                    AND c.predicate_expression IS NOT DISTINCT FROM r.predicate_expression
              THEN 'PASS' ELSE 'FAIL' END AS status,
         'Required unique index structure was evaluated.' AS detail
  FROM required_indexes r
  LEFT JOIN catalog_indexes c ON c.index_name = r.index_name
),
batch_marker_count AS (
  SELECT count(*) AS row_count
  FROM kai.intake_batches b
  CROSS JOIN expected e
  WHERE b.organization_id = e.organization_id
    AND b.engagement_id = e.engagement_id
    AND b.batch_code = e.batch_code
    AND b.idempotency_key = e.batch_idempotency_key
    AND b.batch_metadata->>'p0_pass' = e.p0_pass
    AND b.batch_metadata->>'gate_plan' = e.gate_plan
),
file_marker_count AS (
  SELECT count(*) AS row_count
  FROM kai.intake_files f
  CROSS JOIN expected e
  WHERE f.organization_id = e.organization_id
    AND f.engagement_id = e.engagement_id
    AND f.file_metadata->>'idempotency_key' = e.file_idempotency_key
    AND f.file_metadata->>'p0_pass' = e.p0_pass
    AND f.file_metadata->>'gate_plan' = e.gate_plan
),
marker_checks AS (
  SELECT 'CHECK' AS result_type,
         'PREWRITE_EXACT_BATCH_MARKER_COUNT_ZERO' AS check_name,
         'kai.intake_batches' AS object_name,
         CASE WHEN row_count = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         'Exact composite batch marker count must be zero.' AS detail
  FROM batch_marker_count
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'PREWRITE_EXACT_FILE_MARKER_COUNT_ZERO' AS check_name,
         'kai.intake_files' AS object_name,
         CASE WHEN row_count = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         'Exact composite file marker count must be zero.' AS detail
  FROM file_marker_count
),
checks AS (
  SELECT * FROM catalog_checks
  UNION ALL
  SELECT * FROM index_checks
  UNION ALL
  SELECT * FROM marker_checks
),
observations AS (
  SELECT 'OBSERVATION' AS result_type,
         'PREWRITE_AUDIT_SCHEMA_VOCABULARY_COMPATIBILITY' AS check_name,
         'audit_catalog' AS object_name,
         'INFO' AS status,
         CASE WHEN (
           SELECT count(*)
           FROM pg_catalog.pg_namespace n
           JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid
           JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
           WHERE n.nspname = 'kai'
             AND c.relname = 'audit_events'
             AND a.attname IN ('object_type', 'metadata')
             AND a.attnum > 0
             AND a.attisdropped IS FALSE
         ) = 2
         THEN 'Audit catalog compatibility was observed; it does not affect the aggregate.'
         ELSE 'Audit catalog compatibility was unavailable; it does not affect the aggregate.' END AS detail
  UNION ALL
  SELECT 'OBSERVATION' AS result_type,
         'PREWRITE_SQL_EXECUTION_FAILURE_CONTRACT' AS check_name,
         'verifier' AS object_name,
         'INFO' AS status,
         'Execution failure may prevent a result set and is never a passing result.' AS detail
),
aggregate_row AS (
  SELECT 'CHECK' AS result_type,
         'PREWRITE_AGGREGATE' AS check_name,
         'verifier' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM checks WHERE status <> 'PASS'
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'Aggregate is derived only from non-aggregate CHECK rows.' AS detail
),
ordered_rows AS (
  SELECT result_type, check_name, object_name, status, detail, 0 AS sort_group
  FROM checks
  UNION ALL
  SELECT result_type, check_name, object_name, status, detail, 1 AS sort_group
  FROM observations
  UNION ALL
  SELECT result_type, check_name, object_name, status, detail, 2 AS sort_group
  FROM aggregate_row
)
SELECT result_type,
       check_name,
       object_name,
       status,
       detail
FROM ordered_rows
ORDER BY sort_group, check_name, object_name;
