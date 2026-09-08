DROP TABLE IF EXISTS p3_20_results;
DROP TABLE IF EXISTS p3_20_expected_checks;

CREATE TEMP TABLE p3_20_expected_checks (
  check_name text PRIMARY KEY
);

INSERT INTO p3_20_expected_checks (check_name)
VALUES
  ('export_review_queue_item_id_column_present'),
  ('export_review_queue_item_id_not_null'),
  ('review_queue_item_fk_present'),
  ('review_queue_items_id_org_unique_present'),
  ('no_unique_constraint_on_review_queue_item_id_alone'),
  ('lookup_index_present'),
  ('append_only_trigger_still_present'),
  ('replay_convergence_key_unchanged'),
  ('no_latest_or_current_column');

CREATE TEMP TABLE p3_20_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p3_20_results
SELECT 'export_review_queue_item_id_column_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'export_manifests'
                 AND column_name = 'export_review_queue_item_id'
                 AND data_type = 'uuid'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.export_manifests carries the exact originating export_review_queue_item_id (DIRECT_MANIFEST_REVIEW_BINDING)';

INSERT INTO p3_20_results
SELECT 'export_review_queue_item_id_not_null',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'export_manifests'
                 AND column_name = 'export_review_queue_item_id'
                 AND is_nullable = 'NO'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'every manifest row must carry its originating review-item identity - no row is ever left without one';

INSERT INTO p3_20_results
SELECT 'review_queue_item_fk_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_manifests_p3_20_review_queue_item_fk'
                 AND pg_get_constraintdef(c.oid) LIKE '%review_queue_items%'
                 AND pg_get_constraintdef(c.oid) LIKE '%organization_id%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'every manifest binds to exactly one existing (organization, review_queue_item) row - lineage cannot cross tenant';

INSERT INTO p3_20_results
SELECT 'review_queue_items_id_org_unique_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_20_id_org_unique'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.review_queue_items carries the tenant-safe (review_queue_item_id, organization_id) identity the P3-20 FK requires, consistent with every other FK-target table in this schema';

INSERT INTO p3_20_results
SELECT 'no_unique_constraint_on_review_queue_item_id_alone',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class r ON r.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = r.relnamespace
               WHERE n.nspname = 'kai'
                 AND r.relname = 'export_manifests'
                 AND c.contype IN ('u', 'p')
                 AND array_length(c.conkey, 1) = 1
                 AND c.conkey[1] = (
                       SELECT attnum FROM pg_attribute
                        WHERE attrelid = r.oid AND attname = 'export_review_queue_item_id'
                     )
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'export_review_queue_item_id alone is never unique - one review item legitimately backs multiple historical manifests, by owner decision (DIRECT_MANIFEST_REVIEW_BINDING)';

INSERT INTO p3_20_results
SELECT 'lookup_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai' AND tablename = 'export_manifests'
                 AND indexname = 'ix_export_manifests_p3_20_review_queue_item'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'a non-unique (organization_id, export_review_queue_item_id) index exists for reading every historical manifest for a review item - not a latest/current selection';

INSERT INTO p3_20_results
SELECT 'append_only_trigger_still_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_p3_19_export_manifests_append_only'
                 AND tgrelid = 'kai.export_manifests'::regclass
                 AND NOT tgisinternal
                 AND tgenabled = 'O'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the P3-19 append-only trigger is unchanged and re-enabled after this migration''s own backfill - ordinary UPDATE/DELETE of kai.export_manifests remains rejected';

INSERT INTO p3_20_results
SELECT 'replay_convergence_key_unchanged',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conname = 'export_manifests_p3_19_replay_convergence_unique'
                 AND pg_get_constraintdef(c.oid) = 'UNIQUE (organization_id, export_candidate_id, canonical_fingerprint)'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the P3-19 replay/fingerprint key is exactly unchanged - export_review_queue_item_id is not part of it';

INSERT INTO p3_20_results
SELECT 'no_latest_or_current_column',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'export_manifests'
                 AND column_name IN ('is_current', 'is_latest', 'is_active', 'current', 'latest', 'active')
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no latest/current/active column was added - recovery of historical manifests for a review item is by exact relationship only';

DO $$
DECLARE
  expected_count integer := 9;
BEGIN
  IF (SELECT COUNT(*) FROM p3_20_expected_checks) <> expected_count
     OR (SELECT COUNT(*) FROM p3_20_results) <> expected_count
     OR EXISTS (
          SELECT 1
            FROM p3_20_results r
           GROUP BY r.check_name
          HAVING COUNT(*) <> 1
        )
     OR EXISTS (
          SELECT 1
            FROM p3_20_expected_checks e
            LEFT JOIN p3_20_results r ON r.check_name = e.check_name
           WHERE r.check_name IS NULL
        )
     OR EXISTS (
          SELECT 1
            FROM p3_20_results r
            LEFT JOIN p3_20_expected_checks e ON e.check_name = r.check_name
           WHERE e.check_name IS NULL
        ) THEN
    RAISE EXCEPTION 'P3-20 export-manifest-review-binding verifier result construction failed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_20_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-20 export-manifest-review-binding verifier failed';
  END IF;
END $$;

SELECT
  check_name,
  status,
  detail
FROM p3_20_results
ORDER BY check_name;
