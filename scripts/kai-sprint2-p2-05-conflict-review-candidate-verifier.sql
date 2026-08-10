WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name, 'kai.conflict_groups' AS object_name,
         CASE WHEN to_regclass('kai.conflict_groups') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P2-05 canonical conflict-group table' AS detail
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.conflict_groups.' || column_name_value,
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'conflict_groups' AND column_name = column_name_value
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical persisted column'
    FROM unnest(ARRAY[
      'conflict_group_id',
      'organization_id',
      'lower_claim_id',
      'higher_claim_id',
      'lower_claim_conflict_gap_id',
      'higher_claim_conflict_gap_id',
      'basis_code',
      'safe_summary',
      'created_by_type',
      'created_at'
    ]) AS column_name_value
  UNION ALL
  SELECT 'NO_PROHIBITED_COLUMN', 'kai.conflict_groups',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'conflict_groups'
              AND column_name IN (
                'claim_text', 'claim_statement', 'statement', 'evidence_text', 'gap_summary',
                'filename', 'raw_content', 'sample', 'storage_uri', 'storage_object_key',
                'conflict_status', 'resolution_status', 'confidence', 'asserted_conflict',
                'automatic_detection', 'conflict_exists'
              )
         ) THEN 'PASS' ELSE 'FAIL' END,
         'table persists only identifiers, basis code, safe summary, actor type, and timestamp'
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
         'required scoped CHECK'
    FROM unnest(ARRAY[
      'conflict_groups_p2_05_claim_order_check',
      'conflict_groups_p2_05_basis_code_check',
      'conflict_groups_p2_05_safe_summary_check',
      'conflict_groups_p2_05_created_by_type_check',
      'review_queue_items_p2_05_conflict_resolution_contract_check',
      'upload_lifecycle_audit_p2_05_metadata_object_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'CLAIM_ORDER_CHECK', 'conflict_groups_p2_05_claim_order_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'conflict_groups'
              AND c.conname = 'conflict_groups_p2_05_claim_order_check'
              AND pg_get_constraintdef(c.oid) LIKE '%lower_claim_id < higher_claim_id%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'persisted pair ordering requires lower_claim_id < higher_claim_id'
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
         'logical or tenant-safe uniqueness'
    FROM unnest(ARRAY[
      'conflict_groups_p2_05_identity_unique',
      'conflict_groups_p2_05_id_org_unique'
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
         'tenant-safe composite FK'
    FROM unnest(ARRAY[
      'conflict_groups_p2_05_lower_claim_fk',
      'conflict_groups_p2_05_higher_claim_fk',
      'conflict_groups_p2_05_lower_gap_fk',
      'conflict_groups_p2_05_higher_gap_fk'
    ]) AS fk_name_value
  UNION ALL
  SELECT 'UNIQUE_INDEX_EXISTS', 'ux_review_queue_items_p2_05_conflict_resolution_identity',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_class ic
             JOIN pg_namespace n ON n.oid = ic.relnamespace
            WHERE n.nspname = 'kai'
              AND ic.relname = 'ux_review_queue_items_p2_05_conflict_resolution_identity'
              AND ic.relkind = 'i'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'partial unique index enforces one conflict_resolution queue item per group'
  UNION ALL
  SELECT 'QUEUE_CONTRACT', 'review_queue_items_p2_05_conflict_resolution_contract_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'review_queue_items'
              AND c.conname = 'review_queue_items_p2_05_conflict_resolution_contract_check'
              AND pg_get_constraintdef(c.oid) LIKE '%conflict_resolution%'
              AND pg_get_constraintdef(c.oid) LIKE '%conflict_group%'
              AND pg_get_constraintdef(c.oid) LIKE '%Do not approve or promote either claim%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'scoped queue contract is exact for conflict_resolution only'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'conflict_review_candidate_created',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%conflict_review_candidate_created%'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_gap_and_followup_generated%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'P2-05 operation is accepted and P2-04 operation remains accepted'
  UNION ALL
  SELECT 'AUDIT_METADATA_BRANCH', 'conflict_review_candidate_created',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_p2_05_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%conflict_group_id%'
              AND pg_get_constraintdef(c.oid) LIKE '%lower_claim_conflict_gap_id%'
              AND pg_get_constraintdef(c.oid) LIKE '%asserted_conflict%'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_statement%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'P2-05 metadata-only audit branch allowlists identifiers/status/counts and forbids assertions/raw text'
)
SELECT 'P2_05_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
