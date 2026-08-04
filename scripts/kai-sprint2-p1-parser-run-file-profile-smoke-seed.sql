BEGIN;

WITH constants AS (
  SELECT '00000000-0000-4000-8000-000000000001'::uuid AS org1,
         '20000000-0000-4000-8000-000000000001'::uuid AS file1,
         '40000000-0000-4000-8000-000000000001'::uuid AS parser_run1,
         '50000000-0000-4000-8000-000000000001'::uuid AS profile1_id,
         repeat('1', 64) AS checksum1,
         '{"status":"profiled","format":"pdf","counts":{"page_count":1}}'::jsonb AS profile1
),
parser_run_insert AS (
  INSERT INTO kai.intake_parser_runs (
    parser_run_id, organization_id, intake_file_id, parser_name, parser_version, checksum,
    parser_status, started_at
  )
  SELECT parser_run1, org1, file1, 'kai_local_profiling_kernel', '1.0.0', checksum1,
         'running', '2026-08-02T13:00:00Z'
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
           'parser_status', 'running',
           'retry_count', 0,
           'error_code', null,
           'error_message_safe', null,
           'validator_key', 'VAL-KAI-P1-02-001'
         ),
         '2026-08-02T13:00:00Z'
    FROM constants
    WHERE EXISTS (SELECT 1 FROM parser_run_insert)
  RETURNING 1
),
file_profile_insert AS (
  INSERT INTO kai.intake_file_profiles (
    file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version, checksum,
    profile, profile_canonical_sha256, created_at
  )
  SELECT profile1_id, org1, file1, parser_run1,
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

-- Separate statement: the row inserted above by parser_run_insert is not visible to an
-- UPDATE on the same table within that same statement (CTEs share the query's start-of-statement
-- snapshot), so the transition to 'completed' with output_profile_id must run as its own statement.
UPDATE kai.intake_parser_runs
   SET parser_status = 'completed',
       completed_at = '2026-08-02T13:00:07Z',
       output_profile_id = '50000000-0000-4000-8000-000000000001'
 WHERE parser_run_id = '40000000-0000-4000-8000-000000000001'
   AND EXISTS (
     SELECT 1 FROM kai.upload_lifecycle_audit
      WHERE organization_id = '00000000-0000-4000-8000-000000000001'
        AND intake_file_id = '20000000-0000-4000-8000-000000000001'
        AND operation = 'file_profile_persisted'
   );

COMMIT;
