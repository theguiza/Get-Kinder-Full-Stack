DROP TABLE IF EXISTS engagements_tenant_safe_identity_prerequisite_smoke_results;
CREATE TEMP TABLE engagements_tenant_safe_identity_prerequisite_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO engagements_tenant_safe_identity_prerequisite_smoke_results
SELECT 'seeded_engagement_present',
       CASE WHEN EXISTS (
         SELECT 1 FROM kai.engagements
          WHERE engagement_id = '17000000-0000-4000-8000-000000000001'
            AND organization_id = '00000000-0000-4000-8000-000000000001'
       ) THEN 'PASS' ELSE 'FAIL' END,
       'seeded synthetic engagement row exists';

-- The real consumer of this prerequisite is a composite FOREIGN KEY
-- (engagement_id, organization_id) REFERENCES kai.engagements
-- (engagement_id, organization_id) - exactly what
-- migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.sql
-- declares. PostgreSQL requires a UNIQUE (or PK) constraint over exactly
-- the referenced column set to accept such a composite FK. Prove that
-- requirement is actually satisfied, not merely that a constraint with the
-- right shape exists in the catalog.
DO $$
BEGIN
  DROP TABLE IF EXISTS etsip_smoke_fk_probe;
  CREATE TABLE etsip_smoke_fk_probe (
    engagement_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    FOREIGN KEY (engagement_id, organization_id)
      REFERENCES kai.engagements (engagement_id, organization_id)
  );
  DROP TABLE etsip_smoke_fk_probe;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'composite FK probe against kai.engagements (engagement_id, organization_id) failed: %', SQLERRM;
END $$;

INSERT INTO engagements_tenant_safe_identity_prerequisite_smoke_results
VALUES ('composite_fk_probe_succeeds', 'PASS', 'a composite FK referencing (engagement_id, organization_id) can be created');

SELECT * FROM engagements_tenant_safe_identity_prerequisite_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM engagements_tenant_safe_identity_prerequisite_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'engagements tenant-safe-identity prerequisite smoke verifier reported a FAIL - see rows above';
  END IF;
END $$;
