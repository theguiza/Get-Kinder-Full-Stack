WITH checks AS (
  SELECT 'conflicting_rows_preserved' AS check_name,
         CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS status,
         'conflicting synthetic rows remain present; repair performed no cleanup' AS detail
    FROM kai.intake_files
   WHERE organization_id = '00000000-0000-4000-8000-000000000201'
     AND checksum = repeat('2', 64)
     AND force_new_version = false
  UNION ALL
  SELECT 'no_required_indexes_partially_created',
         CASE WHEN to_regclass('kai.ux_intake_files_gate_a_org_declared_checksum') IS NULL
                AND to_regclass('kai.ix_intake_files_gate_a_tenant_upload_state') IS NULL
                AND to_regclass('kai.ix_intake_files_gate_a_object_version') IS NULL
              THEN 'PASS' ELSE 'FAIL' END,
         'failed unique-index creation left the transaction rolled back with no partial index repair'
)
SELECT 'GATE_A_REQUIRED_INDEX_CONFLICT_FAIL_CLOSED' AS result_type, check_name, status, detail
FROM checks
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (
    WITH checks AS (
      SELECT CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS status
        FROM kai.intake_files
       WHERE organization_id = '00000000-0000-4000-8000-000000000201'
         AND checksum = repeat('2', 64)
         AND force_new_version = false
      UNION ALL
      SELECT CASE WHEN to_regclass('kai.ux_intake_files_gate_a_org_declared_checksum') IS NULL
                    AND to_regclass('kai.ix_intake_files_gate_a_tenant_upload_state') IS NULL
                    AND to_regclass('kai.ix_intake_files_gate_a_object_version') IS NULL
                  THEN 'PASS' ELSE 'FAIL' END
    )
    SELECT 1 FROM checks WHERE status <> 'PASS'
  ) THEN
    RAISE EXCEPTION 'Gate A required-index conflict fail-closed verifier failed';
  END IF;
END $$;
