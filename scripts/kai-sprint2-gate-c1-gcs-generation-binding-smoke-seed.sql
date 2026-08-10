BEGIN;

-- Gate C-1 smoke seed: one org1 intake_files row already past Gate A's
-- object-version point (upload_state = uploaded_unconfirmed, object_version_id
-- already bound) so the Gate C-1 smoke verifier can exercise gcs_generation
-- binding, immutability, and rejection without re-deriving Gate A's own
-- transition mechanics.

INSERT INTO kai.intake_files (
  intake_file_id,
  intake_batch_id,
  organization_id,
  original_filename,
  safe_filename,
  checksum,
  hash_algorithm,
  upload_state,
  object_version_id,
  upload_state_changed_at,
  upload_expires_at,
  created_at
) VALUES (
  '20000000-0000-4000-8000-0000000000c1',
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'gate-c1-generation-binding.pdf',
  'gate-c1-generation-binding.pdf',
  repeat('c', 64),
  'sha256',
  'uploaded_unconfirmed',
  'ov_' || repeat('c1', 16),
  '2026-08-08T12:00:00Z',
  '2026-08-09T12:00:00Z',
  '2026-08-08T12:00:00Z'
);

COMMIT;
