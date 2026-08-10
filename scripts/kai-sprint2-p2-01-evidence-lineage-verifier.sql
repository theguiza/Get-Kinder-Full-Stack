WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name, object_name_value AS object_name,
         CASE WHEN to_regclass(object_name_value) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P2-01 canonical table' AS detail
    FROM unnest(ARRAY[
      'kai.source_locators',
      'kai.evidence_items'
    ]) AS object_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.source_locators.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'source_locators' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'source_locator_id', 'organization_id', 'source_version_id', 'locator_type',
      'coordinates', 'locator_fingerprint', 'created_by_type', 'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.evidence_items.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'evidence_items' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'evidence_item_id', 'organization_id', 'source_id', 'source_version_id', 'source_locator_id',
      'evidence_type', 'data_class', 'sensitivity_level', 'support_strength', 'statement', 'statement_fingerprint',
      'evidence_review_status', 'internal_only', 'public_use_allowed', 'funder_use_allowed',
      'llm_processing_allowed', 'product_learning_allowed', 'created_by', 'created_by_type', 'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'COLUMN_NOT_NULL', 'kai.evidence_items.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'evidence_items' AND column_name = column_name_value
              AND is_nullable = 'NO'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'lineage/binding column must be NOT NULL'
    FROM unnest(ARRAY['organization_id', 'source_id', 'source_version_id', 'source_locator_id']) AS column_name_value
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMN', table_name_value,
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = table_name_value
              AND column_name IN ('raw_content', 'sample_values', 'safe_description', 'permission_restrictions', 'filename', 'storage_location', 'signed_url', 'storage_uri')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw-content, sample-value, storage-pointer, or unrestricted free-text column exists'
    FROM unnest(ARRAY['source_locators', 'evidence_items']) AS table_name_value
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
      'source_locators_p2_01_locator_type_check',
      'source_locators_p2_01_coordinates_check',
      'source_locators_p2_01_fingerprint_check',
      'source_locators_p2_01_created_by_type_check',
      'evidence_items_p2_01_evidence_type_check',
      'evidence_items_p2_01_data_class_check',
      'evidence_items_p2_01_sensitivity_level_check',
      'evidence_items_p2_01_support_strength_check',
      'evidence_items_p2_01_statement_check',
      'evidence_items_p2_01_statement_fingerprint_check',
      'evidence_items_p2_01_review_status_check',
      'evidence_items_p2_01_internal_only_check',
      'evidence_items_p2_01_public_use_check',
      'evidence_items_p2_01_funder_use_check',
      'evidence_items_p2_01_llm_processing_check',
      'evidence_items_p2_01_product_learning_check',
      'evidence_items_p2_01_created_by_type_check',
      'review_queue_items_p2_01_evidence_review_required_action_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'LOCATOR_TYPE_PINNED', 'kai.source_locators.locator_type',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'source_locators'
              AND c.conname = 'source_locators_p2_01_locator_type_check'
              AND pg_get_constraintdef(c.oid) LIKE '%''column''%'
              AND pg_get_constraintdef(c.oid) NOT LIKE '%IN (%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'locator_type is pinned to the single value column, not a widened vocabulary'
  UNION ALL
  SELECT 'EVIDENCE_TYPE_PINNED', 'kai.evidence_items.evidence_type',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'evidence_items'
              AND c.conname = 'evidence_items_p2_01_evidence_type_check'
              AND pg_get_constraintdef(c.oid) LIKE '%dictionary_field_presence_fact%'
              AND pg_get_constraintdef(c.oid) NOT LIKE '%IN (%'
              AND pg_get_constraintdef(c.oid) NOT LIKE '%dictionary_field_count_fact%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'evidence_type is pinned to the single value dictionary_field_presence_fact; the unlocated aggregate field-count type has been removed'
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
      'source_locators_p2_01_identity_unique',
      'source_locators_p2_01_id_org_unique',
      'evidence_items_p2_01_identity_unique',
      'evidence_items_p2_01_id_org_unique',
      'source_versions_p2_01_id_source_org_unique'
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
      'source_locators_p2_01_source_version_fk',
      'evidence_items_p2_01_source_version_fk',
      'evidence_items_p2_01_source_locator_fk'
    ]) AS fk_name_value
  UNION ALL
  SELECT 'FK_COMPOSITE_TUPLE', 'evidence_items_p2_01_source_version_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'evidence_items'
              AND c.conname = 'evidence_items_p2_01_source_version_fk'
              AND c.contype = 'f'
              AND array_length(c.conkey, 1) = 3
         ) THEN 'PASS' ELSE 'FAIL' END,
         'organization_id + source_id + source_version_id is enforced as one three-column composite foreign key, not independent single-column foreign keys'
  UNION ALL
  SELECT 'UNIQUE_INDEX_EXISTS', 'ux_review_queue_items_p2_01_evidence_review_identity',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_class ic
             JOIN pg_namespace n ON n.oid = ic.relnamespace
            WHERE n.nspname = 'kai'
              AND ic.relname = 'ux_review_queue_items_p2_01_evidence_review_identity'
              AND ic.relkind = 'i'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'partial unique index enforces at most one evidence_review queue item per evidence_item'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'evidence_lineage_extracted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%evidence_lineage_extracted%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts the P2-01 evidence-lineage-extracted operation'
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
              AND pg_get_constraintdef(c.oid) LIKE '%source_promotion_decision_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_source_candidate_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review_queue_item_created%'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%data_dictionary_draft_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%file_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%parser_run_recorded%'
              AND pg_get_constraintdef(c.oid) LIKE '%policy_decision_compare_and_set%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Gate A/P1-02 through P1-08 audit operations remain accepted alongside the new P2-01 operation'
  UNION ALL
  SELECT 'AUDIT_METADATA_BRANCH', 'evidence_lineage_extracted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%evidence_lineage_extracted%'
              AND pg_get_constraintdef(c.oid) LIKE '%evidence_item_count%'
              AND pg_get_constraintdef(c.oid) LIKE '%validator_key%'
              AND pg_get_constraintdef(c.oid) LIKE '%statement%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'metadata object-check constraint enforces the P2-01 evidence-lineage-extracted metadata branch and forbids statement/statement_fingerprint keys'
)
SELECT 'P2_01_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
