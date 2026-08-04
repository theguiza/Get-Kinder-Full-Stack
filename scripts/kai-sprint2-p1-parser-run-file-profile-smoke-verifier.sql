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
  file1b uuid := '20000000-0000-4000-8000-000000000101';
  file2 uuid := '20000000-0000-4000-8000-000000000002';
  parser_run1 uuid := '40000000-0000-4000-8000-000000000001';
  profile1 uuid := '50000000-0000-4000-8000-000000000001';
  checksum1 text := repeat('1', 64);
  checksum2 text := repeat('2', 64);
  bogus_file uuid := '20000000-0000-4000-8000-000000000999';
  nonexistent_run uuid := '40000000-0000-4000-8000-000000000999';
  fresh_run uuid;
  run_count integer;
  profile_count integer;
  audit_count integer;
  run_count_before integer;
  run_count_after integer;
  audit_count_before integer;
  audit_count_after integer;
  run_b uuid := '40000000-0000-4000-8000-000000000200';
  profile_b uuid := '50000000-0000-4000-8000-000000000200';
  run_org2 uuid := '40000000-0000-4000-8000-000000000201';
  profile_org2 uuid := '50000000-0000-4000-8000-000000000201';
  run_c uuid;
BEGIN
  -- second intake_file for org1, distinct checksum, used only to test intake_file_id-mismatch rejection
  INSERT INTO kai.intake_files (
    intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename, checksum, hash_algorithm, created_at
  ) VALUES (
    file1b, '10000000-0000-4000-8000-000000000001', org1, 'gate-a-one-b.pdf', 'gate-a-one-b.pdf', repeat('3', 64), 'sha256', '2026-08-02T12:00:00Z'
  );

  SELECT count(*) INTO run_count
    FROM kai.intake_parser_runs
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND parser_name = 'kai_local_profiling_kernel'
     AND parser_version = '1.0.0'
     AND checksum = checksum1
     AND parser_status = 'completed'
     AND output_profile_id = profile1;
  INSERT INTO p1_02_results VALUES ('smoke_seed_parser_run_persisted', CASE WHEN run_count = 1 THEN 'PASS' ELSE 'FAIL' END, 'exactly one completed parser run with output_profile_id for the accepted identity');

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
    'exact_identity_success',
    CASE WHEN EXISTS (
      SELECT 1
        FROM kai.intake_parser_runs pr
        JOIN kai.intake_file_profiles fp
          ON fp.parser_run_id = pr.parser_run_id
         AND fp.organization_id = pr.organization_id
         AND fp.intake_file_id = pr.intake_file_id
         AND fp.parser_name = pr.parser_name
         AND fp.parser_version = pr.parser_version
         AND fp.checksum = pr.checksum
       WHERE pr.parser_run_id = parser_run1
    ) THEN 'PASS' ELSE 'FAIL' END,
    'profile with an exactly matching run identity is accepted'
  );

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
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at, output_profile_id
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '1.0.0', checksum1, 'completed', '2026-08-02T13:05:00Z', profile1
    );
    INSERT INTO p1_02_results VALUES ('duplicate_identity_rejected', 'FAIL', 'duplicate identity insert unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_02_results VALUES ('duplicate_identity_rejected', 'PASS', 'safe unique-violation failure');
  END;

  -- queued lifecycle facts (positive)
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.0.0', checksum1, 'queued'
    );
    INSERT INTO p1_02_results VALUES ('queued_lifecycle_facts', 'PASS', 'queued run with no completed_at/output_profile_id/error fields accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO p1_02_results VALUES ('queued_lifecycle_facts', 'FAIL', 'valid queued run unexpectedly rejected: ' || SQLERRM);
  END;

  -- running lifecycle facts (positive)
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.1.0', checksum1, 'running', '2026-08-02T13:00:00Z'
    );
    INSERT INTO p1_02_results VALUES ('running_lifecycle_facts', 'PASS', 'running run with started_at and no completed_at/output_profile_id/error fields accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO p1_02_results VALUES ('running_lifecycle_facts', 'FAIL', 'valid running run unexpectedly rejected: ' || SQLERRM);
  END;

  -- completed lifecycle facts (positive; reuses the smoke-seed row)
  INSERT INTO p1_02_results VALUES (
    'completed_lifecycle_facts',
    CASE WHEN EXISTS (
      SELECT 1 FROM kai.intake_parser_runs
       WHERE parser_run_id = parser_run1
         AND parser_status = 'completed'
         AND started_at IS NOT NULL
         AND completed_at IS NOT NULL
         AND output_profile_id IS NOT NULL
         AND error_code IS NULL
         AND error_message_safe IS NULL
    ) THEN 'PASS' ELSE 'FAIL' END,
    'completed run carries started_at/completed_at/output_profile_id and no error fields'
  );

  -- failed lifecycle facts (positive)
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at, error_code, error_message_safe
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.2.0', checksum1, 'failed', '2026-08-02T13:00:05Z', 'parser_timeout', 'parser exceeded time budget'
    );
    INSERT INTO p1_02_results VALUES ('failed_lifecycle_facts', 'PASS', 'failed run with error_code/error_message_safe and no output_profile_id accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO p1_02_results VALUES ('failed_lifecycle_facts', 'FAIL', 'valid failed run unexpectedly rejected: ' || SQLERRM);
  END;

  -- cancelled lifecycle facts (positive)
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.3.0', checksum1, 'cancelled', '2026-08-02T13:00:05Z'
    );
    INSERT INTO p1_02_results VALUES ('cancelled_lifecycle_facts', 'PASS', 'cancelled run with completed_at and no output_profile_id accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO p1_02_results VALUES ('cancelled_lifecycle_facts', 'FAIL', 'valid cancelled run unexpectedly rejected: ' || SQLERRM);
  END;

  -- generic invalid state/fact combination (queued with completed_at set)
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.4.0', checksum1, 'queued', '2026-08-02T13:06:00Z'
    );
    INSERT INTO p1_02_results VALUES ('invalid_state_fact_combination_rejected', 'FAIL', 'queued run with completed_at unexpectedly succeeded');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('invalid_state_fact_combination_rejected', 'PASS', 'safe check-violation failure');
  END;

  -- completed run requires output_profile_id
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.5.0', checksum1, 'completed', '2026-08-02T13:06:00Z'
    );
    INSERT INTO p1_02_results VALUES ('completed_requires_output_profile_id', 'FAIL', 'completed run without output_profile_id unexpectedly succeeded');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('completed_requires_output_profile_id', 'PASS', 'safe check-violation failure');
  END;

  -- failed run rejects output_profile_id
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at, error_code, error_message_safe, output_profile_id
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.6.0', checksum1, 'failed', '2026-08-02T13:06:00Z', 'parser_timeout', 'parser exceeded time budget', profile1
    );
    INSERT INTO p1_02_results VALUES ('failed_rejects_output_profile_id', 'FAIL', 'failed run with output_profile_id unexpectedly succeeded');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('failed_rejects_output_profile_id', 'PASS', 'safe check-violation failure');
  END;

  -- cancelled run rejects output_profile_id
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at, output_profile_id
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.7.0', checksum1, 'cancelled', '2026-08-02T13:06:00Z', profile1
    );
    INSERT INTO p1_02_results VALUES ('cancelled_rejects_output_profile_id', 'FAIL', 'cancelled run with output_profile_id unexpectedly succeeded');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('cancelled_rejects_output_profile_id', 'PASS', 'safe check-violation failure');
  END;

  -- safe error-code constraint
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at, error_code, error_message_safe
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.8.0', checksum1, 'failed', '2026-08-02T13:06:00Z', 'Parser Error!', 'parser exceeded time budget'
    );
    INSERT INTO p1_02_results VALUES ('safe_error_code_constraint', 'FAIL', 'unsafe error_code unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('safe_error_code_constraint', 'PASS', 'safe check-violation failure');
  END;

  -- safe error-message constraint
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, completed_at, error_code, error_message_safe
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.9.0', checksum1, 'failed', '2026-08-02T13:06:00Z', 'parser_timeout', 'contact https://example.com for the stack trace'
    );
    INSERT INTO p1_02_results VALUES ('safe_error_message_constraint', 'FAIL', 'unsafe error_message_safe unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('safe_error_message_constraint', 'PASS', 'safe check-violation failure');
  END;

  -- retry_count lower bound
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, retry_count
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.10.0', checksum1, 'queued', -1
    );
    INSERT INTO p1_02_results VALUES ('retry_count_lower_bound', 'FAIL', 'retry_count below zero unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('retry_count_lower_bound', 'PASS', 'safe check-violation failure');
  END;

  -- retry_count upper bound
  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, retry_count
    ) VALUES (
      org1, file1, 'kai_local_profiling_kernel', '10.11.0', checksum1, 'queued', 4
    );
    INSERT INTO p1_02_results VALUES ('retry_count_upper_bound', 'FAIL', 'retry_count above three unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_02_results VALUES ('retry_count_upper_bound', 'PASS', 'safe check-violation failure');
  END;

  BEGIN
    INSERT INTO kai.intake_parser_runs (
      organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status
    ) VALUES (
      org1, bogus_file, 'kai_local_profiling_kernel', '1.0.0', checksum1, 'queued'
    );
    INSERT INTO p1_02_results VALUES ('nonexistent_intake_file_rejected', 'FAIL', 'foreign-key violation unexpectedly absent');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('nonexistent_intake_file_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  BEGIN
    fresh_run := '40000000-0000-4000-8000-000000000098';
    INSERT INTO kai.intake_parser_runs (
      parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
    ) VALUES (
      fresh_run, org1, file1, 'kai_local_profiling_kernel', '3.0.0', checksum1, 'running', '2026-08-02T13:07:00Z'
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

  -- set up two independently completed runs (run_b under org1, run_org2 under org2) to use as
  -- "belongs to another run"/"belongs to another tenant" targets for the mismatch tests below
  INSERT INTO kai.intake_parser_runs (
    parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
  ) VALUES (
    run_b, org1, file1, 'kai_local_profiling_kernel', '8.0.0', checksum1, 'running', '2026-08-02T13:00:00Z'
  );
  INSERT INTO kai.intake_file_profiles (
    file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
  ) VALUES (
    profile_b, org1, file1, run_b, 'kai_local_profiling_kernel', '8.0.0', checksum1, '{"status":"profiled"}'::jsonb, repeat('c', 64)
  );
  UPDATE kai.intake_parser_runs
     SET parser_status = 'completed', completed_at = '2026-08-02T13:00:05Z', output_profile_id = profile_b
   WHERE parser_run_id = run_b;

  INSERT INTO kai.intake_parser_runs (
    parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
  ) VALUES (
    run_org2, org2, file2, 'kai_local_profiling_kernel', '1.0.0', checksum2, 'running', '2026-08-02T13:00:00Z'
  );
  INSERT INTO kai.intake_file_profiles (
    file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
  ) VALUES (
    profile_org2, org2, file2, run_org2, 'kai_local_profiling_kernel', '1.0.0', checksum2, '{"status":"profiled"}'::jsonb, repeat('d', 64)
  );
  UPDATE kai.intake_parser_runs
     SET parser_status = 'completed', completed_at = '2026-08-02T13:00:05Z', output_profile_id = profile_org2
   WHERE parser_run_id = run_org2;

  -- a plain running parser run (org1/file1/9.0.0) used as the anchor for the profile-to-run mismatch tests
  fresh_run := '40000000-0000-4000-8000-000000000202';
  INSERT INTO kai.intake_parser_runs (
    parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
  ) VALUES (
    fresh_run, org1, file1, 'kai_local_profiling_kernel', '9.0.0', checksum1, 'running', '2026-08-02T13:00:00Z'
  );

  -- organization_id differs (valid org2/file2 pair, but that identity does not match fresh_run's row)
  BEGIN
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org2, file2, fresh_run, 'kai_local_profiling_kernel', '9.0.0', checksum1, '{"status":"profiled"}'::jsonb, repeat('e', 64)
    );
    INSERT INTO p1_02_results VALUES ('mismatch_organization_id_rejected', 'FAIL', 'organization_id mismatch unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('mismatch_organization_id_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- intake_file_id differs (valid org1/file1b pair, but that identity does not match fresh_run's row)
  BEGIN
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org1, file1b, fresh_run, 'kai_local_profiling_kernel', '9.0.0', checksum1, '{"status":"profiled"}'::jsonb, repeat('f', 64)
    );
    INSERT INTO p1_02_results VALUES ('mismatch_intake_file_id_rejected', 'FAIL', 'intake_file_id mismatch unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('mismatch_intake_file_id_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- parser_name differs
  BEGIN
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org1, file1, fresh_run, 'other_parser', '9.0.0', checksum1, '{"status":"profiled"}'::jsonb, repeat('1', 64)
    );
    INSERT INTO p1_02_results VALUES ('mismatch_parser_name_rejected', 'FAIL', 'parser_name mismatch unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('mismatch_parser_name_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- parser_version differs
  BEGIN
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org1, file1, fresh_run, 'kai_local_profiling_kernel', '9.0.1', checksum1, '{"status":"profiled"}'::jsonb, repeat('2', 64)
    );
    INSERT INTO p1_02_results VALUES ('mismatch_parser_version_rejected', 'FAIL', 'parser_version mismatch unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('mismatch_parser_version_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- checksum differs
  BEGIN
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org1, file1, fresh_run, 'kai_local_profiling_kernel', '9.0.0', repeat('4', 64), '{"status":"profiled"}'::jsonb, repeat('3', 64)
    );
    INSERT INTO p1_02_results VALUES ('mismatch_checksum_rejected', 'FAIL', 'checksum mismatch unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('mismatch_checksum_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- parser_run_id does not exist
  BEGIN
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org1, file1, nonexistent_run, 'kai_local_profiling_kernel', '9.0.0', checksum1, '{"status":"profiled"}'::jsonb, repeat('5', 64)
    );
    INSERT INTO p1_02_results VALUES ('mismatch_nonexistent_parser_run_rejected', 'FAIL', 'nonexistent parser_run_id unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('mismatch_nonexistent_parser_run_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- output_profile_id belongs to another parser run (profile_b belongs to run_b's 8.0.0 identity, not run_c's)
  BEGIN
    run_c := '40000000-0000-4000-8000-000000000203';
    INSERT INTO kai.intake_parser_runs (
      parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
    ) VALUES (
      run_c, org1, file1, 'kai_local_profiling_kernel', '9.5.0', checksum1, 'running', '2026-08-02T13:00:00Z'
    );
    UPDATE kai.intake_parser_runs
       SET parser_status = 'completed', completed_at = '2026-08-02T13:00:05Z', output_profile_id = profile_b
     WHERE parser_run_id = run_c;
    INSERT INTO p1_02_results VALUES ('mismatch_output_profile_other_run_rejected', 'FAIL', 'output_profile_id belonging to another run unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('mismatch_output_profile_other_run_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- output_profile_id belongs to another tenant (profile_org2 belongs to org2/file2, not org1/file1)
  BEGIN
    run_c := '40000000-0000-4000-8000-000000000204';
    INSERT INTO kai.intake_parser_runs (
      parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
    ) VALUES (
      run_c, org1, file1, 'kai_local_profiling_kernel', '9.6.0', checksum1, 'running', '2026-08-02T13:00:00Z'
    );
    UPDATE kai.intake_parser_runs
       SET parser_status = 'completed', completed_at = '2026-08-02T13:00:05Z', output_profile_id = profile_org2
     WHERE parser_run_id = run_c;
    INSERT INTO p1_02_results VALUES ('mismatch_output_profile_other_tenant_rejected', 'FAIL', 'output_profile_id belonging to another tenant unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_02_results VALUES ('mismatch_output_profile_other_tenant_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  SELECT count(*) INTO run_count_before FROM kai.intake_parser_runs;
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit;
  BEGIN
    fresh_run := '40000000-0000-4000-8000-000000000099';
    INSERT INTO kai.intake_parser_runs (
      parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
    ) VALUES (
      fresh_run, org1, file1, 'kai_local_profiling_kernel', '4.0.0', checksum1, 'running', '2026-08-02T13:08:00Z'
    );
    INSERT INTO kai.intake_file_profiles (
      organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum, profile, profile_canonical_sha256
    ) VALUES (
      org1, file1, fresh_run, 'kai_local_profiling_kernel', '4.0.0', checksum1,
      '{"status":"profiled"}'::jsonb, repeat('b', 64)
    );
    UPDATE kai.intake_parser_runs
       SET parser_status = 'completed', completed_at = '2026-08-02T13:08:05Z',
           output_profile_id = (
             SELECT file_profile_id FROM kai.intake_file_profiles
              WHERE parser_run_id = fresh_run
           )
     WHERE parser_run_id = fresh_run;
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    ) VALUES (
      org1, file1, 'parser_run_recorded', 'reserved', 'reserved', 'success',
      jsonb_build_object(
        'metadata_only', true, 'contract', 'p1_parser_run_and_file_profile_v1',
        'parser_name', 'kai_local_profiling_kernel', 'parser_version', '4.0.0',
        'checksum_bound', true, 'parser_status', 'completed', 'retry_count', 0,
        'error_code', null, 'error_message_safe', null,
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
