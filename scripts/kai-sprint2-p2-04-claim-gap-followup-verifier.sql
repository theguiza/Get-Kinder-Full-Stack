WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name, object_name_value AS object_name,
         CASE WHEN to_regclass(object_name_value) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P2-04 canonical table' AS detail
    FROM unnest(ARRAY[
      'kai.gap_log_items',
      'kai.client_followup_items'
    ]) AS object_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.gap_log_items.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'gap_log_items' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'gap_log_item_id', 'organization_id', 'claim_id', 'evidence_item_id', 'source_version_id',
      'dimension_key', 'assessment_status', 'validator_key', 'safe_summary',
      'open_finding_count', 'field_count', 'undefined_field_count', 'uncovered_field_count',
      'created_by_type', 'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.client_followup_items.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'client_followup_items' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'client_followup_item_id', 'organization_id', 'claim_id', 'gap_log_item_id',
      'dimension_key', 'question_text', 'created_by_type', 'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'COLUMN_NOT_NULL', 'kai.gap_log_items.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'gap_log_items' AND column_name = column_name_value
              AND is_nullable = 'NO'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'lineage/binding column must be NOT NULL'
    FROM unnest(ARRAY['organization_id', 'claim_id', 'evidence_item_id', 'source_version_id', 'dimension_key', 'assessment_status']) AS column_name_value
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMN', table_name_value,
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = table_name_value
              AND column_name IN ('raw_content', 'sample_values', 'safe_description', 'permission_restrictions', 'filename', 'storage_location', 'signed_url', 'storage_uri')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw-content, sample-value, storage-pointer, or unrestricted free-text column exists'
    FROM unnest(ARRAY['gap_log_items', 'client_followup_items']) AS table_name_value
  UNION ALL
  SELECT 'CHECK_EXISTS', check_name_value,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND c.conname = check_name_value
              AND c.contype = 'c'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'required CHECK-enforced vocabulary or bound'
    FROM unnest(ARRAY[
      'gap_log_items_p2_04_dimension_key_check',
      'gap_log_items_p2_04_assessment_status_check',
      'gap_log_items_p2_04_validator_key_check',
      'gap_log_items_p2_04_safe_summary_check',
      'gap_log_items_p2_04_counts_non_negative_check',
      'gap_log_items_p2_04_created_by_type_check',
      'client_followup_items_p2_04_dimension_key_check',
      'client_followup_items_p2_04_question_text_check',
      'client_followup_items_p2_04_dimension_question_pairing_check',
      'client_followup_items_p2_04_created_by_type_check',
      'review_queue_items_p2_04_client_followup_contract_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'ASSESSMENT_STATUS_EXCLUDES_RESOLVED_CLEAR', 'kai.gap_log_items.assessment_status',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'gap_log_items'
              AND c.conname = 'gap_log_items_p2_04_assessment_status_check'
              AND pg_get_constraintdef(c.oid) NOT LIKE '%resolved_clear%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'assessment_status never accepts resolved_clear - a resolved_clear dimension never produces a gap row'
  UNION ALL
  SELECT 'UNIQUE_CONSTRAINT_EXISTS', constraint_name_value,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND c.conname = constraint_name_value
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'required uniqueness'
    FROM unnest(ARRAY[
      'gap_log_items_p2_04_identity_unique',
      'gap_log_items_p2_04_id_org_unique',
      'client_followup_items_p2_04_identity_unique',
      'client_followup_items_p2_04_id_org_unique',
      'client_followup_items_p2_04_one_per_gap_unique'
    ]) AS constraint_name_value
  UNION ALL
  SELECT 'FK_EXISTS', fk_name_value,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND c.conname = fk_name_value
              AND c.contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'tenant-safe composite lineage foreign key'
    FROM unnest(ARRAY[
      'gap_log_items_p2_04_claim_fk',
      'gap_log_items_p2_04_evidence_item_fk',
      'gap_log_items_p2_04_source_version_fk',
      'client_followup_items_p2_04_claim_fk',
      'client_followup_items_p2_04_gap_fk'
    ]) AS fk_name_value
  UNION ALL
  SELECT 'UNIQUE_INDEX_EXISTS', 'ux_review_queue_items_p2_04_client_followup_identity',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_class ic
             JOIN pg_namespace n ON n.oid = ic.relnamespace
            WHERE n.nspname = 'kai'
              AND ic.relname = 'ux_review_queue_items_p2_04_client_followup_identity'
              AND ic.relkind = 'i'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'partial unique index enforces at most one client_followup queue item per follow-up'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'claim_gap_and_followup_generated',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_gap_and_followup_generated%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts the P2-04 claim_gap_and_followup_generated operation'
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
              AND pg_get_constraintdef(c.oid) LIKE '%claim_proposed%'
              AND pg_get_constraintdef(c.oid) LIKE '%evidence_lineage_extracted%'
              AND pg_get_constraintdef(c.oid) LIKE '%source_promotion_decision_persisted%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Gate A/P1-02 through P2-03 audit operations remain accepted alongside the new P2-04 operation'
  UNION ALL
  SELECT 'AUDIT_METADATA_BRANCH', 'claim_gap_and_followup_generated',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_gap_and_followup_generated%'
              AND pg_get_constraintdef(c.oid) LIKE '%gap_dimension_keys%'
              AND pg_get_constraintdef(c.oid) LIKE '%validator_key%'
              AND pg_get_constraintdef(c.oid) LIKE '%question_text%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'metadata object-check constraint enforces the P2-04 metadata branch and forbids question_text content'
)
SELECT 'P2_04_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
