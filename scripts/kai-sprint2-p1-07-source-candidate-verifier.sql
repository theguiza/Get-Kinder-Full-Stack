WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name,
         'kai.intake_source_candidates' AS object_name,
         CASE WHEN to_regclass('kai.intake_source_candidates') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P1-07 canonical source-candidate table' AS detail
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_source_candidates.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_source_candidates' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical column'
    FROM unnest(ARRAY[
      'intake_source_candidate_id',
      'organization_id',
      'intake_file_id',
      'file_profile_id',
      'data_dictionary_id',
      'intake_sensitivity_profile_id',
      'profile_canonical_sha256',
      'proposed_source_type',
      'candidate_status',
      'created_by',
      'created_by_type',
      'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'NO_RAW_CONTENT_COLUMN', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_source_candidates'
              AND column_name IN ('raw_content', 'sample_values', 'safe_description', 'permission_restrictions', 'filename', 'storage_location')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no raw-content, sample-value, or unrestricted free-text column exists'
  UNION ALL
  SELECT 'CHECK_EXISTS', check_name_value,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_source_candidates'
              AND c.conname = check_name_value
              AND c.contype = 'c'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'required CHECK-enforced vocabulary or bound on kai.intake_source_candidates'
    FROM unnest(ARRAY[
      'intake_source_candidates_p1_07_canonical_sha_check',
      'intake_source_candidates_p1_07_proposed_source_type_check',
      'intake_source_candidates_p1_07_candidate_status_check',
      'intake_source_candidates_p1_07_created_by_type_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'PROPOSED_SOURCE_TYPE_PINNED_UNKNOWN', 'kai.intake_source_candidates.proposed_source_type',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_source_candidates'
              AND c.conname = 'intake_source_candidates_p1_07_proposed_source_type_check'
              AND pg_get_constraintdef(c.oid) LIKE '%''unknown''%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no explicit source-classification producer contract exists yet, so proposed_source_type is pinned to unknown only'
  UNION ALL
  SELECT 'CANDIDATE_STATUS_PINNED_NEEDS_REVIEW', 'kai.intake_source_candidates.candidate_status',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_source_candidates'
              AND c.conname = 'intake_source_candidates_p1_07_candidate_status_check'
              AND pg_get_constraintdef(c.oid) LIKE '%''needs_gk_review''%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no promoted, approved, finalized, or export-ready candidate_status value exists'
  UNION ALL
  SELECT 'IDENTITY_UNIQUE_CONSTRAINT_EXISTS', 'intake_source_candidates_p1_07_identity_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_source_candidates'
              AND c.conname = 'intake_source_candidates_p1_07_identity_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'one candidate per organization_id + intake_sensitivity_profile_id'
  UNION ALL
  SELECT 'LINEAGE_FK_EXISTS', fk_name_value,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_source_candidates'
              AND c.conname = fk_name_value
              AND c.contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'tenant-safe composite lineage foreign key'
    FROM unnest(ARRAY[
      'intake_source_candidates_p1_07_file_fk',
      'intake_source_candidates_p1_07_profile_lineage_fk',
      'intake_source_candidates_p1_07_dictionary_lineage_fk',
      'intake_source_candidates_p1_07_sensitivity_lineage_fk'
    ]) AS fk_name_value
  UNION ALL
  SELECT 'SENSITIVITY_PROFILE_CANDIDATE_LINEAGE_UNIQUE_EXISTS', 'intake_sensitivity_profiles_p1_07_candidate_lineage_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_sensitivity_profiles'
              AND c.conname = 'intake_sensitivity_profiles_p1_07_candidate_lineage_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'P1-07-added unique constraint on kai.intake_sensitivity_profiles needed to express the composite sensitivity-lineage FK'
  UNION ALL
  SELECT 'UNIQUE_INDEX_EXISTS', 'ux_review_queue_items_p1_07_source_candidate_review_identity',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_class ic
             JOIN pg_namespace n ON n.oid = ic.relnamespace
            WHERE n.nspname = 'kai'
              AND ic.relname = 'ux_review_queue_items_p1_07_source_candidate_review_identity'
              AND ic.relkind = 'i'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'partial unique index scopes the source_candidate_review idempotency identity, not a table-wide constraint'
  UNION ALL
  SELECT 'QUEUE_TYPE_VOCABULARY', 'source_candidate_review',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'review_queue_items'
              AND c.conname = 'review_queue_items_p1_06_queue_type_check'
              AND pg_get_constraintdef(c.oid) LIKE '%source_candidate_review%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'queue_type vocabulary already accepts source_candidate_review (P1-06 reserved it); P1-07 does not edit the accepted P1-06 migration'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'intake_source_candidate_persisted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_source_candidate_persisted%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts the P1-07 intake-source-candidate-persisted operation'
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
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review_queue_item_created%'
              AND pg_get_constraintdef(c.oid) LIKE '%policy_decision_compare_and_set%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Gate A/P1-02 through P1-06 audit operations remain accepted alongside the new P1-07 operation'
  UNION ALL
  SELECT 'AUDIT_METADATA_BRANCH', 'intake_source_candidate_persisted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_source_candidate_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%metadata_only%'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_id%'
              AND pg_get_constraintdef(c.oid) LIKE '%validator_key%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'metadata object-check constraint enforces the P1-07 intake-source-candidate-persisted metadata branch'
  UNION ALL
  SELECT 'NO_TABLE_WIDE_FK_ON_SHARED_TARGET', 'kai.review_queue_items.target_object_id',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'review_queue_items'
              AND c.contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'P1-07 adds no table-wide foreign key on the shared, multi-target target_object_id column'
  UNION ALL
  SELECT 'NO_PROMOTION_OR_SOURCE_OBJECTS', object_name_value,
         CASE WHEN to_regclass(object_name_value) IS NULL THEN 'PASS' ELSE 'FAIL' END,
         'P1-07 does not create any source, source_version, or promotion-decision table'
    FROM unnest(ARRAY[
      'kai.sources',
      'kai.source_versions',
      'kai.intake_promotion_decisions'
    ]) AS object_name_value
)
SELECT 'P1_07_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
