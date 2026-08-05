BEGIN;

CREATE TEMP TABLE p2_01_failure_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  batch1 uuid := '10000000-0000-4000-8000-000000000001';
  file1 uuid := '20000000-0000-4000-8000-000000000001';
  profile1 uuid := '50000000-0000-4000-8000-000000000001';
  dictionary1 uuid := '60000000-0000-4000-8000-000000000001';
  sensitivity1 uuid := '80000000-0000-4000-8000-000000000001';
  candidate1 uuid := '90000000-0000-4000-8000-000000000001';
  fixture_checksum text := repeat('9', 64);
  fabricated_sha text := repeat('a', 64);
  bogus_uuid uuid := '99999999-0000-4000-8000-000000000999';
  review_item1 uuid;
  decision_review_item1 uuid;
  parser_run1 uuid;
  source1 uuid;
  source_version1 uuid;
  evidence1 uuid;
  locator1 uuid;
BEGIN
  -- Self-contained fixture chain, matching the established P1-04 through P1-08
  -- lineage: file -> profile -> dictionary -> sensitivity profile -> candidate ->
  -- promoted decision -> source -> current source_version.
  INSERT INTO kai.intake_files (
    intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
    checksum, hash_algorithm, force_new_version, processing_status, parse_status,
    file_policy_status, upload_state, object_version_id, verified_checksum,
    verified_size_bytes, verified_at, upload_state_changed_at, upload_expires_at, created_at
  ) VALUES (
    file1, batch1, org1, 'fixture', 'fixture', fixture_checksum, 'sha256', true,
    'quarantined', 'quarantined', 'pending', 'confirmed', 'v1', fixture_checksum, 1024,
    now(), now(), now() + interval '24 hours', now()
  );
  INSERT INTO kai.intake_parser_runs (
    organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
  ) VALUES (
    org1, file1, 'kai_local_profiling_kernel', '1.0.0', fixture_checksum, 'running', now()
  ) RETURNING parser_run_id INTO parser_run1;
  INSERT INTO kai.intake_file_profiles (
    file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version,
    checksum, profile, profile_canonical_sha256, created_at
  ) VALUES (
    profile1, org1, file1, parser_run1, 'kai_local_profiling_kernel', '1.0.0', fixture_checksum,
    '{"status":"profiled"}'::jsonb, fixture_checksum, now()
  );
  INSERT INTO kai.data_dictionaries (
    data_dictionary_id, organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at
  ) VALUES (
    dictionary1, org1, file1, profile1, fixture_checksum, now()
  );
  INSERT INTO kai.data_dictionary_fields (
    data_dictionary_id, organization_id, file_profile_id, profile_field_key, field_label_safe, data_type
  ) VALUES (
    dictionary1, org1, profile1, 'email', 'Email', 'text'
  );
  INSERT INTO kai.intake_sensitivity_profiles (
    intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
    profile_canonical_sha256, created_at
  ) VALUES (
    sensitivity1, org1, file1, profile1, dictionary1, fixture_checksum, now()
  );
  INSERT INTO kai.intake_source_candidates (
    intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
    data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, candidate_status, created_by_type
  ) VALUES (
    candidate1, org1, file1, profile1, dictionary1, sensitivity1, fixture_checksum, 'promoted', 'human'
  );
  INSERT INTO kai.review_queue_items (
    organization_id, queue_type, target_object_type, target_object_id,
    priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
  ) VALUES (
    org1, 'source_candidate_review', 'intake_source_candidate', candidate1,
    'normal', 'resolved', 'resolved', 'Review intake source-candidate stub for human classification.',
    'Human review is required.', jsonb_build_object('p0_stub', true), 'human'
  ) RETURNING review_queue_item_id INTO decision_review_item1;
  INSERT INTO kai.sources (source_id, organization_id, source_code, reviewed_source_type, created_by_type)
  VALUES (gen_random_uuid(), org1, fabricated_sha, 'organization_primary_record', 'human')
  RETURNING source_id INTO source1;
  INSERT INTO kai.source_versions (
    organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
  ) VALUES (org1, source1, candidate1, sensitivity1, fixture_checksum, 'human')
  RETURNING source_version_id INTO source_version1;
  INSERT INTO kai.intake_promotion_decisions (
    organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type,
    decision_status, source_id, source_version_id, promoted_at, created_by_type
  ) VALUES (
    org1, candidate1, decision_review_item1, 'organization_primary_record', 'promoted', source1, source_version1, now(), 'human'
  );

  -- locator_type vocabulary enforcement: only 'column' is ever accepted.
  BEGIN
    INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
    VALUES (org1, source_version1, 'sheet', jsonb_build_object('column_name', 'email'), fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('locator_type_vocabulary_enforced', 'FAIL', 'a non-column locator_type was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('locator_type_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- coordinates shape enforcement: missing column_name, extra key, non-string value.
  BEGIN
    INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
    VALUES (org1, source_version1, 'column', '{}'::jsonb, fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('coordinates_missing_column_name_rejected', 'FAIL', 'coordinates with no column_name key was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('coordinates_missing_column_name_rejected', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
    VALUES (org1, source_version1, 'column', jsonb_build_object('column_name', 'email', 'extra_key', 'nope'), fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('coordinates_extra_key_rejected', 'FAIL', 'coordinates with an extra key was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('coordinates_extra_key_rejected', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
    VALUES (org1, source_version1, 'column', jsonb_build_object('column_name', 42), fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('coordinates_non_string_value_rejected', 'FAIL', 'a non-string column_name value was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('coordinates_non_string_value_rejected', 'PASS', 'safe check-violation failure');
  END;

  -- locator_fingerprint shape enforcement.
  BEGIN
    INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
    VALUES (org1, source_version1, 'column', jsonb_build_object('column_name', 'email'), 'not-a-real-sha256');
    INSERT INTO p2_01_failure_results VALUES ('locator_fingerprint_shape_enforced', 'FAIL', 'a malformed locator_fingerprint was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('locator_fingerprint_shape_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- source_locators FK rejection: a never-committed source_version_id is rejected.
  BEGIN
    INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
    VALUES (org1, bogus_uuid, 'column', jsonb_build_object('column_name', 'email'), fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('source_locator_fabricated_source_version_rejected', 'FAIL', 'a fabricated source_version_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('source_locator_fabricated_source_version_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- source_locators identity-unique enforcement.
  INSERT INTO kai.source_locators (source_locator_id, organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
  VALUES (gen_random_uuid(), org1, source_version1, 'column', jsonb_build_object('column_name', 'email'), fabricated_sha)
  RETURNING source_locator_id INTO locator1;
  BEGIN
    INSERT INTO kai.source_locators (organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
    VALUES (org1, source_version1, 'column', jsonb_build_object('column_name', 'email'), fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('source_locator_identity_unique_enforced', 'FAIL', 'duplicate organization_id + source_version_id + locator_fingerprint unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('source_locator_identity_unique_enforced', 'PASS', 'safe unique-violation failure');
  END;

  -- evidence_type vocabulary enforcement.
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, 'fabricated_fact_type', 'organization_committed_metadata', 'A statement.', fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('evidence_type_vocabulary_enforced', 'FAIL', 'a fabricated evidence_type was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('evidence_type_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- locator_binding_check: count_fact must have no locator; presence_fact must have one.
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, source_locator_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, locator1, 'dictionary_field_count_fact', 'organization_committed_metadata', 'A statement.', fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('field_count_fact_forbids_locator', 'FAIL', 'a dictionary_field_count_fact with a bound source_locator_id was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('field_count_fact_forbids_locator', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'A statement.', fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('field_presence_fact_requires_locator', 'FAIL', 'a dictionary_field_presence_fact with no bound source_locator_id was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('field_presence_fact_requires_locator', 'PASS', 'safe check-violation failure');
  END;

  -- data_class pin enforcement.
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, 'dictionary_field_count_fact', 'fabricated_class', 'A statement.', fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('data_class_pin_enforced', 'FAIL', 'a fabricated data_class was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('data_class_pin_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- statement safe-content and length enforcement.
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, 'dictionary_field_count_fact', 'organization_committed_metadata', 'See https://example.com/secret for details.', fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('statement_unsafe_content_rejected', 'FAIL', 'a statement containing a URL was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('statement_unsafe_content_rejected', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, 'dictionary_field_count_fact', 'organization_committed_metadata', repeat('x', 501), fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('statement_length_enforced', 'FAIL', 'a statement over 500 characters was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('statement_length_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- statement_fingerprint shape enforcement.
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, 'dictionary_field_count_fact', 'organization_committed_metadata', 'A statement.', 'not-a-real-sha256');
    INSERT INTO p2_01_failure_results VALUES ('statement_fingerprint_shape_enforced', 'FAIL', 'a malformed statement_fingerprint was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('statement_fingerprint_shape_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- governance/allowed-use boolean pins.
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint, public_use_allowed)
    VALUES (org1, source_version1, 'dictionary_field_count_fact', 'organization_committed_metadata', 'A statement.', fabricated_sha, true);
    INSERT INTO p2_01_failure_results VALUES ('public_use_pin_enforced', 'FAIL', 'public_use_allowed = true was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('public_use_pin_enforced', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint, internal_only)
    VALUES (org1, source_version1, 'dictionary_field_count_fact', 'organization_committed_metadata', 'A statement.', fabricated_sha, false);
    INSERT INTO p2_01_failure_results VALUES ('internal_only_pin_enforced', 'FAIL', 'internal_only = false was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('internal_only_pin_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- evidence_items identity-unique enforcement.
  INSERT INTO kai.evidence_items (evidence_item_id, organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
  VALUES (gen_random_uuid(), org1, source_version1, 'dictionary_field_count_fact', 'organization_committed_metadata', 'A statement.', fabricated_sha)
  RETURNING evidence_item_id INTO evidence1;
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, 'dictionary_field_count_fact', 'organization_committed_metadata', 'A statement.', fabricated_sha);
    INSERT INTO p2_01_failure_results VALUES ('evidence_item_identity_unique_enforced', 'FAIL', 'duplicate organization_id + source_version_id + statement_fingerprint unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('evidence_item_identity_unique_enforced', 'PASS', 'safe unique-violation failure');
  END;

  -- evidence_items FK rejection: fabricated source_version_id and fabricated source_locator_id.
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, bogus_uuid, 'dictionary_field_count_fact', 'organization_committed_metadata', 'A different statement.', repeat('b', 64));
    INSERT INTO p2_01_failure_results VALUES ('evidence_item_fabricated_source_version_rejected', 'FAIL', 'a fabricated source_version_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('evidence_item_fabricated_source_version_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, source_locator_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, bogus_uuid, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'A different statement.', repeat('c', 64));
    INSERT INTO p2_01_failure_results VALUES ('evidence_item_fabricated_source_locator_rejected', 'FAIL', 'a fabricated source_locator_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('evidence_item_fabricated_source_locator_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- review_queue_items evidence_review partial unique index enforcement.
  INSERT INTO kai.review_queue_items (
    organization_id, queue_type, target_object_type, target_object_id,
    priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
  ) VALUES (
    org1, 'evidence_review', 'evidence_item', evidence1,
    'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', NULL, '{}'::jsonb, 'system'
  );
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
    ) VALUES (
      org1, 'evidence_review', 'evidence_item', evidence1,
      'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', NULL, '{}'::jsonb, 'system'
    );
    INSERT INTO p2_01_failure_results VALUES ('evidence_review_identity_unique_enforced', 'FAIL', 'duplicate evidence_review queue item unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_01_failure_results VALUES ('evidence_review_identity_unique_enforced', 'PASS', 'safe unique-violation failure via ux_review_queue_items_p2_01_evidence_review_identity');
  END;
END $$;

SELECT 'P2_01_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, 'kai.evidence_items' AS object_name, status, detail
FROM p2_01_failure_results
ORDER BY check_name;

ROLLBACK;
