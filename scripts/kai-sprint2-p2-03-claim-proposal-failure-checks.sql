BEGIN;

CREATE TEMP TABLE p2_03_failure_results (
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
  profile1 uuid := '50000000-0000-4000-8000-000000000001';
  dictionary1 uuid := '60000000-0000-4000-8000-000000000001';
  sensitivity1 uuid := '80000000-0000-4000-8000-000000000001';
  candidate1 uuid := '90000000-0000-4000-8000-000000000001';
  fixture_checksum text := repeat('9', 64);
  fabricated_sha text := repeat('a', 64);
  bogus_uuid uuid := '99999999-0000-4000-8000-000000000999';
  decision_review_item1 uuid;
  parser_run1 uuid;
  source1 uuid;
  source_version1 uuid;
  locator1 uuid;
  evidence1 uuid;
  claim1 uuid;
  claim_statement1 text;
  claim_fingerprint1 text;
BEGIN
  -- Self-contained fixture chain, matching the established P2-01 lineage: file ->
  -- profile -> dictionary -> sensitivity profile -> candidate -> promoted decision
  -- -> source -> current source_version -> locator -> evidence item -> evidence
  -- review queue item.
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
  INSERT INTO kai.source_locators (source_locator_id, organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
  VALUES (gen_random_uuid(), org1, source_version1, 'column', jsonb_build_object('column_name', 'email'), fabricated_sha)
  RETURNING source_locator_id INTO locator1;
  INSERT INTO kai.evidence_items (evidence_item_id, organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
  VALUES (gen_random_uuid(), org1, source1, source_version1, locator1, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'unknown', 'unassessed', 'Source version''s committed data dictionary includes field "email" of committed type "text".', fabricated_sha, 'human')
  RETURNING evidence_item_id INTO evidence1;
  INSERT INTO kai.review_queue_items (
    organization_id, queue_type, target_object_type, target_object_id,
    priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
  ) VALUES (
    org1, 'evidence_review', 'evidence_item', evidence1,
    'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.',
    'Review the evidence item''s lineage, sensitivity, support strength, and audience eligibility before use.',
    '{}'::jsonb, 'system'
  );

  claim_statement1 := 'The promoted source contains the committed data-dictionary field "email" identified by locator ' || fabricated_sha || '.';
  claim_fingerprint1 := encode(digest(org1::text || '|' || evidence1::text || '|finding|' || claim_statement1, 'sha256'), 'hex');

  -- claim_type vocabulary enforcement: only 'finding' is ever accepted.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'fabricated_claim_type', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1);
    INSERT INTO p2_03_failure_results VALUES ('claim_type_vocabulary_enforced', 'FAIL', 'a fabricated claim_type was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_type_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- claim_status pin enforcement.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'finding', 'approved_internal', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1);
    INSERT INTO p2_03_failure_results VALUES ('claim_status_pin_enforced', 'FAIL', 'an out-of-scope claim_status was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_status_pin_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- claim_review_status pin enforcement.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'finding', 'proposed', 'resolved', 'unassessed', claim_statement1, claim_fingerprint1);
    INSERT INTO p2_03_failure_results VALUES ('claim_review_status_pin_enforced', 'FAIL', 'a fabricated claim_review_status was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_review_status_pin_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- claim_strength pin enforcement.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'strong', claim_statement1, claim_fingerprint1);
    INSERT INTO p2_03_failure_results VALUES ('claim_strength_pin_enforced', 'FAIL', 'a fabricated claim_strength was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_strength_pin_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- opening any audience gate is rejected.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, public_use_allowed)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1, true);
    INSERT INTO p2_03_failure_results VALUES ('public_use_pin_enforced', 'FAIL', 'public_use_allowed = true was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('public_use_pin_enforced', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, funder_use_allowed)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1, true);
    INSERT INTO p2_03_failure_results VALUES ('funder_use_pin_enforced', 'FAIL', 'funder_use_allowed = true was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('funder_use_pin_enforced', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, llm_processing_allowed)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1, true);
    INSERT INTO p2_03_failure_results VALUES ('llm_processing_pin_enforced', 'FAIL', 'llm_processing_allowed = true was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('llm_processing_pin_enforced', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, product_learning_allowed)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1, true);
    INSERT INTO p2_03_failure_results VALUES ('product_learning_pin_enforced', 'FAIL', 'product_learning_allowed = true was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('product_learning_pin_enforced', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, export_ready)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1, true);
    INSERT INTO p2_03_failure_results VALUES ('export_ready_pin_enforced', 'FAIL', 'export_ready = true was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('export_ready_pin_enforced', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, internal_only)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1, false);
    INSERT INTO p2_03_failure_results VALUES ('internal_only_pin_enforced', 'FAIL', 'internal_only = false was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('internal_only_pin_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- caller-shaped claim text (unsafe content / over-length) is rejected.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', 'See https://example.com/secret for details.', fabricated_sha);
    INSERT INTO p2_03_failure_results VALUES ('statement_unsafe_content_rejected', 'FAIL', 'a statement containing a URL was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('statement_unsafe_content_rejected', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', repeat('x', 501), fabricated_sha);
    INSERT INTO p2_03_failure_results VALUES ('statement_length_enforced', 'FAIL', 'a statement over 500 characters was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('statement_length_enforced', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, 'not-a-real-sha256');
    INSERT INTO p2_03_failure_results VALUES ('statement_fingerprint_shape_enforced', 'FAIL', 'a malformed statement_fingerprint was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('statement_fingerprint_shape_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- cross-tenant evidence_item_id reference is rejected: org2 has no evidence1 row.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org2, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1);
    INSERT INTO p2_03_failure_results VALUES ('cross_tenant_evidence_item_reference_rejected', 'FAIL', 'a cross-tenant evidence_item_id reference was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('cross_tenant_evidence_item_reference_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- fabricated evidence_item_id is rejected.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, bogus_uuid, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1);
    INSERT INTO p2_03_failure_results VALUES ('fabricated_evidence_item_rejected', 'FAIL', 'a fabricated evidence_item_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('fabricated_evidence_item_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- duplicate claim identity bypassing the unique constraint is rejected.
  INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
  VALUES (gen_random_uuid(), org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1)
  RETURNING claim_id INTO claim1;
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1);
    INSERT INTO p2_03_failure_results VALUES ('duplicate_claim_identity_rejected', 'FAIL', 'duplicate organization_id + evidence_item_id + claim_type unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('duplicate_claim_identity_rejected', 'PASS', 'safe unique-violation failure via claims_p2_03_identity_unique');
  END;

  -- claim_evidence_links: one-link-per-claim enforcement and fabricated FK rejection.
  INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id)
  VALUES (org1, claim1, evidence1);
  BEGIN
    INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id)
    VALUES (org1, claim1, evidence1);
    INSERT INTO p2_03_failure_results VALUES ('claim_evidence_link_duplicate_rejected', 'FAIL', 'a duplicate claim_evidence_links row unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_evidence_link_duplicate_rejected', 'PASS', 'safe unique-violation failure');
  END;
  BEGIN
    INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id)
    VALUES (org1, bogus_uuid, evidence1);
    INSERT INTO p2_03_failure_results VALUES ('claim_evidence_link_fabricated_claim_rejected', 'FAIL', 'a fabricated claim_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_evidence_link_fabricated_claim_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- review_queue_items claim_review: partial unique index enforcement and
  -- missing/blank required_action rejection.
  INSERT INTO kai.review_queue_items (
    organization_id, queue_type, target_object_type, target_object_id,
    priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
  ) VALUES (
    org1, 'claim_review', 'claim', claim1,
    'normal', 'open', 'needs_gk_review', 'Review proposed internal-only claim.',
    'Review the claim''s evidence lineage, support strength, limitations, requirement coverage, and audience eligibility before any use.',
    '{}'::jsonb, 'system'
  );
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
    ) VALUES (
      org1, 'claim_review', 'claim', claim1,
      'normal', 'open', 'needs_gk_review', 'Review proposed internal-only claim.',
      'Review the claim''s evidence lineage, support strength, limitations, requirement coverage, and audience eligibility before any use.',
      '{}'::jsonb, 'system'
    );
    INSERT INTO p2_03_failure_results VALUES ('claim_review_identity_unique_enforced', 'FAIL', 'duplicate claim_review queue item unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_review_identity_unique_enforced', 'PASS', 'safe unique-violation failure via ux_review_queue_items_p2_03_claim_review_identity');
  END;
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
    ) VALUES (
      org1, 'claim_review', 'claim', gen_random_uuid(),
      'normal', 'open', 'needs_gk_review', 'Review proposed internal-only claim.', NULL, '{}'::jsonb, 'system'
    );
    INSERT INTO p2_03_failure_results VALUES ('claim_review_required_action_enforced', 'FAIL', 'a null required_action for a claim_review queue item was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_review_required_action_enforced', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type
    ) VALUES (
      org1, 'claim_review', 'claim', gen_random_uuid(),
      'normal', 'open', 'needs_gk_review', 'Review proposed internal-only claim.', '   ', '{}'::jsonb, 'system'
    );
    INSERT INTO p2_03_failure_results VALUES ('claim_review_required_action_blank_rejected', 'FAIL', 'a blank required_action for a claim_review queue item was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_03_failure_results VALUES ('claim_review_required_action_blank_rejected', 'PASS', 'safe check-violation failure');
  END;
END $$;

SELECT 'P2_03_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, 'kai.claims' AS object_name, status, detail
FROM p2_03_failure_results
ORDER BY check_name;

ROLLBACK;
