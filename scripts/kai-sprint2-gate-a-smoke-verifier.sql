BEGIN;

CREATE TEMP TABLE gate_a_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  batch1 uuid := '10000000-0000-4000-8000-000000000001';
  file1 uuid := '20000000-0000-4000-8000-000000000001';
  ov1 text := 'provider-object:gate-a-one#version-1';
  checksum1 text := repeat('1', 64);
  mismatch_checksum text := repeat('9', 64);
  count_after integer;
  audit_before integer;
  audit_after integer;
BEGIN
  UPDATE kai.intake_files
     SET upload_state = 'upload_started',
         upload_state_changed_at = '2026-08-02T12:01:00Z'
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND upload_state = 'reserved';
  INSERT INTO gate_a_results VALUES ('tenant_scoped_reserved_to_started', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'organization predicate and expected-state CAS');

  UPDATE kai.intake_files
     SET upload_state = 'uploaded_unconfirmed',
         object_version_id = ov1,
         upload_state_changed_at = '2026-08-02T12:02:00Z'
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND upload_state = 'upload_started';
  INSERT INTO gate_a_results VALUES ('immutable_object_version_recorded', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'object version persisted before checksum confirmation');

  UPDATE kai.intake_files
     SET upload_state = 'confirmed',
         verified_checksum = checksum1,
         verified_size_bytes = 42,
         verified_at = '2026-08-02T12:03:00Z',
         upload_state_changed_at = '2026-08-02T12:03:00Z'
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND upload_state = 'uploaded_unconfirmed'
     AND object_version_id = ov1
     AND checksum = checksum1;
  INSERT INTO gate_a_results VALUES ('declared_and_verified_checksum_confirmed', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'independent checksum matched declared checksum');

  UPDATE kai.intake_files
     SET upload_state = 'confirmed',
         verified_checksum = checksum1,
         verified_size_bytes = 42,
         verified_at = '2026-08-02T12:03:00Z',
         upload_state_changed_at = '2026-08-02T12:03:00Z'
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND upload_state = 'confirmed'
     AND object_version_id = ov1
     AND verified_checksum = checksum1
     AND verified_size_bytes = 42;
  INSERT INTO gate_a_results VALUES ('same_fact_replay', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'identical confirmed facts replay without conflict');

  BEGIN
    UPDATE kai.intake_files
       SET object_version_id = 'provider-object:gate-a-one#version-2'
     WHERE organization_id = org1
       AND intake_file_id = file1;
    INSERT INTO gate_a_results VALUES ('changed_fact_conflict', 'FAIL', 'changed object version unexpectedly succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO gate_a_results VALUES ('changed_fact_conflict', 'PASS', 'safe immutable-object-version failure');
  END;

  UPDATE kai.intake_files
     SET upload_state = 'confirmed',
         verified_checksum = mismatch_checksum,
         verified_size_bytes = 42,
         verified_at = '2026-08-02T12:04:00Z',
         upload_state_changed_at = '2026-08-02T12:04:00Z'
   WHERE organization_id = org2
     AND intake_file_id = '20000000-0000-4000-8000-000000000002'
     AND upload_state = 'uploaded_unconfirmed'
     AND object_version_id = ov1
     AND checksum = mismatch_checksum;
  INSERT INTO gate_a_results VALUES ('checksum_mismatch_zero_transition', CASE WHEN NOT FOUND THEN 'PASS' ELSE 'FAIL' END, 'mismatched checksum affected zero rows');

  BEGIN
    UPDATE kai.intake_files
       SET upload_state = 'confirmed',
           upload_state_changed_at = '2026-08-02T12:05:00Z'
     WHERE organization_id = org2
       AND intake_file_id = '20000000-0000-4000-8000-000000000002';
    INSERT INTO gate_a_results VALUES ('denied_transition_rejected', 'FAIL', 'reserved to confirmed unexpectedly succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO gate_a_results VALUES ('denied_transition_rejected', 'PASS', 'safe denied-transition failure');
  END;

  INSERT INTO kai.intake_files (
    intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
    checksum, hash_algorithm, upload_state, upload_state_changed_at, upload_expires_at
  ) VALUES (
    '20000000-0000-4000-8000-000000000003', batch1, org1, 'expired.pdf', 'expired.pdf',
    repeat('3', 64), 'sha256', 'reserved', '2026-08-01T12:00:00Z', '2026-08-02T12:00:00Z'
  );

  UPDATE kai.intake_files
     SET upload_state = 'expired',
         upload_state_changed_at = '2026-08-02T12:00:00Z'
   WHERE organization_id = org1
     AND intake_file_id = '20000000-0000-4000-8000-000000000003'
     AND upload_state = 'reserved';
  INSERT INTO gate_a_results VALUES ('expiry_transition_allowed_at_expiry', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'expired transition at upload_expires_at');

  SELECT count(*) INTO audit_before FROM kai.upload_lifecycle_audit;
  BEGIN
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
    ) VALUES (
      org1, file1, 'confirm_upload', 'uploaded_unconfirmed', 'confirmed', 'success',
      '{"metadata_only":true,"checksum_verification_outcome":"matched"}'::jsonb,
      '2026-08-02T12:03:00Z'
    );
    UPDATE kai.intake_files
       SET file_policy_status = 'blocked',
           upload_state = 'policy_blocked',
           upload_state_changed_at = '2026-08-02T12:06:00Z'
     WHERE organization_id = org1
       AND intake_file_id = file1
       AND upload_state = 'confirmed';
    RAISE EXCEPTION 'force rollback after lifecycle and audit';
  EXCEPTION WHEN others THEN
    NULL;
  END;
  SELECT count(*) INTO audit_after FROM kai.upload_lifecycle_audit;
  INSERT INTO gate_a_results VALUES ('transaction_and_audit_atomicity', CASE WHEN audit_after = audit_before THEN 'PASS' ELSE 'FAIL' END, 'forced rollback removed lifecycle and audit side effects');

  BEGIN
    FOR count_after IN 1..26 LOOP
      INSERT INTO kai.intake_files (
        intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
        checksum, hash_algorithm, upload_state, upload_state_changed_at, upload_expires_at
      ) VALUES (
        ('30000000-0000-4000-8000-' || lpad(count_after::text, 12, '0'))::uuid,
        '10000000-0000-4000-8000-000000000009',
        org1,
        'active-' || count_after || '.pdf',
        'active-' || count_after || '.pdf',
        lpad(count_after::text, 64, '0'),
        'sha256',
        'reserved',
        '2026-08-02T13:00:00Z',
        '2026-08-03T13:00:00Z'
      );
    END LOOP;
    INSERT INTO gate_a_results VALUES ('required_concurrent_active_limit', 'FAIL', '26th active upload unexpectedly succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO gate_a_results VALUES ('required_concurrent_active_limit', 'PASS', 'safe active-limit failure');
  END;
END $$;

SELECT 'GATE_A_SMOKE' AS result_type, check_name, status, detail
FROM gate_a_results
ORDER BY check_name;

ROLLBACK;
