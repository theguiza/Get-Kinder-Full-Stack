BEGIN;

WITH constants AS (
  SELECT '00000000-0000-4000-8000-000000000001'::uuid AS org1,
         '20000000-0000-4000-8000-000000000001'::uuid AS file1,
         '40000000-0000-4000-8000-000000000001'::uuid AS parser_run1,
         repeat('1', 64) AS checksum1,
         '{"status":"profiled","format":"pdf","counts":{"page_count":1}}'::jsonb AS profile1
),
parser_run_insert AS (
  INSERT INTO kai.intake_parser_runs (
    parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum,
    run_state, started_at, completed_at
  )
  SELECT parser_run1, org1, file1, 'kai_local_profiling_kernel', '1.0.0', checksum1,
         'succeeded', '2026-08-02T13:00:00Z', '2026-08-02T13:00:05Z'
    FROM constants
  RETURNING organization_id, intake_file_id
),
parser_run_audit_insert AS (
  INSERT INTO kai.upload_lifecycle_audit (
    organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
  )
  SELECT org1, file1, 'parser_run_recorded', 'reserved', 'reserved', 'success',
         jsonb_build_object(
           'metadata_only', true,
           'contract', 'p1_parser_run_and_file_profile_v1',
           'parser_name', 'kai_local_profiling_kernel',
           'parser_version', '1.0.0',
           'checksum_bound', true,
           'run_state', 'succeeded',
           'failure_reason', null,
           'validator_key', 'VAL-KAI-P1-02-001'
         ),
         '2026-08-02T13:00:05Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM parser_run_insert)
  RETURNING 1
),
file_profile_insert AS (
  INSERT INTO kai.intake_file_profiles (
    file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum,
    profile, profile_canonical_sha256, created_at
  )
  SELECT '50000000-0000-4000-8000-000000000001'::uuid, org1, file1, parser_run1,
         'kai_local_profiling_kernel', '1.0.0', checksum1,
         profile1, encode(digest(profile1::text, 'sha256'), 'hex'),
         '2026-08-02T13:00:06Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM parser_run_audit_insert)
  RETURNING organization_id, intake_file_id
)
INSERT INTO kai.upload_lifecycle_audit (
  organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
)
SELECT org1, file1, 'file_profile_persisted', 'reserved', 'reserved', 'success',
       jsonb_build_object(
         'metadata_only', true,
         'contract', 'p1_parser_run_and_file_profile_v1',
         'parser_name', 'kai_local_profiling_kernel',
         'parser_version', '1.0.0',
         'checksum_bound', true,
         'profile_canonical_sha256', encode(digest(profile1::text, 'sha256'), 'hex'),
         'validator_key', 'VAL-KAI-P1-02-001'
       ),
       '2026-08-02T13:00:06Z'
  FROM constants
  WHERE EXISTS (SELECT 1 FROM file_profile_insert);

COMMIT;
