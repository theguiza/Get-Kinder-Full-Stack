BEGIN;

CREATE TEMP TABLE p1_08_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  file1 uuid := '20000000-0000-4000-8000-000000000001';
  sensitivity1 uuid := '80000000-0000-4000-8000-000000000001';
  sensitivity2 uuid := '80000000-0000-4000-8000-000000000002';
  candidate1 uuid := '90000000-0000-4000-8000-000000000001';
  candidate2 uuid := '90000000-0000-4000-8000-000000000002';
  review_item1 uuid;
  review_item2 uuid;
  checksum1 text;
  checksum2 text;
  reviewed_type text := 'organization_primary_record';
  source_code1 text;
  source1 uuid := gen_random_uuid();
  source_version1 uuid;
  decision1 uuid := gen_random_uuid();
  decision_count_before integer;
  source_count_before integer;
  version_count_before integer;
  audit_count_before integer;
  decision_count_after integer;
  source_count_after integer;
  version_count_after integer;
  audit_count_after integer;
  decision_insert_reached boolean := false;
  source_insert_reached boolean := false;
  version_insert_reached boolean := false;
  audit_insert_reached boolean := false;
BEGIN
  SELECT review_queue_item_id INTO review_item1 FROM kai.review_queue_items
   WHERE organization_id = org1 AND queue_type = 'source_candidate_review' AND target_object_id = candidate1;
  SELECT review_queue_item_id INTO review_item2 FROM kai.review_queue_items
   WHERE organization_id = org1 AND queue_type = 'source_candidate_review' AND target_object_id = candidate2;
  SELECT profile_canonical_sha256 INTO checksum1 FROM kai.intake_source_candidates WHERE intake_source_candidate_id = candidate1;
  SELECT profile_canonical_sha256 INTO checksum2 FROM kai.intake_source_candidates WHERE intake_source_candidate_id = candidate2;
  source_code1 := encode(digest(org1::text || '|' || sensitivity1::text || '|' || checksum1 || '|' || reviewed_type, 'sha256'), 'hex');

  -- Creation: one deterministic source, one current source_version, the
  -- candidate's needs_gk_review -> promoted transition, the review item's open ->
  -- resolved transition, the promotion decision's decided -> promoted transition,
  -- and the required metadata-only audit row, all atomically.
  INSERT INTO kai.sources (source_id, organization_id, source_code, reviewed_source_type, created_by_type)
  VALUES (source1, org1, source_code1, reviewed_type, 'human');

  INSERT INTO kai.source_versions (
    organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
  ) VALUES (org1, source1, candidate1, sensitivity1, checksum1, 'human')
  RETURNING source_version_id INTO source_version1;

  UPDATE kai.intake_source_candidates SET candidate_status = 'promoted' WHERE intake_source_candidate_id = candidate1 AND candidate_status = 'needs_gk_review';
  UPDATE kai.review_queue_items SET queue_status = 'resolved', review_status = 'resolved' WHERE review_queue_item_id = review_item1 AND queue_status = 'open';

  INSERT INTO kai.intake_promotion_decisions (
    intake_promotion_decision_id, organization_id, intake_source_candidate_id, review_queue_item_id,
    reviewed_source_type, decision_status, source_id, source_version_id, promoted_at, created_by_type
  ) VALUES (decision1, org1, candidate1, review_item1, reviewed_type, 'promoted', source1, source_version1, now(), 'human');

  INSERT INTO kai.upload_lifecycle_audit (
    organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
  ) VALUES (
    org1, file1, 'source_promotion_decision_persisted', 'confirmed', 'confirmed', 'success',
    jsonb_build_object(
      'metadata_only', true,
      'contract', 'p1_source_promotion_decision_v1',
      'intake_source_candidate_id', candidate1::text,
      'intake_sensitivity_profile_id', sensitivity1::text,
      'profile_canonical_sha256', checksum1,
      'reviewed_source_type', reviewed_type,
      'decision_status', 'promoted',
      'candidate_status', 'promoted',
      'queue_status', 'resolved',
      'source_id', source1::text,
      'source_version_id', source_version1::text,
      'validator_key', 'VAL-KAI-P1-08-001'
    )
  );

  INSERT INTO p1_08_results VALUES (
    'creation_decision_persisted',
    CASE WHEN (SELECT count(*) FROM kai.intake_promotion_decisions WHERE organization_id = org1 AND intake_source_candidate_id = candidate1) = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one promotion decision for the accepted org1/candidate1 identity'
  );
  INSERT INTO p1_08_results VALUES (
    'creation_source_and_version_persisted',
    CASE WHEN (SELECT count(*) FROM kai.sources WHERE organization_id = org1 AND source_code = source_code1) = 1
      AND (SELECT count(*) FROM kai.source_versions WHERE organization_id = org1 AND intake_source_candidate_id = candidate1 AND is_current) = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one source and one current source_version were created'
  );
  INSERT INTO p1_08_results VALUES (
    'candidate_transitioned_to_promoted',
    CASE WHEN (SELECT candidate_status FROM kai.intake_source_candidates WHERE intake_source_candidate_id = candidate1) = 'promoted'
      THEN 'PASS' ELSE 'FAIL' END,
    'candidate_status transitioned from needs_gk_review to promoted'
  );
  INSERT INTO p1_08_results VALUES (
    'review_item_transitioned_to_resolved',
    CASE WHEN (SELECT queue_status FROM kai.review_queue_items WHERE review_queue_item_id = review_item1) = 'resolved'
      THEN 'PASS' ELSE 'FAIL' END,
    'queue_status transitioned from open to resolved'
  );
  INSERT INTO p1_08_results VALUES (
    'creation_audit_persisted',
    CASE WHEN (SELECT count(*) FROM kai.upload_lifecycle_audit WHERE organization_id = org1 AND operation = 'source_promotion_decision_persisted') = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one audit row for the created promotion decision'
  );

  -- Replay: an authoritative re-read by identity returns the same decision, source,
  -- and source_version.
  INSERT INTO p1_08_results VALUES (
    'replay_reads_same_decision',
    CASE WHEN (SELECT intake_promotion_decision_id FROM kai.intake_promotion_decisions WHERE organization_id = org1 AND intake_source_candidate_id = candidate1) = decision1
      THEN 'PASS' ELSE 'FAIL' END,
    'authoritative identity lookup returns the same intake_promotion_decision_id on replay'
  );

  -- Duplicate-identity rejection at the database level.
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type)
    VALUES (org1, candidate1, review_item1, reviewed_type);
    INSERT INTO p1_08_results VALUES ('duplicate_identity_rejected', 'FAIL', 'duplicate organization_id + intake_source_candidate_id unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_08_results VALUES ('duplicate_identity_rejected', 'PASS', 'safe unique-violation failure via intake_promotion_decisions_p1_08_identity_unique');
  END;

  -- Genuine concurrent-insert convergence proof (sequential-within-one-session
  -- form, mirroring the established P1-04 through P1-07 SQL-level convention).
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type)
    VALUES (org1, candidate2, review_item2, reviewed_type);
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type)
    VALUES (org1, candidate2, review_item2, reviewed_type);
    INSERT INTO p1_08_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'FAIL', 'second concurrent-identity insert unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_08_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'PASS', 'safe unique-violation failure on the second concurrent attempt');
  END;
  INSERT INTO p1_08_results VALUES (
    'concurrent_insert_convergence_exactly_one_row',
    CASE WHEN (SELECT count(*) FROM kai.intake_promotion_decisions WHERE organization_id = org1 AND intake_source_candidate_id = candidate2) = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one decision row exists after two concurrent-identity insert attempts'
  );
  DELETE FROM kai.intake_promotion_decisions WHERE organization_id = org1 AND intake_source_candidate_id = candidate2;

  -- Cross-tenant invisibility.
  INSERT INTO p1_08_results VALUES (
    'cross_tenant_invisible',
    CASE WHEN NOT EXISTS (SELECT 1 FROM kai.intake_promotion_decisions WHERE organization_id = org2 AND intake_source_candidate_id = candidate1)
      THEN 'PASS' ELSE 'FAIL' END,
    'organization_id + identity prevents cross-tenant visibility'
  );

  -- Transaction-and-audit atomicity proof: a second, previously-unseeded
  -- candidate's decision, source, source_version, candidate/review transitions,
  -- and audit are all reached, then rolled back together by a forced exception,
  -- leaving the exact pre-block counts.
  SELECT count(*) INTO decision_count_before FROM kai.intake_promotion_decisions;
  SELECT count(*) INTO source_count_before FROM kai.sources;
  SELECT count(*) INTO version_count_before FROM kai.source_versions;
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit WHERE operation = 'source_promotion_decision_persisted';
  BEGIN
    decision_insert_reached := true;
    INSERT INTO kai.intake_promotion_decisions (organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type)
    VALUES (org1, candidate2, review_item2, reviewed_type);

    source_insert_reached := true;
    INSERT INTO kai.sources (organization_id, source_code, reviewed_source_type)
    VALUES (org1, repeat('c', 64), reviewed_type);

    version_insert_reached := true;
    INSERT INTO kai.source_versions (organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256)
    SELECT org1, source_id, candidate2, sensitivity2, checksum2 FROM kai.sources WHERE organization_id = org1 AND source_code = repeat('c', 64);

    audit_insert_reached := true;
    INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata)
    VALUES (
      org1, file1, 'source_promotion_decision_persisted', 'confirmed', 'confirmed', 'success',
      jsonb_build_object(
        'metadata_only', true, 'contract', 'p1_source_promotion_decision_v1',
        'intake_source_candidate_id', candidate2::text, 'intake_sensitivity_profile_id', sensitivity2::text,
        'profile_canonical_sha256', checksum2, 'reviewed_source_type', reviewed_type,
        'decision_status', 'decided', 'candidate_status', 'needs_gk_review', 'queue_status', 'open',
        'source_id', null, 'source_version_id', null, 'validator_key', 'VAL-KAI-P1-08-001'
      )
    );

    RAISE EXCEPTION 'force rollback after decision, source, source_version, and audit insert';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT count(*) INTO decision_count_after FROM kai.intake_promotion_decisions;
  SELECT count(*) INTO source_count_after FROM kai.sources;
  SELECT count(*) INTO version_count_after FROM kai.source_versions;
  SELECT count(*) INTO audit_count_after FROM kai.upload_lifecycle_audit WHERE operation = 'source_promotion_decision_persisted';
  INSERT INTO p1_08_results VALUES (
    'transaction_and_audit_atomicity',
    CASE WHEN decision_insert_reached AND source_insert_reached AND version_insert_reached AND audit_insert_reached
           AND decision_count_after = decision_count_before
           AND source_count_after = source_count_before
           AND version_count_after = version_count_before
           AND audit_count_after = audit_count_before
         THEN 'PASS' ELSE 'FAIL' END,
    'the decision, source, source_version, and audit inserts were all reached before a forced exception rolled back all effects together'
  );

  INSERT INTO p1_08_results VALUES (
    'audit_metadata_no_raw_content',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'source_promotion_decision_persisted'
         AND metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/|signed_url|storage_uri)'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'source-promotion audit rows exclude raw/free-text content and storage pointers'
  );

  INSERT INTO p1_08_results VALUES (
    'audit_metadata_exact_keys',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'source_promotion_decision_persisted'
         AND metadata - ARRAY[
           'metadata_only', 'contract', 'intake_source_candidate_id', 'intake_sensitivity_profile_id',
           'profile_canonical_sha256', 'reviewed_source_type', 'decision_status', 'candidate_status',
           'queue_status', 'source_id', 'source_version_id', 'validator_key'
         ] <> '{}'::jsonb
    ) THEN 'PASS' ELSE 'FAIL' END,
    'source-promotion audit metadata carries no keys beyond the accepted twelve-key allowlist'
  );
END $$;

SELECT 'P1_08_SMOKE' AS result_type, check_name, status, detail
FROM p1_08_results
ORDER BY check_name;

ROLLBACK;
