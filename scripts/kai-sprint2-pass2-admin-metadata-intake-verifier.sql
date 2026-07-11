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
exact_batch AS (
  SELECT b.intake_batch_id,
         b.organization_id,
         b.engagement_id,
         b.batch_metadata
  FROM kai.intake_batches b
  CROSS JOIN expected e
  WHERE b.organization_id = e.organization_id
    AND b.engagement_id = e.engagement_id
    AND b.batch_code = e.batch_code
    AND b.idempotency_key = e.batch_idempotency_key
    AND b.batch_metadata->>'p0_pass' = e.p0_pass
    AND b.batch_metadata->>'gate_plan' = e.gate_plan
),
exact_file AS (
  SELECT f.intake_file_id,
         f.intake_batch_id,
         f.organization_id,
         f.engagement_id,
         f.file_metadata,
         f.raw_file_retained,
         f.file_policy_status,
         f.malware_scan_status
  FROM kai.intake_files f
  CROSS JOIN expected e
  WHERE f.organization_id = e.organization_id
    AND f.engagement_id = e.engagement_id
    AND f.file_metadata->>'idempotency_key' = e.file_idempotency_key
    AND f.file_metadata->>'p0_pass' = e.p0_pass
    AND f.file_metadata->>'gate_plan' = e.gate_plan
),
checks AS (
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_EXACT_BATCH_COUNT_ONE' AS check_name,
         'kai.intake_batches' AS object_name,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         'Exact composite batch count must equal one.' AS detail
  FROM exact_batch
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_EXACT_FILE_COUNT_ONE' AS check_name,
         'kai.intake_files' AS object_name,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         'Exact composite file count must equal one.' AS detail
  FROM exact_file
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_FILE_LINKS_TO_EXACT_BATCH' AS check_name,
         'intake_batch_file_link' AS object_name,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         'The exact file must link to the exact batch.' AS detail
  FROM exact_file f
  JOIN exact_batch b
    ON b.intake_batch_id = f.intake_batch_id
   AND b.organization_id = f.organization_id
   AND b.engagement_id = f.engagement_id
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_BATCH_METADATA_ONLY_STATE' AS check_name,
         'kai.intake_batches' AS object_name,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         'The exact batch must retain the expected metadata-only flags.' AS detail
  FROM exact_batch b
  WHERE b.batch_metadata->>'synthetic_only' = 'true'
    AND b.batch_metadata->>'raw_upload_enabled' = 'false'
    AND b.batch_metadata->>'signed_url_enabled' = 'false'
    AND b.batch_metadata->>'parser_worker_enabled' = 'false'
    AND b.batch_metadata->>'source_promotion_enabled' = 'false'
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_FILE_METADATA_ONLY_NO_RAW_STATE' AS check_name,
         'kai.intake_files' AS object_name,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END AS status,
         'The exact file must remain metadata-only with no raw-file state.' AS detail
  FROM exact_file f
  WHERE f.raw_file_retained IS FALSE
    AND f.file_policy_status = 'skipped'
    AND f.malware_scan_status = 'skipped'
    AND f.file_metadata->>'synthetic_only' = 'true'
    AND f.file_metadata->>'raw_upload_enabled' = 'false'
    AND f.file_metadata->>'signed_url_enabled' = 'false'
    AND f.file_metadata->>'no_raw_object_created' = 'true'
    AND NOT (f.file_metadata ? 'signed_upload_url')
    AND NOT (f.file_metadata ? 'signed_read_url')
    AND NOT (f.file_metadata ? 'storage_credentials')
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_NO_PARSER_RUN_FOR_EXACT_FILE' AS check_name,
         'kai.intake_parser_runs' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
           FROM kai.intake_parser_runs r
           JOIN exact_file f ON f.intake_file_id = r.intake_file_id
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'No parser run may link to the exact file.' AS detail
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_NO_FILE_PROFILE_FOR_EXACT_FILE' AS check_name,
         'kai.intake_file_profiles' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
           FROM kai.intake_file_profiles p
           JOIN exact_file f ON f.intake_file_id = p.intake_file_id
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'No file profile may link to the exact file.' AS detail
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_NO_SENSITIVITY_PROFILE_FOR_EXACT_FILE' AS check_name,
         'kai.intake_sensitivity_profiles' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
           FROM kai.intake_sensitivity_profiles p
           JOIN exact_file f ON f.intake_file_id = p.intake_file_id
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'No sensitivity profile may link to the exact file.' AS detail
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_NO_SOURCE_CANDIDATE_FOR_EXACT_FILE' AS check_name,
         'kai.intake_source_candidates' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
           FROM kai.intake_source_candidates c
           JOIN exact_file f ON f.intake_file_id = c.intake_file_id
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'No source candidate may link to the exact file.' AS detail
  UNION ALL
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_NO_PROMOTION_DECISION_FOR_EXACT_FILE' AS check_name,
         'kai.intake_promotion_decisions' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
           FROM kai.intake_promotion_decisions d
           JOIN exact_file f ON f.intake_file_id = d.intake_file_id
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'No promotion decision may link to the exact file.' AS detail
),
observations AS (
  SELECT 'OBSERVATION' AS result_type,
         'POSTWRITE_AUDIT_SCHEMA_VOCABULARY_COMPATIBILITY' AS check_name,
         'audit_catalog' AS object_name,
         'INFO' AS status,
         'Audit compatibility is informational and does not affect the aggregate.' AS detail
  UNION ALL
  SELECT 'OBSERVATION' AS result_type,
         'POSTWRITE_SQL_EXECUTION_FAILURE_CONTRACT' AS check_name,
         'verifier' AS object_name,
         'INFO' AS status,
         'Execution failure may prevent a result set and is never a passing result.' AS detail
),
aggregate_row AS (
  SELECT 'CHECK' AS result_type,
         'POSTWRITE_AGGREGATE' AS check_name,
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
