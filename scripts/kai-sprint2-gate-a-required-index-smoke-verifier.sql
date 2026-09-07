BEGIN;

CREATE TEMP TABLE gate_a_required_index_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  duplicate_rejected boolean := false;
BEGIN
  INSERT INTO gate_a_required_index_smoke_results
  SELECT 'valid_seed_rows_preserved',
         CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END,
         'valid synthetic rows survived required-index repair without cleanup'
    FROM kai.intake_files
   WHERE intake_file_id IN (
     '20000000-0000-4000-8000-000000000101',
     '20000000-0000-4000-8000-000000000102',
     '20000000-0000-4000-8000-000000000103'
   );

  BEGIN
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
    ) VALUES (
      '20000000-0000-4000-8000-000000000104',
      '10000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000101',
      'gate-a-required-index-duplicate.pdf',
      'gate-a-required-index-duplicate.pdf',
      repeat('1', 64),
      'sha256',
      false,
      'confirmed',
      '2026-08-20T12:04:00Z',
      '2026-08-21T12:04:00Z',
      'provider-object:required-index-duplicate#1',
      repeat('1', 64),
      104,
      '2026-08-20T12:05:00Z',
      '2026-08-20T12:04:00Z'
    );
  EXCEPTION WHEN unique_violation THEN
    duplicate_rejected := true;
  END;

  INSERT INTO gate_a_required_index_smoke_results VALUES (
    'declared_checksum_duplicate_rejected',
    CASE WHEN duplicate_rejected THEN 'PASS' ELSE 'FAIL' END,
    'restored unique index rejects same-tenant non-forced declared checksum duplicates'
  );
END $$;

SELECT 'GATE_A_REQUIRED_INDEX_SMOKE' AS result_type, check_name, status, detail
FROM gate_a_required_index_smoke_results
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gate_a_required_index_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Gate A required-index smoke verifier failed';
  END IF;
END $$;

ROLLBACK;
