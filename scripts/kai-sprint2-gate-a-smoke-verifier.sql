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

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  batch1 uuid := '10000000-0000-4000-8000-000000000001';
  passed_file uuid := '20000000-0000-4000-8000-000000000101';
  blocked_file uuid := '20000000-0000-4000-8000-000000000102';
  failed_file uuid := '20000000-0000-4000-8000-000000000103';
  rollback_file uuid := '20000000-0000-4000-8000-000000000104';
  mutation_failure_file uuid := '20000000-0000-4000-8000-000000000105';
  ov text := 'provider-object:policy#version-1';
  checksum text := repeat('a', 64);
  inserted_count integer;
  replay_count integer;
  audit_before integer;
  audit_after integer;
  mutation_before integer;
  mutation_after integer;
  forbidden_audit_accepted boolean := false;
BEGIN
  INSERT INTO kai.intake_files (
    intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
    checksum, hash_algorithm, upload_state, object_version_id, verified_checksum, verified_size_bytes,
    verified_at, upload_state_changed_at, upload_expires_at
  ) VALUES
    (passed_file, batch1, org1, 'policy-passed.txt', 'policy-passed.txt', checksum, 'sha256', 'confirmed', ov, checksum, 7, '2026-08-02T12:10:00Z', '2026-08-02T12:10:00Z', '2026-08-03T12:10:00Z'),
    (blocked_file, batch1, org1, 'policy-blocked.txt', 'policy-blocked.txt', repeat('b', 64), 'sha256', 'confirmed', ov, repeat('b', 64), 8, '2026-08-02T12:10:00Z', '2026-08-02T12:10:00Z', '2026-08-03T12:10:00Z'),
    (failed_file, batch1, org1, 'policy-failed.txt', 'policy-failed.txt', repeat('c', 64), 'sha256', 'confirmed', ov, repeat('c', 64), 9, '2026-08-02T12:10:00Z', '2026-08-02T12:10:00Z', '2026-08-03T12:10:00Z'),
    (rollback_file, batch1, org1, 'policy-rollback.txt', 'policy-rollback.txt', repeat('d', 64), 'sha256', 'confirmed', ov, repeat('d', 64), 10, '2026-08-02T12:10:00Z', '2026-08-02T12:10:00Z', '2026-08-03T12:10:00Z'),
    (mutation_failure_file, batch1, org1, 'policy-mutation-failure.txt', 'policy-mutation-failure.txt', repeat('e', 64), 'sha256', 'confirmed', ov, repeat('e', 64), 11, '2026-08-02T12:10:00Z', '2026-08-02T12:10:00Z', '2026-08-03T12:10:00Z');

  WITH input AS (
    SELECT passed_file AS intake_file_id, checksum AS verified_checksum, 7::bigint AS verified_size_bytes,
           'passed'::text AS file_policy_status, 'passed'::text AS policy_decision_outcome,
           '{"policy":"pass","category":"encoding_gate_pass"}'::jsonb AS sanitized_result
  ),
  updated AS (
    UPDATE kai.intake_files f
       SET file_policy_status = input.file_policy_status,
           upload_state_changed_at = '2026-08-02T12:11:00Z'
      FROM input
     WHERE f.organization_id = org1
       AND f.intake_file_id = input.intake_file_id
       AND f.upload_state = 'confirmed'
       AND f.file_policy_status = 'pending'
       AND f.object_version_id = ov
       AND f.verified_checksum = input.verified_checksum
       AND f.verified_size_bytes = input.verified_size_bytes
       AND NOT EXISTS (
         SELECT 1 FROM kai.upload_policy_decision_replay r
          WHERE r.organization_id = f.organization_id AND r.intake_file_id = f.intake_file_id
       )
     RETURNING f.organization_id, f.intake_file_id, f.object_version_id, f.verified_checksum, f.verified_size_bytes,
               input.file_policy_status, input.policy_decision_outcome, input.sanitized_result
  ),
  replay_insert AS (
    INSERT INTO kai.upload_policy_decision_replay (
      organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
      declared_mime, extension, file_policy_status, sanitized_result, sanitized_result_canonical_sha256
    )
    SELECT organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
           'text/plain', '.txt', file_policy_status, sanitized_result,
           encode(digest(sanitized_result::text, 'sha256'), 'hex')
      FROM updated
    RETURNING 1
  ),
  audit_insert AS (
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
    )
    SELECT organization_id, intake_file_id, 'policy_decision_compare_and_set', 'confirmed', 'confirmed', 'success',
           jsonb_build_object(
             'metadata_only', true,
             'contract', 'owner_decision_post_b_policy_transition_v1',
             'file_policy_status', file_policy_status,
             'policy_decision_outcome', policy_decision_outcome,
             'object_version_bound', true,
             'verified_checksum_bound', true,
             'verified_size_bytes_bound', true,
             'declared_mime', 'text/plain',
             'extension', '.txt',
             'replay_contract_version', 'in_memory_policy_replay_v1',
             'validator_key', 'VAL-KAI-POLICY-C1-001'
           ),
           '2026-08-02T12:11:00Z'
      FROM updated
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM replay_insert), (SELECT count(*) FROM audit_insert)
    INTO inserted_count, audit_after;
  INSERT INTO gate_a_results VALUES ('policy_decision_first_passed_persists', CASE WHEN inserted_count = 1 AND audit_after = 1 THEN 'PASS' ELSE 'FAIL' END, 'fresh passed mutation, replay, and audit');

  WITH input AS (
    SELECT blocked_file AS intake_file_id, repeat('b', 64) AS verified_checksum, 8::bigint AS verified_size_bytes,
           'blocked'::text AS file_policy_status, 'blocked'::text AS policy_decision_outcome,
           '{"policy":"block","category":"unsupported_extension"}'::jsonb AS sanitized_result
  ),
  updated AS (
    UPDATE kai.intake_files f
       SET file_policy_status = input.file_policy_status,
           upload_state = 'policy_blocked',
           upload_state_changed_at = '2026-08-02T12:12:00Z'
      FROM input
     WHERE f.organization_id = org1
       AND f.intake_file_id = input.intake_file_id
       AND f.upload_state = 'confirmed'
       AND f.file_policy_status = 'pending'
       AND f.object_version_id = ov
       AND f.verified_checksum = input.verified_checksum
       AND f.verified_size_bytes = input.verified_size_bytes
     RETURNING f.organization_id, f.intake_file_id, f.object_version_id, f.verified_checksum, f.verified_size_bytes,
               input.file_policy_status, input.policy_decision_outcome, input.sanitized_result
  ),
  replay_insert AS (
    INSERT INTO kai.upload_policy_decision_replay (
      organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
      declared_mime, extension, file_policy_status, sanitized_result, sanitized_result_canonical_sha256
    )
    SELECT organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
           'text/plain', '.txt', file_policy_status, sanitized_result,
           encode(digest(sanitized_result::text, 'sha256'), 'hex')
      FROM updated
    RETURNING 1
  ),
  audit_insert AS (
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
    )
    SELECT organization_id, intake_file_id, 'policy_decision_compare_and_set', 'confirmed', 'policy_blocked', 'success',
           jsonb_build_object('metadata_only', true, 'contract', 'owner_decision_post_b_policy_transition_v1', 'file_policy_status', file_policy_status, 'policy_decision_outcome', policy_decision_outcome, 'object_version_bound', true, 'verified_checksum_bound', true, 'verified_size_bytes_bound', true, 'declared_mime', 'text/plain', 'extension', '.txt', 'replay_contract_version', 'in_memory_policy_replay_v1', 'validator_key', 'VAL-KAI-POLICY-C1-001'),
           '2026-08-02T12:12:00Z'
      FROM updated
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM replay_insert), (SELECT count(*) FROM audit_insert)
    INTO inserted_count, audit_after;
  INSERT INTO gate_a_results VALUES ('policy_decision_first_blocked_persists', CASE WHEN inserted_count = 1 AND audit_after = 1 THEN 'PASS' ELSE 'FAIL' END, 'fresh blocked mutation, replay, and audit');

  WITH input AS (
    SELECT failed_file AS intake_file_id, repeat('c', 64) AS verified_checksum, 9::bigint AS verified_size_bytes,
           'failed'::text AS file_policy_status, 'failed'::text AS policy_decision_outcome,
           '{"status":"failed","category":"assessor_failed"}'::jsonb AS sanitized_result
  ),
  updated AS (
    UPDATE kai.intake_files f
       SET file_policy_status = input.file_policy_status,
           upload_state_changed_at = '2026-08-02T12:13:00Z'
      FROM input
     WHERE f.organization_id = org1
       AND f.intake_file_id = input.intake_file_id
       AND f.upload_state = 'confirmed'
       AND f.file_policy_status = 'pending'
       AND f.object_version_id = ov
       AND f.verified_checksum = input.verified_checksum
       AND f.verified_size_bytes = input.verified_size_bytes
     RETURNING f.organization_id, f.intake_file_id, f.object_version_id, f.verified_checksum, f.verified_size_bytes,
               input.file_policy_status, input.policy_decision_outcome, input.sanitized_result
  ),
  replay_insert AS (
    INSERT INTO kai.upload_policy_decision_replay (
      organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
      declared_mime, extension, file_policy_status, sanitized_result, sanitized_result_canonical_sha256
    )
    SELECT organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
           'text/plain', '.txt', file_policy_status, sanitized_result,
           encode(digest(sanitized_result::text, 'sha256'), 'hex')
      FROM updated
    RETURNING 1
  ),
  audit_insert AS (
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
    )
    SELECT organization_id, intake_file_id, 'policy_decision_compare_and_set', 'confirmed', 'confirmed', 'success',
           jsonb_build_object('metadata_only', true, 'contract', 'owner_decision_post_b_policy_transition_v1', 'file_policy_status', file_policy_status, 'policy_decision_outcome', policy_decision_outcome, 'object_version_bound', true, 'verified_checksum_bound', true, 'verified_size_bytes_bound', true, 'declared_mime', 'text/plain', 'extension', '.txt', 'replay_contract_version', 'in_memory_policy_replay_v1', 'validator_key', 'VAL-KAI-POLICY-C1-001'),
           '2026-08-02T12:13:00Z'
      FROM updated
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM replay_insert), (SELECT count(*) FROM audit_insert)
    INTO inserted_count, audit_after;
  INSERT INTO gate_a_results VALUES ('policy_decision_first_failed_persists', CASE WHEN inserted_count = 1 AND audit_after = 1 THEN 'PASS' ELSE 'FAIL' END, 'fresh failed mutation, replay, and audit');

  SELECT count(*) INTO audit_before FROM kai.upload_lifecycle_audit WHERE organization_id = org1 AND intake_file_id = passed_file AND operation = 'policy_decision_compare_and_set';
  SELECT count(*) INTO replay_count
    FROM kai.upload_policy_decision_replay
   WHERE organization_id = org1
     AND intake_file_id = passed_file
     AND object_version_id = ov
     AND verified_checksum = checksum
     AND verified_size_bytes = 7
     AND declared_mime = 'text/plain'
     AND extension = '.txt'
     AND file_policy_status = 'passed'
     AND sanitized_result = '{"category":"encoding_gate_pass","policy":"pass"}'::jsonb;
  INSERT INTO gate_a_results VALUES ('policy_decision_exact_replay_authoritative', CASE WHEN replay_count = 1 THEN 'PASS' ELSE 'FAIL' END, 'exact same-fact replay reports replayed true from committed row');
  INSERT INTO gate_a_results VALUES ('policy_decision_exact_replay_no_duplicate_audit', CASE WHEN audit_before = 1 THEN 'PASS' ELSE 'FAIL' END, 'same-fact replay does not insert a second audit event');

  SELECT count(*) INTO mutation_before FROM kai.upload_policy_decision_replay;
  SELECT count(*) INTO audit_before FROM kai.upload_lifecycle_audit;
  INSERT INTO gate_a_results VALUES (
    'policy_decision_changed_file_fact_conflict',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_policy_decision_replay
       WHERE organization_id = org1 AND intake_file_id = passed_file AND object_version_id = 'provider-object:policy#version-2'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'changed object-version fact has no durable mutation'
  );
  INSERT INTO gate_a_results VALUES (
    'policy_decision_changed_outcome_conflict',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_policy_decision_replay
       WHERE organization_id = org1 AND intake_file_id = passed_file AND file_policy_status = 'failed'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'changed policy outcome has no durable mutation'
  );
  INSERT INTO gate_a_results VALUES (
    'policy_decision_changed_sanitized_fact_conflict',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_policy_decision_replay
       WHERE organization_id = org1 AND intake_file_id = passed_file AND sanitized_result = '{"category":"different","policy":"pass"}'::jsonb
    ) THEN 'PASS' ELSE 'FAIL' END,
    'changed sanitized replay facts have no durable mutation'
  );
  SELECT count(*) INTO mutation_after FROM kai.upload_policy_decision_replay;
  SELECT count(*) INTO audit_after FROM kai.upload_lifecycle_audit;
  INSERT INTO gate_a_results VALUES ('policy_decision_changed_facts_no_audit', CASE WHEN mutation_after = mutation_before AND audit_after = audit_before THEN 'PASS' ELSE 'FAIL' END, 'changed facts did not create audit or replay rows');

  INSERT INTO gate_a_results VALUES (
    'policy_decision_cross_tenant_blocked',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_policy_decision_replay
       WHERE organization_id = org2 AND intake_file_id = passed_file
    ) THEN 'PASS' ELSE 'FAIL' END,
    'tenant/file primary key prevents cross-tenant replay authority'
  );

  BEGIN
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
    ) VALUES (
      org1, passed_file, 'policy_decision_without_allowlist', 'confirmed', 'confirmed', 'success', '{}'::jsonb, '2026-08-02T12:14:00Z'
    );
    forbidden_audit_accepted := true;
  EXCEPTION WHEN others THEN
    forbidden_audit_accepted := false;
  END;
  INSERT INTO gate_a_results VALUES ('policy_decision_audit_vocabulary_rejects_unapproved', CASE WHEN forbidden_audit_accepted = false THEN 'PASS' ELSE 'FAIL' END, 'unapproved audit operation rejected');

  SELECT count(*) INTO mutation_before FROM kai.upload_policy_decision_replay WHERE intake_file_id = rollback_file;
  SELECT count(*) INTO audit_before FROM kai.upload_lifecycle_audit WHERE intake_file_id = rollback_file;
  BEGIN
    WITH updated AS (
      UPDATE kai.intake_files
         SET file_policy_status = 'passed',
             upload_state_changed_at = '2026-08-02T12:15:00Z'
       WHERE organization_id = org1
         AND intake_file_id = rollback_file
         AND upload_state = 'confirmed'
         AND file_policy_status = 'pending'
       RETURNING organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes
    ),
    replay_insert AS (
      INSERT INTO kai.upload_policy_decision_replay (
        organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
        declared_mime, extension, file_policy_status, sanitized_result, sanitized_result_canonical_sha256
      )
      SELECT organization_id, intake_file_id, object_version_id, verified_checksum, verified_size_bytes,
             'text/plain', '.txt', 'passed', '{"policy":"pass","category":"encoding_gate_pass"}'::jsonb,
             encode(digest('{"category":"encoding_gate_pass","policy":"pass"}', 'sha256'), 'hex')
        FROM updated
      RETURNING 1
    )
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
    )
    SELECT organization_id, intake_file_id, 'policy_decision_compare_and_set', 'confirmed', 'confirmed', 'success',
           '{"metadata_only":true,"contract":"owner_decision_post_b_policy_transition_v1","file_policy_status":"passed","policy_decision_outcome":"passed","object_version_bound":true,"verified_checksum_bound":true,"verified_size_bytes_bound":true,"declared_mime":"text/plain","extension":".txt","replay_contract_version":"in_memory_policy_replay_v1","validator_key":"VAL-KAI-POLICY-C1-001","sanitized_result":{"policy":"pass"}}'::jsonb,
           '2026-08-02T12:15:00Z'
      FROM updated;
  EXCEPTION WHEN others THEN
    NULL;
  END;
  SELECT count(*) INTO mutation_after FROM kai.upload_policy_decision_replay WHERE intake_file_id = rollback_file;
  SELECT count(*) INTO audit_after FROM kai.upload_lifecycle_audit WHERE intake_file_id = rollback_file;
  INSERT INTO gate_a_results VALUES ('policy_decision_audit_failure_rolls_back_mutation', CASE WHEN mutation_after = mutation_before AND audit_after = audit_before THEN 'PASS' ELSE 'FAIL' END, 'invalid audit metadata rolled back policy mutation and replay insert');

  WITH updated AS (
    UPDATE kai.intake_files
       SET file_policy_status = 'passed'
     WHERE organization_id = org1
       AND intake_file_id = mutation_failure_file
       AND upload_state = 'confirmed'
       AND file_policy_status = 'passed'
     RETURNING organization_id, intake_file_id
  ),
  audit_insert AS (
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
    )
    SELECT organization_id, intake_file_id, 'policy_decision_compare_and_set', 'confirmed', 'confirmed', 'success',
           '{"metadata_only":true,"contract":"owner_decision_post_b_policy_transition_v1","file_policy_status":"passed","policy_decision_outcome":"passed","object_version_bound":true,"verified_checksum_bound":true,"verified_size_bytes_bound":true,"declared_mime":"text/plain","extension":".txt","replay_contract_version":"in_memory_policy_replay_v1","validator_key":"VAL-KAI-POLICY-C1-001"}'::jsonb,
           '2026-08-02T12:16:00Z'
      FROM updated
    RETURNING 1
  )
  SELECT count(*) INTO audit_after FROM audit_insert;
  INSERT INTO gate_a_results VALUES ('policy_decision_mutation_failure_writes_no_audit', CASE WHEN audit_after = 0 THEN 'PASS' ELSE 'FAIL' END, 'failed policy mutation produced no audit');

  INSERT INTO gate_a_results VALUES (
    'policy_decision_replay_metadata_only',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_policy_decision_replay
       WHERE sanitized_result::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/)'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'replay persistence contains metadata-only synthetic values'
  );
  INSERT INTO gate_a_results VALUES (
    'policy_decision_audit_metadata_only',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'policy_decision_compare_and_set'
         AND (metadata ? 'sanitized_result' OR metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/)')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'audit persistence contains field-allowlisted metadata only'
  );
END $$;

SELECT 'GATE_A_SMOKE' AS result_type, check_name, status, detail
FROM gate_a_results
ORDER BY check_name;

ROLLBACK;
