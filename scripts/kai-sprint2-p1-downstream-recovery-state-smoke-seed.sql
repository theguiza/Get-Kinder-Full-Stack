-- Synthetic smoke seed for kai.intake_p1_downstream_attempts. Runner-owned
-- disposable databases only. Two confirmed/passed synthetic files, each with
-- a completed P1-03 run and profile; file 1 also has its P1-04 bundle. One
-- recovery row per legal state.
BEGIN;

INSERT INTO kai.intake_files (
  intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
  checksum, hash_algorithm, force_new_version, processing_status, parse_status, file_policy_status,
  upload_state, object_version_id, verified_checksum, verified_size_bytes, verified_at,
  upload_state_changed_at, upload_expires_at, created_at
)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001',
   'smoke-1.csv', 'smoke-1.csv', repeat('1', 64), 'sha256', true, 'quarantined', 'quarantined', 'passed',
   'confirmed', 'ov_11111111111111111111111111111111', repeat('1', 64), 10, '2026-10-10T10:00:00Z',
   '2026-10-10T10:00:00Z', '2026-10-11T10:00:00Z', '2026-10-10T10:00:00Z'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001',
   'smoke-2.csv', 'smoke-2.csv', repeat('2', 64), 'sha256', true, 'quarantined', 'quarantined', 'passed',
   'confirmed', 'ov_22222222222222222222222222222222', repeat('2', 64), 10, '2026-10-10T10:00:00Z',
   '2026-10-10T10:00:00Z', '2026-10-11T10:00:00Z', '2026-10-10T10:00:00Z');

INSERT INTO kai.intake_parser_runs (
  parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum,
  parser_status, retry_count, started_at, created_at
)
VALUES
  ('a2000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   'kai_local_profiling_kernel', '1.0.0', repeat('1', 64), 'running', 0, '2026-10-10T10:00:01Z', '2026-10-10T10:00:01Z'),
  ('a2000000-0000-4000-8000-000000000002', 'a9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
   'kai_local_profiling_kernel', '1.0.0', repeat('2', 64), 'running', 0, '2026-10-10T10:00:01Z', '2026-10-10T10:00:01Z');

INSERT INTO kai.intake_file_profiles (
  file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum,
  profile, profile_canonical_sha256, created_at
)
SELECT ('a3000000-0000-4000-8000-00000000000' || n)::uuid, 'a9000000-0000-4000-8000-000000000001',
       ('a1000000-0000-4000-8000-00000000000' || n)::uuid, ('a2000000-0000-4000-8000-00000000000' || n)::uuid,
       'kai_local_profiling_kernel', '1.0.0', repeat(n::text, 64),
       '{"status":"profiled"}'::jsonb, encode(digest('{"status": "profiled"}', 'sha256'), 'hex'), '2026-10-10T10:00:02Z'
  FROM generate_series(1, 2) AS n;

UPDATE kai.intake_parser_runs
   SET parser_status = 'completed', completed_at = '2026-10-10T10:00:02Z',
       output_profile_id = ('a3000000-0000-4000-8000-00000000000' || right(parser_run_id::text, 1))::uuid
 WHERE organization_id = 'a9000000-0000-4000-8000-000000000001';

INSERT INTO kai.data_dictionaries (
  data_dictionary_id, organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at
)
SELECT 'a4000000-0000-4000-8000-000000000001', organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, '2026-10-10T10:00:03Z'
  FROM kai.intake_file_profiles WHERE file_profile_id = 'a3000000-0000-4000-8000-000000000001';

INSERT INTO kai.intake_p1_downstream_attempts (
  organization_id, intake_file_id, file_profile_id, parser_name, parser_version, checksum, stage,
  recovery_state, attempt_count, claim_token, claim_expires_at, last_attempt_at, next_eligible_at,
  last_error_code, created_at, updated_at
)
VALUES
  -- file 1: P1-04 succeeded, P1-05 waiting out its first cooldown
  ('a9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001',
   'kai_local_profiling_kernel', '1.0.0', repeat('1', 64), 'p1_04_data_dictionary',
   'succeeded', 1, NULL, NULL, '2026-10-10T10:00:03Z', NULL, NULL, '2026-10-10T10:00:03Z', '2026-10-10T10:00:03Z'),
  ('a9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001',
   'kai_local_profiling_kernel', '1.0.0', repeat('1', 64), 'p1_05_sensitivity_profile',
   'retry_scheduled', 1, NULL, NULL, '2026-10-10T10:00:04Z', '2026-10-10T10:01:05Z', 'system_error', '2026-10-10T10:00:04Z', '2026-10-10T10:00:05Z'),
  -- file 2: P1-04 claimed by a live worker
  ('a9000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002',
   'kai_local_profiling_kernel', '1.0.0', repeat('2', 64), 'p1_04_data_dictionary',
   'in_progress', 2, 'a5000000-0000-4000-8000-000000000001', '2026-10-10T10:02:04Z', '2026-10-10T10:00:04Z', NULL, 'system_error',
   '2026-10-10T10:00:04Z', '2026-10-10T10:00:04Z');

COMMIT;
