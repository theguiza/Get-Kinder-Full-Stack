WITH checks AS (
  SELECT 'TABLE_EXISTS' AS check_name,
         'kai.data_dictionaries' AS object_name,
         CASE WHEN to_regclass('kai.data_dictionaries') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'P1-04 draft data-dictionary bundle table' AS detail
  UNION ALL
  SELECT 'TABLE_EXISTS', 'kai.data_dictionary_fields',
         CASE WHEN to_regclass('kai.data_dictionary_fields') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'P1-04 metadata-only field table'
  UNION ALL
  SELECT 'TABLE_EXISTS', 'kai.data_dictionary_mappings',
         CASE WHEN to_regclass('kai.data_dictionary_mappings') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'P1-04 field-to-profile-key binding table'
  UNION ALL
  SELECT 'TABLE_EXISTS', 'kai.data_quality_findings',
         CASE WHEN to_regclass('kai.data_quality_findings') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'P1-04 profile-derived quality finding table'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.data_dictionaries.profile_canonical_sha256',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'data_dictionaries' AND column_name = 'profile_canonical_sha256'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'immutable bound profile hash'
  UNION ALL
  SELECT 'COLUMN_EXISTS', 'kai.data_dictionaries.dictionary_status',
         CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'data_dictionaries' AND column_name = 'dictionary_status'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'fail-closed draft status'
  UNION ALL
  SELECT 'COLUMN_ABSENT', 'kai.data_dictionaries.revision_number',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'data_dictionaries' AND column_name IN ('revision_number', 'predecessor_id', 'supersedes_id')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no revision numbers, predecessor links, or supersession links'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'data_dictionaries_p1_04_bundle_identity_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'data_dictionaries'
              AND c.conname = 'data_dictionaries_p1_04_bundle_identity_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'exactly one dictionary bundle per organization_id + file_profile_id'
  UNION ALL
  SELECT 'FK_EXISTS', 'data_dictionaries_p1_04_profile_lineage_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'data_dictionaries'
              AND c.conname = 'data_dictionaries_p1_04_profile_lineage_fk'
              AND c.contype = 'f'
              AND array_length(c.conkey, 1) = 4
         ) THEN 'PASS' ELSE 'FAIL' END,
         'dictionary bound by composite lineage to the exact stored profile identity and hash'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'intake_file_profiles_p1_04_lineage_unique',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'intake_file_profiles'
              AND c.conname = 'intake_file_profiles_p1_04_lineage_unique'
              AND c.contype = 'u'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'backward-compatible P1-02 substrate extension used only for the P1-04 lineage FK'
  UNION ALL
  SELECT 'FK_EXISTS', 'data_dictionary_fields_p1_04_dictionary_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'data_dictionary_fields'
              AND c.conname = 'data_dictionary_fields_p1_04_dictionary_fk'
              AND c.contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'field bound to its exact dictionary bundle tenant and profile identity'
  UNION ALL
  SELECT 'FK_EXISTS', 'data_dictionary_mappings_p1_04_field_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'data_dictionary_mappings'
              AND c.conname = 'data_dictionary_mappings_p1_04_field_fk'
              AND c.contype = 'f'
              AND array_length(c.conkey, 1) = 5
         ) THEN 'PASS' ELSE 'FAIL' END,
         'mapping bound by composite lineage to organization_id + file_profile_id + stable profile field key'
  UNION ALL
  SELECT 'FK_EXISTS', 'data_quality_findings_p1_04_dictionary_fk',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'data_quality_findings'
              AND c.conname = 'data_quality_findings_p1_04_dictionary_fk'
              AND c.contype = 'f'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'finding bound to its exact dictionary bundle tenant and profile identity'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'data_dictionary_fields_p1_04_review_status_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'data_dictionary_fields'
              AND c.conname = 'data_dictionary_fields_p1_04_review_status_check'
              AND pg_get_constraintdef(c.oid) LIKE '%needs_gk_review%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'fail-closed needs_gk_review default is enforced, not merely a default value'
  UNION ALL
  SELECT 'CONSTRAINT_EXISTS', 'data_quality_findings_p1_04_status_check',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'data_quality_findings'
              AND c.conname = 'data_quality_findings_p1_04_status_check'
              AND pg_get_constraintdef(c.oid) LIKE '%open%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'fail-closed open default is enforced, not merely a default value'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'data_dictionary_draft_persisted',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND pg_get_constraintdef(c.oid) LIKE '%data_dictionary_draft_persisted%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'existing audit table accepts the P1-04 draft-persistence operation'
  UNION ALL
  SELECT 'AUDIT_OPERATION_VOCABULARY', 'p1_02_p1_03_operations_preserved',
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
              AND pg_get_constraintdef(c.oid) LIKE '%policy_decision_compare_and_set%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'P1-02/Gate A audit operations remain accepted alongside the new P1-04 operation'
)
SELECT 'P1_04_CATALOG' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
