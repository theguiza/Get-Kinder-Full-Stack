WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name, object_name_value AS object_name,
         CASE WHEN to_regclass(object_name_value) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P1-08 canonical table' AS detail
    FROM unnest(ARRAY[
      'kai.intake_promotion_decisions',
      'kai.sources',
      'kai.source_versions'
    ]) AS object_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_promotion_decisions.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_promotion_decisions' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'intake_promotion_decision_id',
      'organization_id',
      'intake_source_candidate_id',
      'review_queue_item_id',
      'reviewed_source_type',
      'decision_status',
      'source_id',
      'source_version_id',
      'created_by',
      'created_by_type',
      'created_at',
      'decided_at',
      'promoted_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.sources.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'sources' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'source_id', 'organization_id', 'source_code', 'reviewed_source_type',
      'created_by', 'created_by_type', 'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.source_versions.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'source_versions' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'source_version_id', 'organization_id', 'source_id', 'intake_source_candidate_id',
      'intake_sensitivity_profile_id', 'profile_canonical_sha256', 'is_current',
      'created_by', 'created_by_type', 'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMN', table_name_value,
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = table_name_value
              AND column_name IN ('raw_content', 'sample_values', 'safe_description', 'permission_restrictions', 'filename', 'storage_location', 'signed_url', 'storage_uri')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw-content, sample-value, storage-pointer, or unrestricted free-text column exists'
    FROM unnest(ARRAY['intake_promotion_decisions', 'sources', 'source_versions']) AS table_name_value
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
      'intake_promotion_decisions_p1_08_reviewed_source_type_check',
      'intake_promotion_decisions_p1_08_decision_status_check',
      'intake_promotion_decisions_p1_08_promoted_binding_check',
      'intake_promotion_decisions_p1_08_created_by_type_check',
      'sources_p1_08_source_code_check',
      'sources_p1_08_reviewed_source_type_check',
      'sources_p1_08_created_by_type_check',
      'source_versions_p1_08_canonical_sha_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'CANDIDATE_STATUS_WIDENED', 'kai.intake_source_candidates.candidate_status',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_source_candidates'
              AND c.conname = 'intake_source_candidates_p1_07_candidate_status_check'
              AND pg_get_constraintdef(c.oid) LIKE '%''needs_gk_review''%'
              AND pg_get_constraintdef(c.oid) LIKE '%''promoted''%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'candidate_status now accepts needs_gk_review and promoted only'
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
      'intake_source_candidates_p1_08_identity_unique',
      'intake_source_candidates_p1_08_promotion_lineage_unique',
      'review_queue_items_p1_08_identity_unique',
      'intake_promotion_decisions_p1_08_identity_unique',
      'sources_p1_08_identity_unique',
      'sources_p1_08_id_org_unique',
      'source_versions_p1_08_candidate_identity_unique',
      'source_versions_p1_08_id_org_unique'
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
      'intake_promotion_decisions_p1_08_candidate_fk',
      'intake_promotion_decisions_p1_08_review_queue_item_fk',
      'intake_promotion_decisions_p1_08_source_fk',
      'intake_promotion_decisions_p1_08_source_version_fk',
      'source_versions_p1_08_source_fk',
      'source_versions_p1_08_candidate_lineage_fk'
    ]) AS fk_name_value
  UNION ALL
  SELECT 'UNIQUE_INDEX_EXISTS', 'ux_source_versions_p1_08_current_per_source',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_class ic
             JOIN pg_namespace n ON n.oid = ic.relnamespace
            WHERE n.nspname = 'kai'
              AND ic.relname = 'ux_source_versions_p1_08_current_per_source'
              AND ic.relkind = 'i'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'partial unique index enforces at most one current source_version per source'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'source_promotion_decision_persisted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%source_promotion_decision_persisted%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts the P1-08 source-promotion-decision-persisted operation'
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
              AND pg_get_constraintdef(c.oid) LIKE '%intake_source_candidate_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review_queue_item_created%'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%data_dictionary_draft_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%file_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%parser_run_recorded%'
              AND pg_get_constraintdef(c.oid) LIKE '%policy_decision_compare_and_set%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Gate A/P1-02 through P1-07 audit operations remain accepted alongside the new P1-08 operation'
  UNION ALL
  SELECT 'AUDIT_METADATA_BRANCH', 'source_promotion_decision_persisted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%source_promotion_decision_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%reviewed_source_type%'
              AND pg_get_constraintdef(c.oid) LIKE '%validator_key%'
              AND pg_get_constraintdef(c.oid) LIKE '%storage_uri%'
              AND pg_get_constraintdef(c.oid) LIKE '%signed_url%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'metadata object-check constraint enforces the P1-08 source-promotion-decision-persisted metadata branch and forbids storage_uri/signed_url keys'
  UNION ALL
  SELECT 'REVIEWED_SOURCE_TYPE_NEVER_UNKNOWN', 'kai.intake_promotion_decisions.reviewed_source_type',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_promotion_decisions'
              AND c.conname = 'intake_promotion_decisions_p1_08_reviewed_source_type_check'
              AND pg_get_constraintdef(c.oid) LIKE '%''unknown''%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'reviewed_source_type vocabulary never includes unknown'
)
SELECT 'P1_08_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
