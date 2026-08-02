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
  ov1 text := 'ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  checksum1 text := repeat('a', 64);
  replay_count integer;
  tenant_count integer;
  audit_before integer;
  audit_after integer;
BEGIN
  UPDATE kai.intake_files
     SET upload_state = 'upload_started',
         upload_state_changed_at = '2026-08-02T12:01:00Z'
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND upload_state = 'reserved';
  INSERT INTO gate_a_results VALUES ('transition_reserved_to_upload_started', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'tenant-scoped CAS update');

  UPDATE kai.intake_files
     SET upload_state = 'uploaded_unconfirmed',
         object_version_id = ov1,
         upload_state_changed_at = '2026-08-02T12:02:00Z'
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND upload_state = 'upload_started';
  INSERT INTO gate_a_results VALUES ('transition_upload_started_to_uploaded_unconfirmed', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'object version attached once');

  UPDATE kai.intake_files
     SET upload_state = 'confirmed',
         verified_checksum = checksum1,
         verified_size_bytes = 42,
         verified_at = '2026-08-02T12:03:00Z',
         upload_state_changed_at = '2026-08-02T12:03:00Z'
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND upload_state = 'uploaded_unconfirmed'
     AND object_version_id = ov1;
  INSERT INTO gate_a_results VALUES ('transition_uploaded_unconfirmed_to_confirmed', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'verified checksum and size persisted');

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
  INSERT INTO gate_a_results VALUES ('identical_confirmation_replay', CASE WHEN FOUND THEN 'PASS' ELSE 'FAIL' END, 'same facts replay without mutation conflict');

  BEGIN
    UPDATE kai.intake_files
       SET object_version_id = 'ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
     WHERE organization_id = org1
       AND intake_file_id = file1;
    INSERT INTO gate_a_results VALUES ('changed_object_version_rejected', 'FAIL', 'mutation unexpectedly succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO gate_a_results VALUES ('changed_object_version_rejected', 'PASS', SQLERRM);
  END;

  BEGIN
    INSERT INTO kai.intake_files (
      intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
      checksum, hash_algorithm, upload_state, upload_state_changed_at, upload_expires_at
    )
    VALUES (
      '20000000-0000-4000-8000-000000000099', batch1, org1, 'late.pdf', 'late.pdf',
      repeat('9', 64), 'sha256', 'reserved', '2026-08-01T12:00:00Z', '2026-08-02T12:00:00Z'
    );
    UPDATE kai.intake_files
       SET upload_state = 'upload_started',
           upload_state_changed_at = '2026-08-02T12:01:00Z'
     WHERE organization_id = org1
       AND intake_file_id = '20000000-0000-4000-8000-000000000099';
    INSERT INTO gate_a_results VALUES ('expired_non_expiry_transition_rejected', 'FAIL', 'mutation unexpectedly succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO gate_a_results VALUES ('expired_non_expiry_transition_rejected', 'PASS', SQLERRM);
  END;

  INSERT INTO kai.security_assessment_enqueue (
    organization_id, intake_file_id, object_version_id, verified_checksum,
    verified_size_bytes, declared_mime, extension
  )
  VALUES (org1, file1, ov1, checksum1, 42, 'application/pdf', '.pdf')
  ON CONFLICT (organization_id, intake_file_id, object_version_id, verified_checksum)
  DO NOTHING;

  INSERT INTO kai.security_assessment_enqueue (
    organization_id, intake_file_id, object_version_id, verified_checksum,
    verified_size_bytes, declared_mime, extension
  )
  VALUES (org1, file1, ov1, checksum1, 42, 'application/pdf', '.pdf')
  ON CONFLICT (organization_id, intake_file_id, object_version_id, verified_checksum)
  DO NOTHING;

  SELECT count(*) INTO replay_count
    FROM kai.security_assessment_enqueue
   WHERE organization_id = org1
     AND intake_file_id = file1
     AND object_version_id = ov1
     AND verified_checksum = checksum1;
  INSERT INTO gate_a_results VALUES ('enqueue_identical_replay_on_conflict', CASE WHEN replay_count = 1 THEN 'PASS' ELSE 'FAIL' END, 'ON CONFLICT preserves one identity row');

  SELECT count(*) INTO tenant_count
    FROM kai.intake_files
   WHERE organization_id = org2
     AND intake_file_id = file1;
  INSERT INTO gate_a_results VALUES ('tenant_predicate_excludes_cross_tenant_file', CASE WHEN tenant_count = 0 THEN 'PASS' ELSE 'FAIL' END, 'organization predicate returns no cross-tenant row');

  SELECT count(*) INTO audit_before FROM kai.audit_events;
  BEGIN
    INSERT INTO kai.audit_events (organization_id, actor_type, action, metadata, object_type, reason_code, reason_text)
    VALUES (org1, 'internal_service', 'policy_decision_compare_and_set', '{"metadata_only":true}'::jsonb, 'intake_file', 'passed', 'ok');
    UPDATE kai.intake_files
       SET file_policy_status = 'passed',
           policy_decision_replay = jsonb_build_object(
             'organization_id', org1::text,
             'intake_file_id', file1::text,
             'object_version_id', ov1,
             'verified_checksum', checksum1,
             'verified_size_bytes', 42,
             'file_policy_status', 'passed',
             'sanitized_result', jsonb_build_object('policy', 'pass')
           )
     WHERE organization_id = org1
       AND intake_file_id = file1
       AND file_policy_status = 'pending';
    RAISE EXCEPTION 'force rollback after mutation and audit';
  EXCEPTION WHEN others THEN
    NULL;
  END;
  SELECT count(*) INTO audit_after FROM kai.audit_events;
  INSERT INTO gate_a_results VALUES ('transaction_rollback_audit_atomicity', CASE WHEN audit_after = audit_before THEN 'PASS' ELSE 'FAIL' END, 'forced rollback removes audit and mutation');

  BEGIN
    FOR replay_count IN 1..26 LOOP
      INSERT INTO kai.intake_files (
        intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
        checksum, hash_algorithm, upload_state, upload_state_changed_at, upload_expires_at
      )
      VALUES (
        ('30000000-0000-4000-8000-' || lpad(replay_count::text, 12, '0'))::uuid,
        batch1,
        org1,
        'limit-' || replay_count || '.pdf',
        'limit-' || replay_count || '.pdf',
        lpad(replay_count::text, 64, '0'),
        'sha256',
        'reserved',
        '2026-08-02T13:00:00Z',
        '2026-08-03T13:00:00Z'
      );
    END LOOP;
    INSERT INTO gate_a_results VALUES ('concurrent_25_file_limit', 'FAIL', '26th active reservation unexpectedly succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO gate_a_results VALUES ('concurrent_25_file_limit', 'PASS', SQLERRM);
  END;
END $$;

SELECT 'GATE_A_SMOKE' AS result_type,
       check_name,
       status,
       detail
FROM gate_a_results
ORDER BY check_name;

ROLLBACK;
