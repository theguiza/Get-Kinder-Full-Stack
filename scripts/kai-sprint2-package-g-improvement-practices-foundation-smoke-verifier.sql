DROP TABLE IF EXISTS package_g_smoke_results;
CREATE TEMP TABLE package_g_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO package_g_smoke_results
SELECT 'org_level_practice_persisted',
       CASE WHEN EXISTS (
         SELECT 1 FROM kai.improvement_practices
          WHERE improvement_practice_id = '17060000-0000-4000-8000-000000000101'
            AND organization_id = '17060000-0000-4000-8000-000000000001'
            AND engagement_id IS NULL
            AND gap_log_item_id IS NULL
            AND status = 'recommended'
            AND cadence = 'quarterly'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'organization-level practice (no engagement, no gap origin) round-trips';

INSERT INTO package_g_smoke_results
SELECT 'engagement_scoped_practice_persisted',
       CASE WHEN EXISTS (
         SELECT 1 FROM kai.improvement_practices
          WHERE improvement_practice_id = '17060000-0000-4000-8000-000000000102'
            AND organization_id = '17060000-0000-4000-8000-000000000001'
            AND engagement_id = '17060000-0000-4000-8000-000000000002'
            AND status = 'active'
            AND cadence = 'monthly'
            AND next_due_date = '2026-10-15'
            AND responsible_actor_user_id = '17060000-0000-4000-8000-000000000902'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'engagement-scoped active practice with next-due date and responsible actor round-trips';

DO $$
DECLARE
  before_updated_at timestamptz;
  after_updated_at timestamptz;
  row_count_after integer;
BEGIN
  SELECT updated_at INTO before_updated_at
    FROM kai.improvement_practices
   WHERE improvement_practice_id = '17060000-0000-4000-8000-000000000101';

  UPDATE kai.improvement_practices
     SET status = 'active'
   WHERE improvement_practice_id = '17060000-0000-4000-8000-000000000101';

  SELECT updated_at INTO after_updated_at
    FROM kai.improvement_practices
   WHERE improvement_practice_id = '17060000-0000-4000-8000-000000000101';

  SELECT count(*) INTO row_count_after
    FROM kai.improvement_practices
   WHERE improvement_practice_id = '17060000-0000-4000-8000-000000000101';

  INSERT INTO package_g_smoke_results VALUES (
    'updated_at_trigger_fires_on_status_change',
    CASE WHEN after_updated_at > before_updated_at THEN 'PASS' ELSE 'FAIL' END,
    'a plain in-place status UPDATE (not a new row) advances updated_at'
  );

  INSERT INTO package_g_smoke_results VALUES (
    'status_reverted_still_one_row',
    CASE WHEN row_count_after = 1 THEN 'PASS' ELSE 'FAIL' END,
    'the status UPDATE mutated the existing row - no second row was inserted'
  );

  UPDATE kai.improvement_practices
     SET status = 'recommended'
   WHERE improvement_practice_id = '17060000-0000-4000-8000-000000000101';
END $$;

SELECT * FROM package_g_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM package_g_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Package G improvement-practices-foundation smoke verifier failed';
  END IF;
END $$;
