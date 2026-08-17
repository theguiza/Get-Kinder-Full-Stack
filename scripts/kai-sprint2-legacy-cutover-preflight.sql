-- Read-only production preflight for the KAI legacy-generation cutover
-- (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql).
--
-- Emits exactly one result set: result_type, check_name, object_name, status,
-- detail. Every row must be PASS before the cutover migration may run. No row
-- dumps, filenames, storage locations, URLs, secrets, or PII are read or
-- emitted - only catalog metadata and row counts.

WITH
canonical_markers AS (
  SELECT 'intake_source_candidates' AS table_name, 'intake_source_candidates_p1_07_identity_unique' AS marker_constraint, NULL::text AS marker_column
  UNION ALL SELECT 'sources', 'sources_p1_08_identity_unique', NULL
  UNION ALL SELECT 'source_versions', 'source_versions_p1_08_id_org_unique', NULL
  UNION ALL SELECT 'intake_parser_runs', 'intake_parser_runs_p1_identity_unique', NULL
  UNION ALL SELECT 'intake_file_profiles', 'intake_file_profiles_p1_04_lineage_unique', NULL
  UNION ALL SELECT 'data_dictionaries', NULL, 'file_profile_id'
  UNION ALL SELECT 'intake_sensitivity_profiles', 'intake_sensitivity_profiles_p1_07_candidate_lineage_unique', NULL
  UNION ALL SELECT 'intake_promotion_decisions', 'intake_promotion_decisions_p1_08_identity_unique', NULL
),
legacy_markers AS (
  SELECT 'intake_source_candidates' AS table_name, 'proposed_display_name' AS legacy_column, 'file_profile_id' AS absent_canonical_column
  UNION ALL SELECT 'intake_file_profiles', 'detected_columns', 'profile_canonical_sha256'
  UNION ALL SELECT 'data_dictionaries', 'dictionary_metadata', 'file_profile_id'
  UNION ALL SELECT 'intake_sensitivity_profiles', 'consent_scope', 'data_dictionary_id'
  UNION ALL SELECT 'intake_promotion_decisions', 'decision_by', 'review_queue_item_id'
  UNION ALL SELECT 'sources', 'display_name', NULL
  UNION ALL SELECT 'source_versions', 'version_number', NULL
),
checks AS (
  -- 1. Prerequisites this migration relies on and never installs.
  SELECT 'PREREQUISITE' AS result_type, 'TABLE_EXISTS' AS check_name, 'kai.intake_files' AS object_name,
         CASE WHEN to_regclass('kai.intake_files') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'required before cutover' AS detail
  UNION ALL
  SELECT 'PREREQUISITE', 'GATE_A_CONSTRAINT_EXISTS', 'kai.intake_files.intake_files_gate_a_upload_state_check',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'intake_files' AND c.conname = 'intake_files_gate_a_upload_state_check'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'proves intake_files is already this repository''s canonical Gate A shape'
  UNION ALL
  SELECT 'PREREQUISITE', 'TABLE_EXISTS', 'kai.upload_lifecycle_audit',
         CASE WHEN to_regclass('kai.upload_lifecycle_audit') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'required before cutover'
  UNION ALL
  SELECT 'PREREQUISITE', 'TABLE_EXISTS', 'kai.review_queue_items',
         CASE WHEN to_regclass('kai.review_queue_items') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'required before cutover'
  UNION ALL
  SELECT 'PREREQUISITE', 'QUEUE_TYPE_CHECK_PERMITS', 'kai.review_queue_items.queue_type=source_candidate_review',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) LIKE '%source_candidate_review%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'review_queue_items is shared/live and is never relocated; must already permit this literal'
  UNION ALL
  SELECT 'PREREQUISITE', 'QUEUE_TYPE_CHECK_PERMITS', 'kai.review_queue_items.queue_type=sensitivity_review',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items' AND c.contype = 'c'
              AND pg_get_constraintdef(c.oid) LIKE '%sensitivity_review%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'review_queue_items is shared/live and is never relocated; must already permit this literal'

  -- 2. Destination-collision guard.
  UNION ALL
  SELECT 'DESTINATION', 'SCHEMA_ABSENT_OR_ALREADY_CONVERGED', 'kai_legacy_20260817',
         CASE
           WHEN NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'kai_legacy_20260817') THEN 'PASS'
           WHEN to_regclass('kai_legacy_20260817.intake_source_candidates') IS NOT NULL
                AND to_regclass('kai.intake_source_candidates') IS NOT NULL
                AND EXISTS (
                  SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
                   WHERE n.nspname = 'kai' AND r.relname = 'intake_source_candidates' AND c.conname = 'intake_source_candidates_p1_07_identity_unique'
                ) THEN 'PASS'
           ELSE 'FAIL'
         END,
         'target schema must not already exist unless it is this cutover''s own already-converged prior run'

  -- 3. Per-table shape classification (canonical vs legacy vs unrecognized) for
  --    the seven relocation candidates plus the four Group-U tables not in the
  --    supplied production catalog.
  UNION ALL
  SELECT 'SHAPE_CLASSIFICATION', 'RECOGNIZED_SHAPE', 'kai.' || t.table_name,
         CASE
           WHEN to_regclass('kai.' || t.table_name) IS NULL THEN 'PASS'
           WHEN EXISTS (
             SELECT 1 FROM canonical_markers cm
              WHERE cm.table_name = t.table_name
                AND (
                  (cm.marker_constraint IS NOT NULL AND EXISTS (
                    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
                     WHERE n.nspname = 'kai' AND r.relname = t.table_name AND c.conname = cm.marker_constraint
                  ))
                  OR (cm.marker_column IS NOT NULL AND EXISTS (
                    SELECT 1 FROM information_schema.columns ic
                     WHERE ic.table_schema = 'kai' AND ic.table_name = t.table_name AND ic.column_name = cm.marker_column
                  ))
                )
           ) THEN 'PASS'
           WHEN EXISTS (
             SELECT 1 FROM legacy_markers lm
              WHERE lm.table_name = t.table_name
                AND EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'kai' AND ic.table_name = t.table_name AND ic.column_name = lm.legacy_column)
                AND (lm.absent_canonical_column IS NULL OR NOT EXISTS (
                  SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'kai' AND ic.table_name = t.table_name AND ic.column_name = lm.absent_canonical_column
                ))
           ) THEN 'PASS'
           ELSE 'FAIL'
         END,
         'must classify as already-canonical, proven-legacy, or absent - never an unrecognized third shape'
    FROM (VALUES
      ('intake_source_candidates'), ('intake_file_profiles'), ('data_dictionaries'),
      ('intake_sensitivity_profiles'), ('intake_promotion_decisions'), ('sources'), ('source_versions')
    ) AS t(table_name)
  UNION ALL
  SELECT 'SHAPE_CLASSIFICATION', 'ABSENT_OR_ALREADY_CANONICAL', 'kai.' || t.table_name,
         CASE WHEN to_regclass('kai.' || t.table_name) IS NULL THEN 'PASS'
              WHEN EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'kai' AND ic.table_name = t.table_name AND ic.column_name = t.marker_column) THEN 'PASS'
              ELSE 'FAIL' END,
         'no supplied production evidence exists for a legacy shape of this table; it must be absent or already canonical'
    FROM (VALUES
      ('intake_parser_runs', 'parser_status'),
      ('data_dictionary_fields', 'profile_field_key'),
      ('data_dictionary_mappings', 'data_dictionary_field_id'),
      ('data_quality_findings', 'finding_type')
    ) AS t(table_name, marker_column)

  -- 4. Downstream P2 dependency guard on kai.source_versions.
  UNION ALL
  SELECT 'DOWNSTREAM_DEPENDENCY', 'ABSENT_IF_SOURCE_VERSIONS_LEGACY', 'kai.' || d.table_name,
         CASE
           WHEN to_regclass('kai.source_versions') IS NULL THEN 'PASS'
           WHEN EXISTS (
             SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
              WHERE n.nspname = 'kai' AND r.relname = 'source_versions' AND c.conname = 'source_versions_p1_08_id_org_unique'
           ) THEN 'PASS'
           WHEN to_regclass('kai.' || d.table_name) IS NULL THEN 'PASS'
           ELSE 'FAIL'
         END,
         'if source_versions is still legacy-shaped, this P2 table (which requires the canonical shape) must not yet exist'
    FROM (VALUES ('source_locators'), ('evidence_items'), ('gap_log_items')) AS d(table_name)
)
SELECT * FROM checks
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', 'kai.intake_source_candidates', 'PASS',
       CASE WHEN to_regclass('kai.intake_source_candidates') IS NULL THEN 'table absent'
            ELSE (SELECT count(*)::text FROM kai.intake_source_candidates) END
WHERE to_regclass('kai.intake_source_candidates') IS NOT NULL
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', 'kai.intake_promotion_decisions', 'PASS',
       (SELECT count(*)::text FROM kai.intake_promotion_decisions)
WHERE to_regclass('kai.intake_promotion_decisions') IS NOT NULL
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', 'kai.sources', 'PASS',
       (SELECT count(*)::text FROM kai.sources)
WHERE to_regclass('kai.sources') IS NOT NULL
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', 'kai.source_versions', 'PASS',
       (SELECT count(*)::text FROM kai.source_versions)
WHERE to_regclass('kai.source_versions') IS NOT NULL
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', 'kai.intake_file_profiles', 'PASS',
       (SELECT count(*)::text FROM kai.intake_file_profiles)
WHERE to_regclass('kai.intake_file_profiles') IS NOT NULL
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', 'kai.data_dictionaries', 'PASS',
       (SELECT count(*)::text FROM kai.data_dictionaries)
WHERE to_regclass('kai.data_dictionaries') IS NOT NULL
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', 'kai.intake_sensitivity_profiles', 'PASS',
       (SELECT count(*)::text FROM kai.intake_sensitivity_profiles)
WHERE to_regclass('kai.intake_sensitivity_profiles') IS NOT NULL
UNION ALL
SELECT 'ROW_COUNT', 'COUNT', 'kai.review_queue_items', 'PASS',
       (SELECT count(*)::text FROM kai.review_queue_items)
WHERE to_regclass('kai.review_queue_items') IS NOT NULL
ORDER BY result_type, check_name, object_name;
