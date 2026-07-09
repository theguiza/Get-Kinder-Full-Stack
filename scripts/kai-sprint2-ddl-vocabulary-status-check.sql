/*
Read-only KAI Sprint 2 P0 vocabulary/status verifier.
Returns one result set: result_type, check_name, object_name, status, detail.
*/

WITH required_values(source_kind, schema_name, table_name, column_name, enum_name, value) AS (
  VALUES
    ('check','kai','review_queue_items','queue_type',NULL,'intake_file_review'),
    ('check','kai','review_queue_items','queue_type',NULL,'source_candidate_review'),
    ('check','kai','review_queue_items','queue_type',NULL,'sensitivity_review'),
    ('check','kai','review_queue_items','queue_type',NULL,'data_dictionary_review'),
    ('check','kai','review_queue_items','queue_type',NULL,'evidence_review'),
    ('check','kai','review_queue_items','queue_type',NULL,'claim_review'),
    ('check','kai','review_queue_items','queue_type',NULL,'client_followup'),
    ('check','kai','review_queue_items','queue_type',NULL,'conflict_resolution'),
    ('check','kai','review_queue_items','queue_type',NULL,'generated_content_review'),
    ('check','kai','review_queue_items','queue_type',NULL,'export_review'),
    ('check','kai','review_queue_items','queue_status',NULL,'open'),
    ('check','kai','review_queue_items','queue_status',NULL,'in_progress'),
    ('check','kai','review_queue_items','queue_status',NULL,'blocked'),
    ('check','kai','review_queue_items','queue_status',NULL,'waiting_on_client'),
    ('check','kai','review_queue_items','queue_status',NULL,'waiting_on_gk'),
    ('check','kai','review_queue_items','queue_status',NULL,'resolved'),
    ('check','kai','review_queue_items','queue_status',NULL,'cancelled'),
    ('check','kai','intake_files','file_policy_status',NULL,'pending'),
    ('check','kai','intake_files','file_policy_status',NULL,'passed'),
    ('check','kai','intake_files','file_policy_status',NULL,'blocked'),
    ('check','kai','intake_files','file_policy_status',NULL,'failed'),
    ('check','kai','intake_files','file_policy_status',NULL,'skipped'),
    ('check','kai','intake_files','storage_provider',NULL,'gcs'),
    ('check','kai','intake_files','storage_provider',NULL,'local_dev'),
    ('check','kai','intake_files','malware_scan_status',NULL,'not_configured'),
    ('check','kai','intake_files','malware_scan_status',NULL,'queued'),
    ('check','kai','intake_files','malware_scan_status',NULL,'running'),
    ('check','kai','intake_files','malware_scan_status',NULL,'passed'),
    ('check','kai','intake_files','malware_scan_status',NULL,'failed'),
    ('check','kai','intake_files','malware_scan_status',NULL,'skipped'),
    ('check','kai','organization_memberships','membership_status',NULL,'active'),
    ('check','kai','organization_memberships','membership_status',NULL,'inactive'),
    ('check','kai','organization_memberships','membership_status',NULL,'revoked'),
    ('check','kai','organization_memberships','membership_status',NULL,'invited'),
    ('enum','kai',NULL,NULL,'processing_status_enum','received'),
    ('enum','kai',NULL,NULL,'processing_status_enum','quarantined'),
    ('enum','kai',NULL,NULL,'parse_status_enum','quarantined'),
    ('enum','kai',NULL,NULL,'parse_status_enum','received'),
    ('enum','kai',NULL,NULL,'review_status_enum','proposed'),
    ('enum','kai',NULL,NULL,'review_status_enum','needs_gk_review'),
    ('enum','kai',NULL,NULL,'created_by_type_enum','human'),
    ('enum','kai',NULL,NULL,'created_by_type_enum','system'),
    ('enum','kai',NULL,NULL,'job_status_enum','queued')
),
check_constraints AS (
  SELECT
    tc.table_schema,
    tc.table_name,
    ccu.column_name,
    pg_get_constraintdef(pc.oid) AS constraint_definition
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_schema = tc.constraint_schema
   AND ccu.constraint_name = tc.constraint_name
  JOIN pg_constraint pc
    ON pc.conname = tc.constraint_name
  WHERE tc.constraint_type = 'CHECK'
),
enum_values AS (
  SELECT n.nspname AS schema_name, t.typname AS enum_name, e.enumlabel AS value
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
),
checks AS (
  SELECT
    'CHECK'::text AS result_type,
    'DDL_VALUE_ALLOWED'::text AS check_name,
    COALESCE(rv.schema_name || '.' || rv.table_name || '.' || rv.column_name, rv.schema_name || '.' || rv.enum_name) || '=' || rv.value AS object_name,
    CASE
      WHEN rv.source_kind = 'enum' AND ev.value IS NOT NULL THEN 'PASS'
      WHEN rv.source_kind = 'check' AND EXISTS (
        SELECT 1
        FROM check_constraints cc
        WHERE cc.table_schema = rv.schema_name
          AND cc.table_name = rv.table_name
          AND cc.column_name = rv.column_name
          AND cc.constraint_definition LIKE '%' || quote_literal(rv.value) || '%'
      ) THEN 'PASS'
      ELSE 'FAIL'
    END AS status,
    CASE
      WHEN rv.source_kind = 'enum' THEN 'required enum value for P0 code path'
      ELSE 'required CHECK-constraint value for P0 code path'
    END AS detail
  FROM required_values rv
  LEFT JOIN enum_values ev
    ON ev.schema_name = rv.schema_name
   AND ev.enum_name = rv.enum_name
   AND ev.value = rv.value
)
SELECT result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
