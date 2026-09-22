DROP TABLE IF EXISTS package_g_results;
CREATE TEMP TABLE package_g_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO package_g_results
SELECT 'improvement_practices_table_present',
       CASE WHEN to_regclass('kai.improvement_practices') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.improvement_practices exists';

INSERT INTO package_g_results
SELECT 'id_org_unique_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'improvement_practices_g_id_org_unique'
            AND conrelid = 'kai.improvement_practices'::regclass
            AND contype = 'u'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'UNIQUE (improvement_practice_id, organization_id) is present';

INSERT INTO package_g_results
SELECT 'organization_fk_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'improvement_practices_g_organization_fk'
            AND c.conrelid = 'kai.improvement_practices'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'kai.organizations'::regclass
       ) THEN 'PASS' ELSE 'FAIL' END,
       'organization_id FK into kai.organizations is present';

INSERT INTO package_g_results
SELECT 'engagement_fk_is_tenant_safe',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'improvement_practices_g_engagement_fk'
            AND c.conrelid = 'kai.improvement_practices'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'kai.engagements'::regclass
            AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (engagement_id, organization_id)%'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'optional engagement FK is scoped by organization_id';

INSERT INTO package_g_results
SELECT 'gap_log_item_fk_is_tenant_safe',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint c
          WHERE c.conname = 'improvement_practices_g_gap_log_item_fk'
            AND c.conrelid = 'kai.improvement_practices'::regclass
            AND c.contype = 'f'
            AND c.confrelid = 'kai.gap_log_items'::regclass
            AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (gap_log_item_id, organization_id)%'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'optional gap_log_item origin FK is scoped by organization_id';

INSERT INTO package_g_results
SELECT 'status_check_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'improvement_practices_g_status_check'
            AND conrelid = 'kai.improvement_practices'::regclass
            AND contype = 'c'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'status is pinned to recommended/active/paused/completed';

INSERT INTO package_g_results
SELECT 'cadence_check_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'improvement_practices_g_cadence_check'
            AND conrelid = 'kai.improvement_practices'::regclass
            AND contype = 'c'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'cadence is pinned to the approved cadence vocabulary';

INSERT INTO package_g_results
SELECT 'title_rationale_checks_present',
       CASE WHEN (
         SELECT count(*) FROM pg_constraint
          WHERE conrelid = 'kai.improvement_practices'::regclass
            AND contype = 'c'
            AND conname IN ('improvement_practices_g_title_check', 'improvement_practices_g_rationale_check')
       ) = 2 THEN 'PASS' ELSE 'FAIL' END,
       'title/rationale non-blank bounded-text CHECKs are present';

INSERT INTO package_g_results
SELECT 'created_by_type_check_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'improvement_practices_g_created_by_type_check'
            AND conrelid = 'kai.improvement_practices'::regclass
            AND contype = 'c'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'created_by_type is pinned to human/system';

INSERT INTO package_g_results
SELECT 'touch_updated_at_trigger_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgname = 'trg_improvement_practices_touch_updated_at'
            AND tgrelid = 'kai.improvement_practices'::regclass
       ) THEN 'PASS' ELSE 'FAIL' END,
       'updated_at BEFORE UPDATE trigger is present';

INSERT INTO package_g_results
SELECT 'supporting_indexes_present',
       CASE WHEN (
         SELECT count(*) FROM pg_indexes
          WHERE schemaname = 'kai'
            AND indexname IN (
              'ix_improvement_practices_g_tenant_engagement',
              'ix_improvement_practices_g_tenant_status',
              'ix_improvement_practices_g_tenant_gap'
            )
       ) = 3 THEN 'PASS' ELSE 'FAIL' END,
       'tenant/status/gap supporting indexes are present';

INSERT INTO package_g_results
SELECT 'table_is_mutable_not_append_only',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM pg_trigger
          WHERE tgrelid = 'kai.improvement_practices'::regclass
            AND tgname LIKE '%append_only%'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'no append-only-style reject-mutation trigger exists - practices are ordinary mutable rows';

SELECT * FROM package_g_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM package_g_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Package G improvement-practices-foundation verifier failed';
  END IF;
END $$;
