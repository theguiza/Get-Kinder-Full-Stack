WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name,
         'kai.review_queue_items' AS object_name,
         CASE WHEN to_regclass('kai.review_queue_items') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P1-06 canonical review-queue table' AS detail
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.review_queue_items.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'review_queue_items' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column already assumed by kaiIntakeQueries.js / kaiReviewQueueService.js'
    FROM unnest(ARRAY[
      'review_queue_item_id',
      'organization_id',
      'engagement_id',
      'queue_type',
      'target_object_type',
      'target_object_id',
      'priority',
      'queue_status',
      'review_status',
      'blocked_reason',
      'assigned_to',
      'due_at',
      'summary',
      'required_action',
      'queue_metadata',
      'created_by',
      'created_by_type',
      'created_at',
      'updated_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'UNIQUE_INDEX_EXISTS', 'ux_review_queue_items_p1_06_sensitivity_review_identity',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_class ic
             JOIN pg_namespace n ON n.oid = ic.relnamespace
            WHERE n.nspname = 'kai'
              AND ic.relname = 'ux_review_queue_items_p1_06_sensitivity_review_identity'
              AND ic.relkind = 'i'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'partial unique index scopes the sensitivity_review idempotency identity, not a table-wide constraint'
  UNION ALL
  SELECT 'CHECK_EXISTS', check_name_value,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'review_queue_items'
              AND c.conname = check_name_value
              AND c.contype = 'c'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'required CHECK-enforced vocabulary or bound on kai.review_queue_items'
    FROM unnest(ARRAY[
      'review_queue_items_p1_06_queue_type_check',
      'review_queue_items_p1_06_queue_status_check',
      'review_queue_items_p1_06_review_status_check',
      'review_queue_items_p1_06_priority_check',
      'review_queue_items_p1_06_created_by_type_check',
      'review_queue_items_p1_06_target_object_type_check',
      'review_queue_items_p1_06_summary_check',
      'review_queue_items_p1_06_required_action_check',
      'review_queue_items_p1_06_sensrev_required_action_check',
      'review_queue_items_p1_06_blocked_reason_check',
      'review_queue_items_p1_06_queue_metadata_object_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'QUEUE_TYPE_VOCABULARY', 'sensitivity_review',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'review_queue_items'
              AND c.conname = 'review_queue_items_p1_06_queue_type_check'
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'queue_type vocabulary accepts sensitivity_review, matching scripts/kai-sprint2-ddl-vocabulary-status-check.sql'
  UNION ALL
  SELECT 'TRIGGER_EXISTS', 'trg_review_queue_items_p1_06_touch_updated_at',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_trigger t
             JOIN pg_class r ON r.oid = t.tgrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'review_queue_items'
              AND t.tgname = 'trg_review_queue_items_p1_06_touch_updated_at'
              AND NOT t.tgisinternal
         ) THEN 'PASS' ELSE 'FAIL' END,
         'updated_at is server-maintained on every UPDATE'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'sensitivity_review_queue_item_created',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review_queue_item_created%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts the P1-06 sensitivity-review queue-item-creation operation'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'earlier_operations_preserved',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%parser_run_recorded%'
              AND pg_get_constraintdef(c.oid) LIKE '%file_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%data_dictionary_draft_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%policy_decision_compare_and_set%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Gate A/P1-02/P1-03/P1-04/P1-05 audit operations remain accepted alongside the new P1-06 operation'
  UNION ALL
  SELECT 'AUDIT_METADATA_BRANCH', 'sensitivity_review_queue_item_created',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review_queue_item_created%'
              AND pg_get_constraintdef(c.oid) LIKE '%metadata_only%'
              AND pg_get_constraintdef(c.oid) LIKE '%queue_type%'
              AND pg_get_constraintdef(c.oid) LIKE '%target_object_id%'
              AND pg_get_constraintdef(c.oid) LIKE '%validator_key%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'metadata object-check constraint enforces the P1-06 sensitivity-review-queue-item-creation metadata branch'
  UNION ALL
  SELECT 'NO_POLYMORPHIC_FK', 'kai.review_queue_items.target_object_id',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'review_queue_items'
              AND c.contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no table-wide foreign key was added on the shared, multi-target target_object_id column'
)
SELECT 'P1_06_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
