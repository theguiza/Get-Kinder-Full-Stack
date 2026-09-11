-- Reproduction-only fixture for the local-Postgres regression
-- (scripts/kai-sprint2-p14-10-review-queue-target-object-type-repair-local-postgres.js).
-- This is NOT a migration and must never run against a real database: it
-- exists solely to transform an otherwise-normal, fully-migrated local test
-- schema into the exact USER_CONFIRMED production-drift condition (the
-- canonical P1-06 generic constraint replaced by the obsolete, narrower
-- legacy allowlist that excludes 'generated_content_draft'), so the P14-10
-- repair migration can be proven against a faithful "before" state.
--
-- The exact original legacy allowlist vocabulary was not recorded anywhere
-- in this repository; only the fact that it excluded
-- 'generated_content_draft' is USER_CONFIRMED. Rather than hand-pick a fixed
-- list that could drift from whatever this runner's own upstream smoke seeds
-- happen to populate, this fixture builds the reproduction allowlist from
-- every target_object_type value already present at this point in the
-- runner (before any generated_content_draft exists), explicitly excluding
-- 'generated_content_draft' regardless - reproducing the one USER_CONFIRMED
-- fact precisely, without asserting the reproduction is byte-for-byte
-- identical to the real production allowlist.
BEGIN;

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p1_06_target_object_type_check;

DO $$
DECLARE
  allowlist text[];
BEGIN
  SELECT array_agg(DISTINCT target_object_type ORDER BY target_object_type)
    INTO allowlist
    FROM kai.review_queue_items
   WHERE target_object_type <> 'generated_content_draft';

  IF allowlist IS NULL THEN
    allowlist := ARRAY['intake_file'];
  END IF;

  EXECUTE format(
    'ALTER TABLE kai.review_queue_items ADD CONSTRAINT review_queue_items_target_object_type_check CHECK (target_object_type = ANY (%L::text[]))',
    allowlist
  );
END $$;

COMMIT;
