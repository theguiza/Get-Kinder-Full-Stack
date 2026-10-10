-- Read-only data invariant checks for kai.intake_p1_downstream_attempts.
-- Safe to run against any database that has the migration; every row must
-- report PASS. Selects identities and counts only.
WITH checks AS (
  SELECT 'NO_SUCCEEDED_P1_04_WITHOUT_DICTIONARY' AS check_name,
         'kai.intake_p1_downstream_attempts' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_p1_downstream_attempts a
            WHERE a.stage = 'p1_04_data_dictionary' AND a.recovery_state = 'succeeded'
              AND NOT EXISTS (SELECT 1 FROM kai.data_dictionaries d
                               WHERE d.organization_id = a.organization_id AND d.file_profile_id = a.file_profile_id)
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'a recorded P1-04 success always has its committed dictionary bundle' AS detail
  UNION ALL
  SELECT 'NO_SUCCEEDED_P1_05_WITHOUT_SENSITIVITY_PROFILE', 'kai.intake_p1_downstream_attempts',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_p1_downstream_attempts a
            WHERE a.stage = 'p1_05_sensitivity_profile' AND a.recovery_state = 'succeeded'
              AND NOT EXISTS (SELECT 1 FROM kai.intake_sensitivity_profiles s
                               WHERE s.organization_id = a.organization_id AND s.file_profile_id = a.file_profile_id)
         ) THEN 'PASS' ELSE 'FAIL' END,
         'a recorded P1-05 success always has its committed sensitivity profile'
  UNION ALL
  SELECT 'NO_P1_05_STATE_WITHOUT_P1_04_OUTPUT', 'kai.intake_p1_downstream_attempts',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_p1_downstream_attempts a
            WHERE a.stage = 'p1_05_sensitivity_profile'
              AND NOT EXISTS (SELECT 1 FROM kai.data_dictionaries d
                               WHERE d.organization_id = a.organization_id AND d.file_profile_id = a.file_profile_id)
         ) THEN 'PASS' ELSE 'FAIL' END,
         'P1-05 is only ever attempted after a committed P1-04 bundle'
  UNION ALL
  SELECT 'NO_ATTEMPT_FOR_UNCOMPLETED_PROFILE', 'kai.intake_p1_downstream_attempts',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_p1_downstream_attempts a
            WHERE NOT EXISTS (SELECT 1 FROM kai.intake_parser_runs r
                               WHERE r.output_profile_id = a.file_profile_id AND r.organization_id = a.organization_id
                                 AND r.parser_status = 'completed')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'downstream work only follows a completed P1-03 run'
  UNION ALL
  SELECT 'NO_LIVE_CLAIM_BEYOND_LEASE_BOUND', 'kai.intake_p1_downstream_attempts',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_p1_downstream_attempts a
            WHERE a.recovery_state = 'in_progress' AND a.claim_expires_at > a.last_attempt_at + interval '120 seconds'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no claim lease longer than the 120-second contract'
  UNION ALL
  SELECT 'NO_COOLDOWN_BEYOND_POLICY', 'kai.intake_p1_downstream_attempts',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM kai.intake_p1_downstream_attempts a
            WHERE a.recovery_state = 'retry_scheduled' AND a.next_eligible_at > a.updated_at + interval '300 seconds'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no cooldown longer than five minutes'
  UNION ALL
  SELECT 'NO_LATER_PACKAGE_COLUMNS', 'kai.intake_p1_downstream_attempts',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'kai' AND table_name = 'intake_p1_downstream_attempts'
              AND column_name ~ '(review|approval|decision|source|evidence|claim_id|profile_json|message|content|storage|url)'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no human-review, approval, source, evidence, content, or storage column'
)
SELECT 'P1_DOWNSTREAM_RECOVERY_FAILURE_CHECK' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name;
