-- Smoke verifier for kai.intake_p1_downstream_attempts, run after the smoke
-- seed in a runner-owned disposable database. Each negative probe runs in
-- its own subtransaction and is rolled back. Every row must report PASS.
CREATE TEMP TABLE p1_recovery_smoke_probe (probe text PRIMARY KEY, rejected boolean NOT NULL);

DO $$
DECLARE
  probe record;
BEGIN
  FOR probe IN
    SELECT * FROM (VALUES
      ('REJECT_FOURTH_ATTEMPT',
       $q$UPDATE kai.intake_p1_downstream_attempts SET attempt_count = 4 WHERE stage = 'p1_04_data_dictionary' AND recovery_state = 'in_progress'$q$),
      ('REJECT_UNKNOWN_STATE',
       $q$UPDATE kai.intake_p1_downstream_attempts SET recovery_state = 'retrying' WHERE recovery_state = 'retry_scheduled'$q$),
      ('REJECT_UNKNOWN_STAGE',
       $q$UPDATE kai.intake_p1_downstream_attempts SET stage = 'p1_06_review_queue' WHERE recovery_state = 'succeeded'$q$),
      ('REJECT_IN_PROGRESS_WITHOUT_CLAIM',
       $q$UPDATE kai.intake_p1_downstream_attempts SET claim_token = NULL WHERE recovery_state = 'in_progress'$q$),
      ('REJECT_EXHAUSTED_BELOW_BUDGET',
       $q$UPDATE kai.intake_p1_downstream_attempts SET recovery_state = 'exhausted', next_eligible_at = NULL WHERE recovery_state = 'retry_scheduled'$q$),
      ('REJECT_RETRY_WITHOUT_ERROR_CODE',
       $q$UPDATE kai.intake_p1_downstream_attempts SET last_error_code = NULL WHERE recovery_state = 'retry_scheduled'$q$),
      ('REJECT_UNSAFE_ERROR_CODE',
       $q$UPDATE kai.intake_p1_downstream_attempts SET last_error_code = 'Connection to /var/run failed' WHERE recovery_state = 'retry_scheduled'$q$),
      ('REJECT_SUCCEEDED_WITH_LIVE_CLAIM',
       $q$UPDATE kai.intake_p1_downstream_attempts SET claim_token = gen_random_uuid(), claim_expires_at = now() WHERE recovery_state = 'succeeded'$q$),
      ('REJECT_DUPLICATE_STAGE_ROW',
       $q$INSERT INTO kai.intake_p1_downstream_attempts SELECT * FROM kai.intake_p1_downstream_attempts WHERE recovery_state = 'succeeded'$q$),
      ('REJECT_CROSS_TENANT_PROFILE',
       $q$UPDATE kai.intake_p1_downstream_attempts SET organization_id = 'a9000000-0000-4000-8000-000000000002' WHERE recovery_state = 'succeeded'$q$),
      ('REJECT_MISMATCHED_CHECKSUM',
       $q$UPDATE kai.intake_p1_downstream_attempts SET checksum = repeat('9', 64) WHERE recovery_state = 'succeeded'$q$)
    ) AS probes(name, statement)
  LOOP
    BEGIN
      EXECUTE probe.statement;
      INSERT INTO p1_recovery_smoke_probe VALUES (probe.name, false);
      RAISE EXCEPTION 'p1_recovery_smoke_rollback';
    EXCEPTION
      WHEN raise_exception THEN
        NULL;
      WHEN others THEN
        INSERT INTO p1_recovery_smoke_probe VALUES (probe.name, true);
    END;
  END LOOP;
END $$;

WITH checks AS (
  SELECT 'SEEDED_STATE' AS check_name, state AS object_name,
         CASE WHEN (SELECT count(*) FROM kai.intake_p1_downstream_attempts WHERE recovery_state = state) = expected THEN 'PASS' ELSE 'FAIL' END AS status,
         'seeded rows in this state: ' || expected AS detail
    FROM (VALUES ('succeeded', 1), ('retry_scheduled', 1), ('in_progress', 1)) AS e(state, expected)
  UNION ALL
  SELECT 'CONSTRAINT_PROBE', name,
         CASE WHEN (SELECT rejected FROM p1_recovery_smoke_probe WHERE probe = name) IS TRUE THEN 'PASS' ELSE 'FAIL' END,
         'invalid write rejected by the schema'
    FROM (VALUES
      ('REJECT_FOURTH_ATTEMPT'), ('REJECT_UNKNOWN_STATE'), ('REJECT_UNKNOWN_STAGE'), ('REJECT_IN_PROGRESS_WITHOUT_CLAIM'),
      ('REJECT_EXHAUSTED_BELOW_BUDGET'), ('REJECT_RETRY_WITHOUT_ERROR_CODE'), ('REJECT_UNSAFE_ERROR_CODE'),
      ('REJECT_SUCCEEDED_WITH_LIVE_CLAIM'), ('REJECT_DUPLICATE_STAGE_ROW'), ('REJECT_CROSS_TENANT_PROFILE'),
      ('REJECT_MISMATCHED_CHECKSUM')
    ) AS p(name)
  UNION ALL
  SELECT 'SEED_UNCHANGED_AFTER_PROBES', 'kai.intake_p1_downstream_attempts',
         CASE WHEN (SELECT count(*) FROM kai.intake_p1_downstream_attempts) = 3 THEN 'PASS' ELSE 'FAIL' END,
         'every probe rolled back'
)
SELECT 'P1_DOWNSTREAM_RECOVERY_SMOKE' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
