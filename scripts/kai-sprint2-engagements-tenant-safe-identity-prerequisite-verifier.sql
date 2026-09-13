-- Read-only structural verifier for the engagements tenant-safe-identity
-- prerequisite. Safe to run against any database, including real
-- production: it only ever SELECTs from the catalog, never mutates
-- anything. Detects the required UNIQUE constraint semantically - by exact
-- column set - not by any specific constraint name, so it PASSes whether
-- the constraint was created by this package's converge script (test/local
-- environments) or already existed under a different name (real
-- production, per USER_CONFIRMED prerequisite).

DROP TABLE IF EXISTS engagements_tenant_safe_identity_prerequisite_results;
CREATE TEMP TABLE engagements_tenant_safe_identity_prerequisite_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO engagements_tenant_safe_identity_prerequisite_results
SELECT 'engagements_table_present',
       CASE WHEN to_regclass('kai.engagements') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
       'kai.engagements exists';

INSERT INTO engagements_tenant_safe_identity_prerequisite_results
SELECT 'engagement_id_column_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_attribute
          WHERE attrelid = to_regclass('kai.engagements')
            AND attname = 'engagement_id'
            AND NOT attisdropped
       ) THEN 'PASS' ELSE 'FAIL' END,
       'kai.engagements.engagement_id exists';

INSERT INTO engagements_tenant_safe_identity_prerequisite_results
SELECT 'organization_id_column_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_attribute
          WHERE attrelid = to_regclass('kai.engagements')
            AND attname = 'organization_id'
            AND NOT attisdropped
       ) THEN 'PASS' ELSE 'FAIL' END,
       'kai.engagements.organization_id exists';

INSERT INTO engagements_tenant_safe_identity_prerequisite_results
SELECT 'tenant_safe_identity_unique_constraint_present',
       CASE WHEN EXISTS (
         SELECT 1
         FROM pg_constraint c
         WHERE c.conrelid = to_regclass('kai.engagements')
           AND c.contype = 'u'
           AND (
             SELECT array_agg(a.attname ORDER BY a.attname)
             FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a
               ON a.attrelid = c.conrelid
              AND a.attnum = k.attnum
           ) = ARRAY['engagement_id', 'organization_id']::name[]
       ) THEN 'PASS' ELSE 'FAIL' END,
       'a UNIQUE constraint exists over exactly (engagement_id, organization_id), under any name';

SELECT * FROM engagements_tenant_safe_identity_prerequisite_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM engagements_tenant_safe_identity_prerequisite_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'engagements tenant-safe-identity prerequisite verifier reported a FAIL - see rows above';
  END IF;
END $$;
