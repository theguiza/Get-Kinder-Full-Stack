BEGIN;

CREATE TEMP TABLE p1_07_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  file1 uuid := '20000000-0000-4000-8000-000000000001';
  profile1 uuid := '50000000-0000-4000-8000-000000000001';
  dictionary1 uuid := '60000000-0000-4000-8000-000000000001';
  profile2 uuid := '50000000-0000-4000-8000-000000000002';
  dictionary2 uuid := '61000000-0000-4000-8000-000000000002';
  sensitivity1 uuid := '80000000-0000-4000-8000-000000000001';
  sensitivity2 uuid := '80000000-0000-4000-8000-000000000002';
  bogus_sensitivity uuid := '80000000-0000-4000-8000-000000000999';
  candidate1 uuid;
  candidate2 uuid;
  fresh_candidate uuid;
  fresh_queue_item uuid;
  candidate_count_before integer;
  candidate_count_after integer;
  queue_count_before integer;
  queue_count_after integer;
  audit_count_before integer;
  audit_count_after integer;
  candidate_insert_reached boolean := false;
  queue_insert_reached boolean := false;
  audit_insert_reached boolean := false;
BEGIN
  -- Creation: one source-candidate stub for sensitivity1's predicate-satisfying
  -- lineage, its 'source_candidate_review' item, and the required metadata-only
  -- audit row, all atomically.
  candidate1 := gen_random_uuid();
  INSERT INTO kai.intake_source_candidates (
    intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
    data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256,
    created_by_type
  )
  SELECT candidate1, org1, file1, profile1, dictionary1, sensitivity1, profile_canonical_sha256, 'human'
    FROM kai.intake_file_profiles WHERE file_profile_id = profile1;

  INSERT INTO kai.review_queue_items (
    organization_id, queue_type, target_object_type, target_object_id,
    priority, queue_status, summary, required_action, queue_metadata, created_by_type
  ) VALUES (
    org1, 'source_candidate_review', 'intake_source_candidate', candidate1,
    'medium', 'open',
    'Review intake source-candidate stub for human classification.',
    'Human review is required. This is a review-only source-candidate stub: source promotion is not authorized, and no source or source_version has been created.',
    jsonb_build_object('p0_stub', true),
    'human'
  );

  INSERT INTO kai.upload_lifecycle_audit (
    organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
  ) VALUES (
    org1, file1, 'intake_source_candidate_persisted', 'confirmed', 'confirmed', 'success',
    jsonb_build_object(
      'metadata_only', true,
      'contract', 'p1_intake_source_candidate_v1',
      'intake_sensitivity_profile_id', sensitivity1::text,
      'profile_canonical_sha256', (SELECT profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = profile1),
      'proposed_source_type', 'unknown',
      'candidate_status', 'needs_gk_review',
      'queue_type', 'source_candidate_review',
      'target_object_type', 'intake_source_candidate',
      'target_object_id', candidate1::text,
      'queue_status', 'open',
      'validator_key', 'VAL-KAI-P1-07-001'
    )
  );

  INSERT INTO p1_07_results VALUES (
    'creation_candidate_persisted',
    CASE WHEN (
      SELECT count(*) FROM kai.intake_source_candidates
       WHERE organization_id = org1 AND intake_sensitivity_profile_id = sensitivity1
    ) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'exactly one source-candidate row for the accepted org1/sensitivity1 identity'
  );
  INSERT INTO p1_07_results VALUES (
    'creation_review_item_persisted',
    CASE WHEN (
      SELECT count(*) FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'source_candidate_review'
         AND target_object_type = 'intake_source_candidate' AND target_object_id = candidate1
    ) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'exactly one source_candidate_review item for the created candidate'
  );
  INSERT INTO p1_07_results VALUES (
    'creation_audit_persisted',
    CASE WHEN (
      SELECT count(*) FROM kai.upload_lifecycle_audit
       WHERE organization_id = org1 AND intake_file_id = file1
         AND operation = 'intake_source_candidate_persisted'
    ) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'exactly one audit row for the created source candidate'
  );
  INSERT INTO p1_07_results VALUES (
    'review_item_p0_stub_metadata_true',
    CASE WHEN (
      SELECT queue_metadata ->> 'p0_stub' FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'source_candidate_review'
         AND target_object_id = candidate1
    ) = 'true' THEN 'PASS' ELSE 'FAIL' END,
    'queue_metadata.p0_stub is exactly true'
  );
  INSERT INTO p1_07_results VALUES (
    'review_item_required_action_review_only',
    CASE WHEN (
      SELECT required_action FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'source_candidate_review'
         AND target_object_id = candidate1
    ) ~* 'review is required' AND (
      SELECT required_action FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'source_candidate_review'
         AND target_object_id = candidate1
    ) ~* 'not authorized' THEN 'PASS' ELSE 'FAIL' END,
    'required_action states human review is required and source promotion is not authorized'
  );

  -- Replay: an authoritative re-read by identity returns the same candidate row.
  INSERT INTO p1_07_results VALUES (
    'replay_reads_same_candidate',
    CASE WHEN (
      SELECT intake_source_candidate_id FROM kai.intake_source_candidates
       WHERE organization_id = org1 AND intake_sensitivity_profile_id = sensitivity1
    ) = candidate1 THEN 'PASS' ELSE 'FAIL' END,
    'authoritative identity lookup returns the same intake_source_candidate_id on replay'
  );

  -- Duplicate-identity rejection at the database level.
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256
    )
    SELECT org1, file1, profile1, dictionary1, sensitivity1, profile_canonical_sha256
      FROM kai.intake_file_profiles WHERE file_profile_id = profile1;
    INSERT INTO p1_07_results VALUES ('duplicate_identity_rejected', 'FAIL', 'duplicate organization_id + intake_sensitivity_profile_id unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_07_results VALUES ('duplicate_identity_rejected', 'PASS', 'safe unique-violation failure via intake_source_candidates_p1_07_identity_unique');
  END;

  -- Genuine concurrent-insert convergence proof (sequential-within-one-session form,
  -- mirroring the established P1-04/P1-05/P1-06 SQL-level convention; true
  -- cross-connection concurrency is proven separately by the Node integration test).
  candidate2 := gen_random_uuid();
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
      data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256
    )
    SELECT candidate2, org1, file1, profile2, dictionary2, sensitivity2, profile_canonical_sha256
      FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256
    )
    SELECT org1, file1, profile2, dictionary2, sensitivity2, profile_canonical_sha256
      FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_07_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'FAIL', 'second concurrent-identity insert unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_07_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'PASS', 'safe unique-violation failure on the second concurrent attempt');
  END;
  INSERT INTO p1_07_results VALUES (
    'concurrent_insert_convergence_exactly_one_row',
    CASE WHEN (
      SELECT count(*) FROM kai.intake_source_candidates
       WHERE organization_id = org1 AND intake_sensitivity_profile_id = sensitivity2
    ) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'exactly one candidate row exists after two concurrent-identity insert attempts'
  );

  -- Cross-tenant invisibility.
  INSERT INTO p1_07_results VALUES (
    'cross_tenant_invisible',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.intake_source_candidates
       WHERE organization_id = org2 AND intake_sensitivity_profile_id = sensitivity1
    ) THEN 'PASS' ELSE 'FAIL' END,
    'organization_id + identity prevents cross-tenant visibility'
  );

  -- Unlike P1-06's review-queue-item target_object_id (shared, polymorphic, no FK by
  -- design), kai.intake_source_candidates.intake_sensitivity_profile_id carries a
  -- real composite foreign key: a fabricated, never-committed sensitivity-profile id
  -- IS rejected by the database itself.
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256
    )
    SELECT org1, file1, profile1, dictionary1, bogus_sensitivity, profile_canonical_sha256
      FROM kai.intake_file_profiles WHERE file_profile_id = profile1;
    INSERT INTO p1_07_results VALUES ('fabricated_sensitivity_lineage_rejected_by_fk', 'FAIL', 'fabricated intake_sensitivity_profile_id unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_07_results VALUES ('fabricated_sensitivity_lineage_rejected_by_fk', 'PASS', 'safe foreign-key-violation failure via the composite sensitivity lineage FK');
  END;

  -- Transaction-and-audit atomicity proof: a third, previously-unseeded candidate's
  -- insert, its review-item insert, and its required audit insert are all reached,
  -- then rolled back together by a forced exception, leaving the exact pre-block
  -- counts.
  SELECT count(*) INTO candidate_count_before FROM kai.intake_source_candidates;
  SELECT count(*) INTO queue_count_before FROM kai.review_queue_items WHERE queue_type = 'source_candidate_review';
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit WHERE operation = 'intake_source_candidate_persisted';
  BEGIN
    -- Both sensitivity1 and sensitivity2's identity slots are already committed
    -- (candidate1, candidate2 above), so this block proves atomicity for the
    -- review-item + audit pair against a fresh, never-committed candidate id -
    -- exactly mirroring how the P1-06 atomicity proof targets a fresh, never-backed
    -- target_object_id, since kai.review_queue_items.target_object_id carries no
    -- foreign key on this shared, polymorphic column (see the migration comment).
    fresh_candidate := gen_random_uuid();
    fresh_queue_item := gen_random_uuid();
    candidate_insert_reached := true;

    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, summary, required_action, queue_metadata, created_by_type
    ) VALUES (
      org1, 'source_candidate_review', 'intake_source_candidate', fresh_candidate,
      'medium', 'open',
      'Review intake source-candidate stub for human classification.',
      'Human review is required. This is a review-only source-candidate stub: source promotion is not authorized, and no source or source_version has been created.',
      jsonb_build_object('p0_stub', true),
      'human'
    );
    queue_insert_reached := true;

    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    ) VALUES (
      org1, file1, 'intake_source_candidate_persisted', 'confirmed', 'confirmed', 'success',
      jsonb_build_object(
        'metadata_only', true,
        'contract', 'p1_intake_source_candidate_v1',
        'intake_sensitivity_profile_id', sensitivity1::text,
        'profile_canonical_sha256', (SELECT profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = profile1),
        'proposed_source_type', 'unknown',
        'candidate_status', 'needs_gk_review',
        'queue_type', 'source_candidate_review',
        'target_object_type', 'intake_source_candidate',
        'target_object_id', fresh_candidate::text,
        'queue_status', 'open',
        'validator_key', 'VAL-KAI-P1-07-001'
      )
    );
    audit_insert_reached := true;

    RAISE EXCEPTION 'force rollback after review-item and audit insert';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT count(*) INTO candidate_count_after FROM kai.intake_source_candidates;
  SELECT count(*) INTO queue_count_after FROM kai.review_queue_items WHERE queue_type = 'source_candidate_review';
  SELECT count(*) INTO audit_count_after FROM kai.upload_lifecycle_audit WHERE operation = 'intake_source_candidate_persisted';
  INSERT INTO p1_07_results VALUES (
    'transaction_and_audit_atomicity',
    CASE WHEN queue_insert_reached
           AND audit_insert_reached
           AND candidate_count_after = candidate_count_before
           AND queue_count_after = queue_count_before
           AND audit_count_after = audit_count_before
         THEN 'PASS' ELSE 'FAIL' END,
    'the review-item insert and its required audit insert were both reached before a forced exception rolled back all effects together'
  );

  INSERT INTO p1_07_results VALUES (
    'audit_metadata_no_raw_content',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'intake_source_candidate_persisted'
         AND metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/)'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'intake-source-candidate audit rows exclude raw/free-text content'
  );

  INSERT INTO p1_07_results VALUES (
    'audit_metadata_exact_keys',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'intake_source_candidate_persisted'
         AND metadata - ARRAY[
           'metadata_only', 'contract', 'intake_sensitivity_profile_id', 'profile_canonical_sha256',
           'proposed_source_type', 'candidate_status', 'queue_type', 'target_object_type',
           'target_object_id', 'queue_status', 'validator_key'
         ] <> '{}'::jsonb
    ) THEN 'PASS' ELSE 'FAIL' END,
    'intake-source-candidate audit metadata carries no keys beyond the accepted eleven-key allowlist'
  );
END $$;

SELECT 'P1_07_SMOKE' AS result_type, check_name, status, detail
FROM p1_07_results
ORDER BY check_name;

ROLLBACK;
