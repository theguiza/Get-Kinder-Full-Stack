-- Read-only failure-mode checks for the engagements tenant-safe-identity
-- prerequisite. Runs after the converge script and smoke-seed have been
-- applied. Proves the constraint is genuinely enforced (not merely present
-- in the catalog) without persisting anything - every probe below runs
-- inside its own aborted subtransaction.

DROP TABLE IF EXISTS engagements_tenant_safe_identity_prerequisite_failure_results;
CREATE TEMP TABLE engagements_tenant_safe_identity_prerequisite_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO kai.engagements (engagement_id, organization_id, engagement_code)
    VALUES ('17000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'etsip-smoke-engagement-dupe');
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO engagements_tenant_safe_identity_prerequisite_failure_results
  VALUES (
    'duplicate_engagement_id_organization_id_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a second row with the same (engagement_id, organization_id) pair must be rejected'
  );
END $$;

SELECT * FROM engagements_tenant_safe_identity_prerequisite_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM engagements_tenant_safe_identity_prerequisite_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'engagements tenant-safe-identity prerequisite failure-checks reported a FAIL - see rows above';
  END IF;
END $$;
