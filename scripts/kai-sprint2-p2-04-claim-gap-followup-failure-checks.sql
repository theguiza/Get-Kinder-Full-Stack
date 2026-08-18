BEGIN;

CREATE TEMP TABLE p2_04_failure_results (
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
  gap1 uuid;
BEGIN
  -- Self-contained fixture chain, matching the established P2-03 lineage: file
  -- -> profile -> dictionary -> sensitivity profile -> candidate -> promoted
  -- decision -> source -> current source_version -> locator -> evidence item
  -- -> evidence review queue item -> claim -> claim_evidence_link.
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
    'medium', 'resolved', 'resolved', 'Review intake source-candidate stub for human classification.',
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
    'medium', 'open', 'needs_gk_review', 'New evidence item requires GK review.',
    'Review the evidence item''s lineage, sensitivity, support strength, and audience eligibility before use.',
    '{}'::jsonb, 'system'
  );

  claim_statement1 := 'The promoted source contains the committed data-dictionary field "email" identified by locator ' || fabricated_sha || '.';
  claim_fingerprint1 := encode(digest(org1::text || '|' || evidence1::text || '|finding|' || claim_statement1, 'sha256'), 'hex');
  INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
  VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1)
  RETURNING claim_id INTO claim1;
  INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id)
  VALUES (org1, claim1, evidence1);

  -- dimension_key vocabulary enforcement: only the exact ten P2-02 dimension
  -- keys are ever accepted.
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, claim1, evidence1, source_version1, 'fabricated_dimension', 'unresolved', 'VAL-KAI-P2-02-fabricated_dimension', 'Claim gap requires review for dimension: fabricated_dimension.');
    INSERT INTO p2_04_failure_results VALUES ('gap_dimension_key_vocabulary_enforced', 'FAIL', 'a fabricated dimension_key was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('gap_dimension_key_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- assessment_status excludes resolved_clear: a resolved_clear dimension
  -- never produces a persisted gap row.
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, claim1, evidence1, source_version1, 'missingness', 'resolved_clear', 'VAL-KAI-P2-02-missingness', 'Claim gap requires review for dimension: missingness.');
    INSERT INTO p2_04_failure_results VALUES ('gap_assessment_status_excludes_resolved_clear', 'FAIL', 'a resolved_clear assessment_status was unexpectedly accepted for a persisted gap');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('gap_assessment_status_excludes_resolved_clear', 'PASS', 'safe check-violation failure');
  END;

  -- validator_key shape enforcement.
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, claim1, evidence1, source_version1, 'missingness', 'unresolved', 'not-a-real-validator-key', 'Claim gap requires review for dimension: missingness.');
    INSERT INTO p2_04_failure_results VALUES ('gap_validator_key_shape_enforced', 'FAIL', 'a malformed validator_key was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('gap_validator_key_shape_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- safe_summary must exactly match the fixed deterministic template for its
  -- own dimension_key.
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, claim1, evidence1, source_version1, 'missingness', 'unresolved', 'VAL-KAI-P2-02-missingness', 'A caller-shaped summary that is not the fixed template.');
    INSERT INTO p2_04_failure_results VALUES ('gap_safe_summary_template_enforced', 'FAIL', 'a non-template safe_summary was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('gap_safe_summary_template_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- negative counts are rejected.
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary, open_finding_count)
    VALUES (org1, claim1, evidence1, source_version1, 'missingness', 'unresolved', 'VAL-KAI-P2-02-missingness', 'Claim gap requires review for dimension: missingness.', -1);
    INSERT INTO p2_04_failure_results VALUES ('gap_negative_count_rejected', 'FAIL', 'a negative open_finding_count was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('gap_negative_count_rejected', 'PASS', 'safe check-violation failure');
  END;

  -- fabricated claim_id / evidence_item_id / source_version_id are rejected.
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, bogus_uuid, evidence1, source_version1, 'missingness', 'unresolved', 'VAL-KAI-P2-02-missingness', 'Claim gap requires review for dimension: missingness.');
    INSERT INTO p2_04_failure_results VALUES ('gap_fabricated_claim_rejected', 'FAIL', 'a fabricated claim_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('gap_fabricated_claim_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- cross-tenant claim_id reference is rejected: org2 has no claim1 row.
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org2, claim1, evidence1, source_version1, 'missingness', 'unresolved', 'VAL-KAI-P2-02-missingness', 'Claim gap requires review for dimension: missingness.');
    INSERT INTO p2_04_failure_results VALUES ('gap_cross_tenant_claim_reference_rejected', 'FAIL', 'a cross-tenant claim_id reference was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('gap_cross_tenant_claim_reference_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- duplicate gap identity rejected.
  INSERT INTO kai.gap_log_items (gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
  VALUES (gen_random_uuid(), org1, claim1, evidence1, source_version1, 'definition_clarity', 'resolved_risk_flagged', 'VAL-KAI-P2-02-definition_clarity', 'Claim gap requires review for dimension: definition_clarity.')
  RETURNING gap_log_item_id INTO gap1;
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, claim1, evidence1, source_version1, 'definition_clarity', 'unresolved', 'VAL-KAI-P2-02-definition_clarity', 'Claim gap requires review for dimension: definition_clarity.');
    INSERT INTO p2_04_failure_results VALUES ('gap_duplicate_identity_rejected', 'FAIL', 'duplicate organization_id + claim_id + dimension_key unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('gap_duplicate_identity_rejected', 'PASS', 'safe unique-violation failure via gap_log_items_p2_04_identity_unique');
  END;

  -- client_followup_items: dimension_key vocabulary restricted to the four
  -- client-answerable dimensions only (a gap on an internal-only dimension can
  -- never be routed to a client follow-up).
  BEGIN
    INSERT INTO kai.client_followup_items (organization_id, claim_id, gap_log_item_id, dimension_key, question_text)
    VALUES (org1, claim1, gap1, 'missingness', 'Confirm the business meaning of the unresolved field or measure.');
    INSERT INTO p2_04_failure_results VALUES ('followup_dimension_key_vocabulary_enforced', 'FAIL', 'an internal-only dimension_key was unexpectedly accepted for a client follow-up');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('followup_dimension_key_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- client_followup_items: question_text must exactly pair with dimension_key.
  BEGIN
    INSERT INTO kai.client_followup_items (organization_id, claim_id, gap_log_item_id, dimension_key, question_text)
    VALUES (org1, claim1, gap1, 'definition_clarity', 'Confirm the denominator and how it is calculated.');
    INSERT INTO p2_04_failure_results VALUES ('followup_dimension_question_pairing_enforced', 'FAIL', 'a mismatched dimension_key/question_text pair was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('followup_dimension_question_pairing_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- client_followup_items: a caller-shaped/augmented question_text is rejected
  -- even for an otherwise-valid dimension_key.
  BEGIN
    INSERT INTO kai.client_followup_items (organization_id, claim_id, gap_log_item_id, dimension_key, question_text)
    VALUES (org1, claim1, gap1, 'definition_clarity', 'Confirm the business meaning of the unresolved field "email".');
    INSERT INTO p2_04_failure_results VALUES ('followup_question_text_vocabulary_enforced', 'FAIL', 'an augmented question_text was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('followup_question_text_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- client_followup_items: fabricated gap_log_item_id is rejected.
  BEGIN
    INSERT INTO kai.client_followup_items (organization_id, claim_id, gap_log_item_id, dimension_key, question_text)
    VALUES (org1, claim1, bogus_uuid, 'definition_clarity', 'Confirm the business meaning of the unresolved field or measure.');
    INSERT INTO p2_04_failure_results VALUES ('followup_fabricated_gap_rejected', 'FAIL', 'a fabricated gap_log_item_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('followup_fabricated_gap_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- client_followup_items: at most one follow-up per gap.
  INSERT INTO kai.client_followup_items (organization_id, claim_id, gap_log_item_id, dimension_key, question_text)
  VALUES (org1, claim1, gap1, 'definition_clarity', 'Confirm the business meaning of the unresolved field or measure.');
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, claim1, evidence1, source_version1, 'entity_level_clarity', 'resolved_risk_flagged', 'VAL-KAI-P2-02-entity_level_clarity', 'Claim gap requires review for dimension: entity_level_clarity.');
    INSERT INTO kai.client_followup_items (organization_id, claim_id, gap_log_item_id, dimension_key, question_text)
    VALUES (org1, claim1, gap1, 'entity_level_clarity', 'Confirm the entity level represented by the unresolved field or measure.');
    INSERT INTO p2_04_failure_results VALUES ('followup_one_per_gap_enforced', 'FAIL', 'a second follow-up for the same gap_log_item_id was unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_04_failure_results VALUES ('followup_one_per_gap_enforced', 'PASS', 'safe unique-violation failure via client_followup_items_p2_04_one_per_gap_unique');
  END;

  -- review_queue_items client_followup contract: any deviation from the fixed
  -- contract for queue_type = 'client_followup' is rejected.
  DECLARE
    followup1 uuid;
  BEGIN
    SELECT client_followup_item_id INTO followup1 FROM kai.client_followup_items WHERE organization_id = org1 AND claim_id = claim1 AND dimension_key = 'definition_clarity';

    BEGIN
      INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, queue_status, review_status, priority, summary, required_action, queue_metadata, created_by_type)
      VALUES (org1, 'client_followup', 'client_followup_item', followup1, 'open', 'proposed', 'medium', 'Client clarification is required for an unresolved claim gap.', 'Confirm the business meaning of the unresolved field or measure.', '{}'::jsonb, 'system');
      INSERT INTO p2_04_failure_results VALUES ('queue_client_followup_queue_status_enforced', 'FAIL', 'a non-waiting_on_client queue_status was unexpectedly accepted for a client_followup row');
    EXCEPTION WHEN check_violation THEN
      INSERT INTO p2_04_failure_results VALUES ('queue_client_followup_queue_status_enforced', 'PASS', 'safe check-violation failure');
    END;

    BEGIN
      INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, queue_status, review_status, priority, summary, required_action, assigned_to, queue_metadata, created_by_type)
      VALUES (org1, 'client_followup', 'client_followup_item', followup1, 'waiting_on_client', 'proposed', 'medium', 'Client clarification is required for an unresolved claim gap.', 'Confirm the business meaning of the unresolved field or measure.', '90000000-0000-4000-8000-000000000001', '{}'::jsonb, 'system');
      INSERT INTO p2_04_failure_results VALUES ('queue_client_followup_assigned_to_null_enforced', 'FAIL', 'a non-null assigned_to was unexpectedly accepted for a client_followup row');
    EXCEPTION WHEN check_violation THEN
      INSERT INTO p2_04_failure_results VALUES ('queue_client_followup_assigned_to_null_enforced', 'PASS', 'safe check-violation failure');
    END;

    BEGIN
      INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, queue_status, review_status, priority, summary, required_action, queue_metadata, created_by_type)
      VALUES (org1, 'client_followup', 'client_followup_item', followup1, 'waiting_on_client', 'proposed', 'medium', 'Client clarification is required for an unresolved claim gap.', 'A conflict was detected between two sources.', '{}'::jsonb, 'system');
      INSERT INTO p2_04_failure_results VALUES ('queue_client_followup_required_action_vocabulary_enforced', 'FAIL', 'an unsupported required_action was unexpectedly accepted for a client_followup row');
    EXCEPTION WHEN check_violation THEN
      INSERT INTO p2_04_failure_results VALUES ('queue_client_followup_required_action_vocabulary_enforced', 'PASS', 'safe check-violation failure');
    END;

    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, queue_status, review_status, priority, summary, required_action, queue_metadata, created_by_type)
    VALUES (org1, 'client_followup', 'client_followup_item', followup1, 'waiting_on_client', 'proposed', 'medium', 'Client clarification is required for an unresolved claim gap.', 'Confirm the business meaning of the unresolved field or measure.', '{}'::jsonb, 'system');
    BEGIN
      INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, queue_status, review_status, priority, summary, required_action, queue_metadata, created_by_type)
      VALUES (org1, 'client_followup', 'client_followup_item', followup1, 'waiting_on_client', 'proposed', 'medium', 'Client clarification is required for an unresolved claim gap.', 'Confirm the business meaning of the unresolved field or measure.', '{}'::jsonb, 'system');
      INSERT INTO p2_04_failure_results VALUES ('queue_client_followup_identity_unique_enforced', 'FAIL', 'duplicate client_followup queue item unexpectedly accepted');
    EXCEPTION WHEN unique_violation THEN
      INSERT INTO p2_04_failure_results VALUES ('queue_client_followup_identity_unique_enforced', 'PASS', 'safe unique-violation failure via ux_review_queue_items_p2_04_client_followup_identity');
    END;
  END;
END $$;

SELECT 'P2_04_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, 'kai.gap_log_items' AS object_name, status, detail
FROM p2_04_failure_results
ORDER BY check_name;

ROLLBACK;
