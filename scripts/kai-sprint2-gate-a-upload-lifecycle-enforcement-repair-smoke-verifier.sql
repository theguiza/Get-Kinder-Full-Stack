BEGIN;

CREATE TEMP TABLE gate_a_enforcement_repair_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  defaulted_state text;
  rejected boolean := false;
BEGIN
  INSERT INTO kai.intake_files (
    intake_file_id,
    intake_batch_id,
    organization_id,
    original_filename,
    safe_filename,
    checksum,
    hash_algorithm,
    created_at
  ) VALUES (
    '20000000-0000-4000-8000-0000000000a1',
    '10000000-0000-4000-8000-0000000000a1',
    '00000000-0000-4000-8000-0000000000a1',
    'gate-a-repair-default.pdf',
    'gate-a-repair-default.pdf',
    repeat('a', 64),
    'sha256',
    '2026-08-10T12:00:00Z'
  );

  SELECT upload_state
    INTO defaulted_state
    FROM kai.intake_files
   WHERE intake_file_id = '20000000-0000-4000-8000-0000000000a1';

  INSERT INTO gate_a_enforcement_repair_smoke_results VALUES (
    'insert_trigger_defaulted_upload_state',
    CASE WHEN defaulted_state = 'reserved' THEN 'PASS' ELSE 'FAIL' END,
    'BEFORE INSERT trigger defaulted upload_state through the restored function'
  );

  UPDATE kai.intake_files
     SET upload_state = 'upload_started',
         upload_state_changed_at = '2026-08-10T12:01:00Z'
   WHERE intake_file_id = '20000000-0000-4000-8000-0000000000a1';

  INSERT INTO gate_a_enforcement_repair_smoke_results VALUES (
    'valid_update_transition_allowed',
    CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END,
    'BEFORE UPDATE trigger allowed the authoritative reserved -> upload_started edge'
  );

  BEGIN
    UPDATE kai.intake_files
       SET upload_state = 'confirmed',
           upload_state_changed_at = '2026-08-10T12:02:00Z'
     WHERE intake_file_id = '20000000-0000-4000-8000-0000000000a1';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;

  INSERT INTO gate_a_enforcement_repair_smoke_results VALUES (
    'invalid_update_transition_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'BEFORE UPDATE trigger rejected a denied lifecycle edge'
  );
END $$;

SELECT 'GATE_A_UPLOAD_LIFECYCLE_ENFORCEMENT_REPAIR_SMOKE' AS result_type, check_name, status, detail
FROM gate_a_enforcement_repair_smoke_results
ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gate_a_enforcement_repair_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Gate A upload-lifecycle enforcement repair smoke verifier failed';
  END IF;
END $$;

ROLLBACK;
