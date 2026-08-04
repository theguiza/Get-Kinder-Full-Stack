BEGIN;

CREATE TEMP TABLE p1_02_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  file1 uuid := '20000000-0000-4000-8000-000000000001';
  parser_run1 uuid := '40000000-0000-4000-8000-000000000001';
  checksum1 text := repeat('1', 64);
  bogus_file uuid := '20000000-0000-4000-8000-000000000999';
  fresh_run uuid;
  run_count integer;
  profile_count integer;
  audit_count integer;
  run_count_before integer;
  run_count_after integer;
  audit_count_before integer;
  audit_count_after integer;
BEGIN
  SELECT count(*) INTO run_count
    FROM kai.intake_parser_runs
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND parser_name = 'kai_local_profiling_kernel'
     AND parser_version = '1.0.0'
     AND checksum = checksum1
     AND run_state = 'succeeded';
  INSERT INTO p1_02_results VALUES ('smoke_seed_parser_run_persisted', CASE WHEN run_count = 1 THEN 'PASS' ELSE 'FAIL' END, 'exactly one succeeded parser run for the accepted identity');

  SELECT count(*) INTO profile_count
    FROM kai.intake_file_profiles
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND parser_run_id = parser_run1
     AND parser_name = 'kai_local_profiling_kernel'
     AND parser_version = '1.0.0'
     AND checksum = checksum1;
  INSERT INTO p1_02_results VALUES ('smoke_seed_file_profile_persisted', CASE WHEN profile_count = 1 THEN 'PASS' ELSE 'FAIL' END, 'exactly one redacted-only profile for the accepted identity');

  SELECT count(*) INTO audit_count
    FROM kai.upload_lifecycle_audit
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND operation IN ('parser_run_recorded', 'file_profile_persisted');
  INSERT INTO p1_02_results VALUES ('smoke_seed_audit_persisted', CASE WHEN audit_count = 2 THEN 'PASS' ELSE 'FAIL' END, 'one audit row per persisted fact');

  INSERT INTO p1_02_results VALUES (
    'cross_tenant_invisible',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.intake_parser_runs
       WHERE organization_id = org2 AND intake_file_id = file1
    ) THEN 'PASS' ELSE 'FAIL' END,
    'tenant/file/parser identity prevents cross-tenant visibility'
  );

  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, run_state, completed_at
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '1.0.0', checksum1, 'succeeded', '2026-08-02T13:05:00Z'
    );
    INSERT INTO p1_02_results VALUES ('duplicate_identity_rejected', 'FAIL', 'duplicate identity insert unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_02_results VALUES ('duplicate_identity_rejected', 'PASS', 'safe unique-violation failure');
  END;

  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, run_state, completed_at
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '2.0.0', checksum1, 'started', '2026-08-02T13:06:00Z'
    );
    INSERT INTO p1_02_results VALUES ('invalid_state_fact_combination_rejected', 'FAIL', 'started run with completed_at unexpectedly succeeded');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('invalid_state_fact_combination_rejected', 'PASS', 'safe check-violation failure');
  END;

  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, run_state
    ) VALUES (
      org1, bogus_file, 'kai_local_profiling_kernel', '1.0.0', checksum1, 'started'
    );
    INSERT INTO p1_02_results VALUES ('nonexistent_intake_file_rejected', 'FAIL', 'foreign-key violation unexpectedly absent');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('nonexistent_intake_file_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  BEGIN
    fresh_run := '40000000-0000-4000-8000-000000000098';
    INSERT INTO kai.intake_parser_runs (
      parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, run_state, completed_at
    ) VALUES (
      fresh_run, org1, file1, 'kai_local_profiling_kernel', '3.0.0', checksum1, 'succeeded', '2026-08-02T13:07:00Z'
    );
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org1, file1, fresh_run, 'kai_local_profiling_kernel', '3.0.0', checksum1,
      '{"note":"contact https://example.com for raw_text"}'::jsonb,
      repeat('a', 64)
    );
    INSERT INTO p1_02_results VALUES ('non_metadata_only_profile_rejected', 'FAIL', 'non-redacted profile content unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('non_metadata_only_profile_rejected', 'PASS', 'safe metadata-only guard failure');
  END;

  BEGIN
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    ) VALUES (
      org1, file1, 'parser_run_without_allowlist', 'reserved', 'reserved', 'success', '{}'::jsonb
    );
    INSERT INTO p1_02_results VALUES ('unapproved_audit_operation_rejected', 'FAIL', 'unapproved audit operation unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('unapproved_audit_operation_rejected', 'PASS', 'safe check-violation failure');
  END;

  SELECT count(*) INTO run_count_before FROM kai.intake_parser_runs;
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit;
  BEGIN
    fresh_run := '40000000-0000-4000-8000-000000000099';
    INSERT INTO kai.intake_parser_runs (
      parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, run_state, completed_at
    ) VALUES (
      fresh_run, org1, file1, 'kai_local_profiling_kernel', '4.0.0', checksum1, 'succeeded', '2026-08-02T13:08:00Z'
    );
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org1, file1, fresh_run, 'kai_local_profiling_kernel', '4.0.0', checksum1,
      '{"status":"profiled"}'::jsonb, repeat('b', 64)
    );
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    ) VALUES (
      org1, file1, 'parser_run_recorded', 'reserved', 'reserved', 'success',
      jsonb_build_object(
        'metadata_only', true, 'contract', 'p1_parser_run_and_file_profile_v1',
        'parser_name', 'kai_local_profiling_kernel', 'parser_version', '4.0.0',
        'checksum_bound', true, 'run_state', 'succeeded', 'failure_reason', null,
        'validator_key', 'VAL-KAI-P1-02-001'
      )
    );
    RAISE EXCEPTION 'force rollback after parser-run, profile, and audit insert';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT count(*) INTO run_count_after FROM kai.intake_parser_runs;
  SELECT count(*) INTO audit_count_after FROM kai.upload_lifecycle_audit;
  INSERT INTO p1_02_results VALUES ('transaction_and_audit_atomicity', CASE WHEN run_count_after = run_count_before AND audit_count_after = audit_count_before THEN 'PASS' ELSE 'FAIL' END, 'forced rollback removed parser-run, profile, and audit side effects together');

  INSERT INTO p1_02_results VALUES (
    'profile_metadata_only_no_leaked_content',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.intake_file_profiles
       WHERE profile::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/)'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'persisted profiles contain metadata-only synthetic values'
  );
  INSERT INTO p1_02_results VALUES (
    'audit_metadata_only_no_raw_profile',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'file_profile_persisted'
         AND (metadata ? 'profile' OR metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/)')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'file-profile audit rows exclude raw profile content'
  );
END $$;

SELECT 'P1_02_SMOKE' AS result_type, check_name, status, detail
FROM p1_02_results
ORDER BY check_name;

ROLLBACK;
