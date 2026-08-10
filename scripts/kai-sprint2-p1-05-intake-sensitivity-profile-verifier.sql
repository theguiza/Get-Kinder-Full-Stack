WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name,
         'kai.intake_sensitivity_profiles' AS object_name,
         CASE WHEN to_regclass('kai.intake_sensitivity_profiles') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P1-05 intake sensitivity and allowed-use profile table' AS detail
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.intake_sensitivity_profiles.profile_canonical_sha256',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_sensitivity_profiles' AND column_name = 'profile_canonical_sha256'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'immutable bound profile hash'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_sensitivity_profiles_p1_05_identity_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_sensitivity_profiles'
              AND c.conname = 'intake_sensitivity_profiles_p1_05_identity_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'exactly one authoritative sensitivity profile per organization_id + file_profile_id + data_dictionary_id'
  UNION ALL
  SELECT 'FK_EXISTS', 'intake_sensitivity_profiles_p1_05_profile_lineage_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_sensitivity_profiles'
              AND c.conname = 'intake_sensitivity_profiles_p1_05_profile_lineage_fk'
              AND c.contype = 'f'
              AND array_length(c.conkey, 1) = 4
         ) THEN 'PASS' ELSE 'FAIL' END,
         'sensitivity profile bound by composite lineage to the exact stored profile identity and hash'
  UNION ALL
  SELECT 'FK_EXISTS', 'intake_sensitivity_profiles_p1_05_dictionary_lineage_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_sensitivity_profiles'
              AND c.conname = 'intake_sensitivity_profiles_p1_05_dictionary_lineage_fk'
              AND c.contype = 'f'
              AND array_length(c.conkey, 1) = 4
         ) THEN 'PASS' ELSE 'FAIL' END,
         'sensitivity profile bound by composite lineage to the exact stored data-dictionary bundle identity'
  UNION ALL
  SELECT 'CHECK_EXISTS', check_name_value,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_sensitivity_profiles'
              AND c.conname = check_name_value
              AND c.contype = 'c'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'three-state (unknown/present/absent) dimension is CHECK-enforced'
    FROM unnest(ARRAY[
      'intake_sensitivity_profiles_p1_05_pii_status_check',
      'intake_sensitivity_profiles_p1_05_minor_data_status_check',
      'intake_sensitivity_profiles_p1_05_hhji_status_check',
      'intake_sensitivity_profiles_p1_05_indig_gov_status_check',
      'intake_sensitivity_profiles_p1_05_staff_notes_status_check',
      'intake_sensitivity_profiles_p1_05_story_testimonial_check',
      'intake_sensitivity_profiles_p1_05_small_cell_risk_status_check',
      'intake_sensitivity_profiles_p1_05_fin_records_status_check',
      'intake_sensitivity_profiles_p1_05_consent_basis_status_check',
      'intake_sensitivity_profiles_p1_05_allowed_use_status_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'CHECK_EXISTS', check_name_value,
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_sensitivity_profiles'
              AND c.conname = check_name_value
              AND c.contype = 'c'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'pinned fail-closed restriction is CHECK-enforced, not merely a default value'
    FROM unnest(ARRAY[
      'intake_sensitivity_profiles_p1_05_llm_processing_check',
      'intake_sensitivity_profiles_p1_05_product_learning_check',
      'intake_sensitivity_profiles_p1_05_public_use_check',
      'intake_sensitivity_profiles_p1_05_funder_use_check',
      'intake_sensitivity_profiles_p1_05_human_review_check',
      'intake_sensitivity_profiles_p1_05_retention_posture_check'
    ]) AS check_name_value
  UNION ALL
  SELECT 'COLUMN_ABSENT', 'kai.intake_sensitivity_profiles.review_status',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_sensitivity_profiles'
              AND column_name IN ('review_status', 'review_requirements')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'review requirements are output-only, never persisted as a classification value'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'intake_sensitivity_profile_persisted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_persisted%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts the P1-05 sensitivity-profile-persistence operation'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'p1_02_p1_03_p1_04_operations_preserved',
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
              AND pg_get_constraintdef(c.oid) LIKE '%policy_decision_compare_and_set%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'P1-02/P1-03/P1-04/Gate A audit operations remain accepted alongside the new P1-05 operation'
  UNION ALL
  SELECT 'AUDIT_METADATA_BRANCH', 'intake_sensitivity_profile_persisted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%intake_sensitivity_profile_persisted%'
              AND pg_get_constraintdef(c.oid) LIKE '%human_review_required%'
              AND pg_get_constraintdef(c.oid) LIKE '%validator_key%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'metadata object-check constraint enforces the P1-05 sensitivity-profile metadata branch'
)
SELECT 'P1_05_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
