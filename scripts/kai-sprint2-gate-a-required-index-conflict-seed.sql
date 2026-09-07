BEGIN;

INSERT INTO kai.intake_files (
  intake_file_id,
  intake_batch_id,
  organization_id,
  original_filename,
  safe_filename,
  checksum,
  hash_algorithm,
  force_new_version,
  upload_state,
  upload_state_changed_at,
  upload_expires_at,
  object_version_id,
  verified_checksum,
  verified_size_bytes,
  verified_at,
  created_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000201',
    '10000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000201',
    'gate-a-required-index-conflict-a.pdf',
    'gate-a-required-index-conflict-a.pdf',
    repeat('2', 64),
    'sha256',
    false,
    'confirmed',
    '2026-08-20T13:00:00Z',
    '2026-08-21T13:00:00Z',
    'provider-object:required-index-conflict-a#1',
    repeat('2', 64),
    201,
    '2026-08-20T13:01:00Z',
    '2026-08-20T13:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000202',
    '10000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000201',
    'gate-a-required-index-conflict-b.pdf',
    'gate-a-required-index-conflict-b.pdf',
    repeat('2', 64),
    'sha256',
    false,
    'confirmed',
    '2026-08-20T13:02:00Z',
    '2026-08-21T13:02:00Z',
    'provider-object:required-index-conflict-b#1',
    repeat('2', 64),
    202,
    '2026-08-20T13:03:00Z',
    '2026-08-20T13:02:00Z'
  );

COMMIT;
