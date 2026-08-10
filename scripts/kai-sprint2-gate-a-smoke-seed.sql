BEGIN;

INSERT INTO kai.intake_files (
  intake_file_id,
  intake_batch_id,
  organization_id,
  original_filename,
  safe_filename,
  checksum,
  hash_algorithm,
  upload_state_changed_at,
  upload_expires_at,
  created_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'gate-a-one.pdf',
    'gate-a-one.pdf',
    repeat('1', 64),
    'sha256',
    '2026-08-02T12:00:00Z',
    '2026-08-03T12:00:00Z',
    '2026-08-02T12:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    'gate-a-two.pdf',
    'gate-a-two.pdf',
    repeat('2', 64),
    'sha256',
    '2026-08-02T12:00:00Z',
    '2026-08-03T12:00:00Z',
    '2026-08-02T12:00:00Z'
  );

COMMIT;
