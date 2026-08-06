WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name, object_name_value AS object_name,
         CASE WHEN to_regclass(object_name_value) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P2-03 canonical table' AS detail
    FROM unnest(ARRAY[
      'kai.claims',
      'kai.claim_evidence_links'
    ]) AS object_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.claims.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'claims' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'claim_id', 'organization_id', 'evidence_item_id', 'claim_type', 'claim_status',
      'claim_review_status', 'claim_strength', 'statement', 'statement_fingerprint',
      'internal_only', 'public_use_allowed', 'funder_use_allowed', 'llm_processing_allowed',
      'product_learning_allowed', 'export_ready', 'created_by', 'created_by_type', 'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.claim_evidence_links.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'claim_evidence_links' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'claim_evidence_link_id', 'organization_id', 'claim_id', 'evidence_item_id',
      'created_by_type', 'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'COLUMN_NOT_NULL', 'kai.claims.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'claims' AND column_name = column_name_value
              AND is_nullable = 'NO'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'lineage/binding column must be NOT NULL'
    FROM unnest(ARRAY['organization_id', 'evidence_item_id']) AS column_name_value
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMN', table_name_value,
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = table_name_value
              AND column_name IN ('raw_content', 'sample_values', 'safe_description', 'permission_restrictions', 'filename', 'storage_location', 'signed_url', 'storage_uri')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw-content, sample-value, storage-pointer, or unrestricted free-text column exists'
    FROM unnest(ARRAY['claims', 'claim_evidence_links']) AS table_name_value
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
      'claims_p2_03_claim_type_check',
      'claims_p2_03_claim_status_check',
      'claims_p2_03_claim_review_status_check',
      'claims_p2_03_claim_strength_check',
      'claims_p2_03_statement_check',
      'claims_p2_03_statement_fingerprint_check',
      'claims_p2_03_internal_only_check',
      'claims_p2_03_public_use_check',
      'claims_p2_03_funder_use_check',
      'claims_p2_03_llm_processing_check',
      'claims_p2_03_product_learning_check',
      'claims_p2_03_export_ready_check',
      'claims_p2_03_created_by_type_check',
      'claim_evidence_links_p2_03_created_by_type_check',
      'review_queue_items_p2_03_claim_review_required_action_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'CLAIM_TYPE_PINNED', 'kai.claims.claim_type',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'claims'
              AND c.conname = 'claims_p2_03_claim_type_check'
              AND pg_get_constraintdef(c.oid) LIKE '%''finding''%'
              AND pg_get_constraintdef(c.oid) NOT LIKE '%IN (%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'claim_type is pinned to the single value finding, not a widened vocabulary'
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
      'claims_p2_03_identity_unique',
      'claims_p2_03_id_org_unique',
      'claim_evidence_links_p2_03_identity_unique',
      'claim_evidence_links_p2_03_one_link_per_claim_unique',
      'claim_evidence_links_p2_03_id_org_unique'
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
      'claims_p2_03_evidence_item_fk',
      'claim_evidence_links_p2_03_claim_fk',
      'claim_evidence_links_p2_03_evidence_item_fk'
    ]) AS fk_name_value
  UNION ALL
  SELECT 'UNIQUE_INDEX_EXISTS', 'ux_review_queue_items_p2_03_claim_review_identity',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_class ic
             JOIN pg_namespace n ON n.oid = ic.relnamespace
            WHERE n.nspname = 'kai'
              AND ic.relname = 'ux_review_queue_items_p2_03_claim_review_identity'
              AND ic.relkind = 'i'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'partial unique index enforces at most one claim_review queue item per claim'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'claim_proposed',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_proposed%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts the P2-03 claim_proposed operation'
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
              AND pg_get_constraintdef(c.oid) LIKE '%evidence_lineage_extracted%'
              AND pg_get_constraintdef(c.oid) LIKE '%source_promotion_decision_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_source_candidate_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review_queue_item_created%'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%data_dictionary_draft_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%file_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%parser_run_recorded%'
              AND pg_get_constraintdef(c.oid) LIKE '%policy_decision_compare_and_set%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Gate A/P1-02 through P2-01 audit operations remain accepted alongside the new P2-03 operation'
  UNION ALL
  SELECT 'AUDIT_METADATA_BRANCH', 'claim_proposed',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_proposed%'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_id%'
              AND pg_get_constraintdef(c.oid) LIKE '%validator_key%'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_statement%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'metadata object-check constraint enforces the P2-03 claim_proposed metadata branch and forbids claim_statement content'
)
SELECT 'P2_03_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
