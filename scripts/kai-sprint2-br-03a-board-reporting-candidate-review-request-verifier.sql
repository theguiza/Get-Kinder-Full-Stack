WITH checks(check_name, status, detail) AS (
  SELECT 'queue_type_permits_board_reporting_candidate_review',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conrelid = 'kai.review_queue_items'::regclass
              AND conname = 'review_queue_items_p1_06_queue_type_check'
              AND pg_get_constraintdef(oid) LIKE '%board_reporting_candidate_review%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'review_queue_items queue_type CHECK admits board_reporting_candidate_review'
  UNION ALL
  -- Detected structurally (target table/columns/uniqueness/predicate), not
  -- by name. Note: PostgreSQL implicitly casts a string literal compared to
  -- a `name`-typed catalog column (pg_indexes.indexname, pg_constraint.conname)
  -- to `name`, which truncates the literal the same way an over-63-byte
  -- identifier is truncated at creation - so an exact-name-equality check
  -- against these intended (pre-truncation) names does still match in
  -- practice. The real benefit of structural detection here is independent
  -- of truncation: it verifies the index/constraint's actual shape (columns,
  -- uniqueness, predicate) rather than trusting that whatever object
  -- happens to hold a given name has the right definition.
  SELECT 'board_review_identity_unique_index_present',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_indexes
            WHERE schemaname = 'kai'
              AND tablename = 'review_queue_items'
              AND indexdef LIKE '%UNIQUE INDEX%'
              AND indexdef LIKE '%(organization_id, queue_type, target_object_type, target_object_id)%'
              AND indexdef LIKE '%WHERE (queue_type = ''board_reporting_candidate_review''::text)%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'partial identity index exists for Board candidate review requests'
  UNION ALL
  SELECT 'board_review_contract_check_present',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conrelid = 'kai.review_queue_items'::regclass
              AND contype = 'c'
              AND convalidated
              AND pg_get_constraintdef(oid) LIKE '%board_reporting_candidate_review%'
              AND pg_get_constraintdef(oid) LIKE '%target_object_type = ''board_reporting_candidate''%'
              AND pg_get_constraintdef(oid) LIKE '%queue_status = ''open''%'
              AND pg_get_constraintdef(oid) LIKE '%review_status = ''needs_gk_review''%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'Board candidate review queue rows are statically open / needs_gk_review'
  UNION ALL
  SELECT 'board_candidate_tables_still_present',
         CASE WHEN to_regclass('kai.board_reporting_candidates') IS NOT NULL
                AND to_regclass('kai.board_reporting_candidate_members') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         'BR-02 immutable candidate tables are present'
)
SELECT check_name, status, detail FROM checks ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH checks(check_name, status, detail) AS (
      SELECT 'queue_type_permits_board_reporting_candidate_review',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid = 'kai.review_queue_items'::regclass
                  AND conname = 'review_queue_items_p1_06_queue_type_check'
                  AND pg_get_constraintdef(oid) LIKE '%board_reporting_candidate_review%'
             ) THEN 'PASS' ELSE 'FAIL' END,
             ''
      UNION ALL
      SELECT 'board_review_identity_unique_index_present',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_indexes
                WHERE schemaname = 'kai'
                  AND tablename = 'review_queue_items'
                  AND indexdef LIKE '%UNIQUE INDEX%'
                  AND indexdef LIKE '%(organization_id, queue_type, target_object_type, target_object_id)%'
                  AND indexdef LIKE '%WHERE (queue_type = ''board_reporting_candidate_review''::text)%'
             ) THEN 'PASS' ELSE 'FAIL' END,
             ''
      UNION ALL
      SELECT 'board_review_contract_check_present',
             CASE WHEN EXISTS (
               SELECT 1 FROM pg_constraint
                WHERE conrelid = 'kai.review_queue_items'::regclass
                  AND contype = 'c'
                  AND convalidated
                  AND pg_get_constraintdef(oid) LIKE '%board_reporting_candidate_review%'
                  AND pg_get_constraintdef(oid) LIKE '%target_object_type = ''board_reporting_candidate''%'
                  AND pg_get_constraintdef(oid) LIKE '%queue_status = ''open''%'
                  AND pg_get_constraintdef(oid) LIKE '%review_status = ''needs_gk_review''%'
             ) THEN 'PASS' ELSE 'FAIL' END,
             ''
      UNION ALL
      SELECT 'board_candidate_tables_still_present',
             CASE WHEN to_regclass('kai.board_reporting_candidates') IS NOT NULL
                    AND to_regclass('kai.board_reporting_candidate_members') IS NOT NULL
                  THEN 'PASS' ELSE 'FAIL' END,
             ''
    )
    SELECT 1 FROM checks WHERE status <> 'PASS'
  ) THEN
    RAISE EXCEPTION 'BR-03A verifier failed';
  END IF;
END $$;
