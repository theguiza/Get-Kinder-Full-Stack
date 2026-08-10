DROP TABLE IF EXISTS gate_c1_smoke_results;
CREATE TEMP TABLE gate_c1_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

DO $$
DECLARE
  seeded_file uuid := '20000000-0000-4000-8000-0000000000c1';
  before_generation numeric(20,0);
  after_generation numeric(20,0);
  rejected boolean;
BEGIN
  SELECT gcs_generation INTO before_generation FROM kai.intake_files WHERE intake_file_id = seeded_file;
  INSERT INTO gate_c1_smoke_results VALUES (
    'generation_absent_before_binding',
    CASE WHEN before_generation IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'gcs_generation is NULL before the lifecycle point at which binding is valid'
  );

  UPDATE kai.intake_files SET gcs_generation = 1700000000000001 WHERE intake_file_id = seeded_file;
  SELECT gcs_generation INTO after_generation FROM kai.intake_files WHERE intake_file_id = seeded_file;
  INSERT INTO gate_c1_smoke_results VALUES (
    'valid_generation_persists_exactly_once',
    CASE WHEN after_generation = 1700000000000001 THEN 'PASS' ELSE 'FAIL' END,
    'a valid generation persists exactly as bound, with no precision loss'
  );

  rejected := false;
  BEGIN
    UPDATE kai.intake_files SET gcs_generation = 1700000000000002 WHERE intake_file_id = seeded_file;
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO gate_c1_smoke_results VALUES (
    'generation_immutable_once_bound',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a bound gcs_generation cannot be changed to a different value'
  );

  rejected := false;
  BEGIN
    INSERT INTO kai.intake_files (
      intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
      checksum, hash_algorithm, upload_state, object_version_id, gcs_generation
    ) VALUES (
      gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
      'gate-c1-malformed.pdf', 'gate-c1-malformed.pdf', repeat('d', 64), 'sha256',
      'uploaded_unconfirmed', 'ov_' || repeat('d2', 16), -5
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO gate_c1_smoke_results VALUES (
    'malformed_generation_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a non-positive gcs_generation is rejected at the database boundary'
  );

  rejected := false;
  BEGIN
    INSERT INTO kai.intake_files (
      intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
      checksum, hash_algorithm, upload_state, object_version_id, gcs_generation
    ) VALUES (
      gen_random_uuid(), '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
      'gate-c1-premature.pdf', 'gate-c1-premature.pdf', repeat('e', 64), 'sha256',
      'reserved', NULL, 1700000000000003
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO gate_c1_smoke_results VALUES (
    'generation_requires_object_version_id_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a gcs_generation cannot be bound before object_version_id (Gate A) exists'
  );
END $$;

-- Existing Gate A lifecycle semantics are unchanged: the seeded row can still
-- transition uploaded_unconfirmed -> confirmed exactly as before this
-- migration, with object_version_id/checksum staying immutable.
DO $$
DECLARE
  seeded_file uuid := '20000000-0000-4000-8000-0000000000c1';
  new_state text;
BEGIN
  UPDATE kai.intake_files
     SET upload_state = 'confirmed',
         verified_checksum = repeat('c', 64),
         verified_size_bytes = 12345,
         verified_at = '2026-08-08T13:00:00Z'
   WHERE intake_file_id = seeded_file;
  SELECT upload_state INTO new_state FROM kai.intake_files WHERE intake_file_id = seeded_file;
  INSERT INTO gate_c1_smoke_results VALUES (
    'gate_a_lifecycle_transition_unchanged',
    CASE WHEN new_state = 'confirmed' THEN 'PASS' ELSE 'FAIL' END,
    'uploaded_unconfirmed -> confirmed remains a valid Gate A transition after this migration'
  );
END $$;

SELECT * FROM gate_c1_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gate_c1_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Gate C-1 gcs-generation-binding smoke verifier failed';
  END IF;
END $$;
