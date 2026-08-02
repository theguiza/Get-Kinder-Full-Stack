INSERT INTO kai.organizations (organization_id, name)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'Gate A synthetic tenant one'),
  ('00000000-0000-4000-8000-000000000002', 'Gate A synthetic tenant two');

INSERT INTO kai.intake_batches (intake_batch_id, organization_id, batch_code)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'gate-a-batch-one'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 'gate-a-batch-two');

INSERT INTO kai.intake_files (
  intake_file_id,
  intake_batch_id,
  organization_id,
  original_filename,
  safe_filename,
  checksum,
  hash_algorithm,
  created_at
)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'gate-a.pdf',
  'gate-a.pdf',
  repeat('1', 64),
  'sha256',
  '2026-08-02T12:00:00Z'
);
