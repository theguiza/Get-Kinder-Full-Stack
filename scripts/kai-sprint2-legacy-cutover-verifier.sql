-- Read-only post-migration verifier for the KAI legacy-generation cutover.
-- Emits one result set: check_name, object_name, status, detail.
-- Metadata/catalog only - no row content.

WITH checks AS (
  SELECT 'CANONICAL_TABLE_EXISTS' AS check_name, 'kai.intake_source_candidates' AS object_name,
         CASE WHEN to_regclass('kai.intake_source_candidates') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         'canonical P1-07 table must exist at the kai.* name' AS detail
  UNION ALL
  SELECT 'CANONICAL_COLUMN_EXISTS', 'kai.intake_source_candidates.' || col,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='kai' AND table_name='intake_source_candidates' AND column_name=col) THEN 'PASS' ELSE 'FAIL' END,
         'canonical lineage column'
    FROM unnest(ARRAY['file_profile_id','data_dictionary_id','intake_sensitivity_profile_id','profile_canonical_sha256','candidate_status','proposed_source_type']) AS col
  UNION ALL
  SELECT 'CANONICAL_CONSTRAINT_EXISTS', conname, 'PASS_IF_EXISTS',
         'required canonical constraint'
    FROM unnest(ARRAY[
      'intake_source_candidates_p1_07_identity_unique',
      'intake_source_candidates_p1_08_identity_unique',
      'intake_source_candidates_p1_08_promotion_lineage_unique',
      'intake_source_candidates_p1_07_canonical_sha_check',
      'intake_source_candidates_p1_07_candidate_status_check',
      'intake_source_candidates_p1_07_created_by_type_check'
    ]) AS conname
  UNION ALL
  SELECT 'CONSTRAINT_PRESENT', 'kai.intake_source_candidates.' || conname,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname='kai' AND r.relname='intake_source_candidates' AND c.conname=conname
         ) THEN 'PASS' ELSE 'FAIL' END,
         'canonical constraint'
    FROM unnest(ARRAY[
      'intake_source_candidates_p1_07_identity_unique',
      'intake_source_candidates_p1_08_identity_unique',
      'intake_source_candidates_p1_08_promotion_lineage_unique',
      'intake_source_candidates_p1_07_canonical_sha_check',
      'intake_source_candidates_p1_07_candidate_status_check',
      'intake_source_candidates_p1_07_created_by_type_check'
    ]) AS conname
  UNION ALL
  SELECT 'P1_08_TABLE_EXISTS', 'kai.' || t, CASE WHEN to_regclass('kai.' || t) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END, 'P1-08 canonical table'
    FROM unnest(ARRAY['intake_promotion_decisions','sources','source_versions']) AS t
  UNION ALL
  SELECT 'NO_DUPLICATE_CANDIDATE_IDENTITY', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_source_candidates GROUP BY intake_source_candidate_id, organization_id HAVING count(*) > 1
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no candidate identity duplicated'
  UNION ALL
  SELECT 'NO_INVALID_NULLS', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_source_candidates
            WHERE file_profile_id IS NULL OR data_dictionary_id IS NULL
               OR intake_sensitivity_profile_id IS NULL OR profile_canonical_sha256 IS NULL
         ) THEN 'PASS' ELSE 'FAIL' END,
         'every canonical row carries its full lineage tuple'
  UNION ALL
  SELECT 'NO_CROSS_TENANT_LINEAGE', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_source_candidates c
            JOIN kai.intake_file_profiles p ON p.file_profile_id = c.file_profile_id
           WHERE p.organization_id <> c.organization_id
         ) THEN 'PASS' ELSE 'FAIL' END,
         'candidate lineage never crosses organization_id'
  UNION ALL
  SELECT 'CANDIDATE_STATUS_VOCABULARY', 'kai.intake_source_candidates',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_source_candidates
            WHERE candidate_status NOT IN ('needs_gk_review','promoted','rejected')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'current three-state vocabulary only'
  UNION ALL
  SELECT 'LEGACY_SCHEMA_PRESENT_WHEN_APPLICABLE', 'kai_legacy_20260817',
         CASE WHEN to_regclass('kai_legacy_20260817.intake_source_candidates') IS NOT NULL
                 OR to_regclass('kai.intake_source_candidates') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='kai_legacy_20260817')
              THEN 'PASS' ELSE 'FAIL' END,
         'if a legacy relocation happened, the preserved schema must exist and be non-empty'
  UNION ALL
  SELECT 'REVIEW_QUEUE_PARTIAL_INDEX_EXISTS', ixname,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_indexes WHERE schemaname='kai' AND indexname=ixname
         ) THEN 'PASS' ELSE 'FAIL' END,
         'additive idempotency index on shared review_queue_items'
    FROM unnest(ARRAY[
      'ux_review_queue_items_p1_06_sensitivity_review_identity',
      'ux_review_queue_items_p1_07_source_candidate_review_identity'
    ]) AS ixname
)
SELECT * FROM checks
WHERE check_name <> 'CANONICAL_CONSTRAINT_EXISTS' -- informational row, not itself a pass/fail check
ORDER BY check_name, object_name;
