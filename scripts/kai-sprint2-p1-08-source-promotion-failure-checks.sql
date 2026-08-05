BEGIN;

CREATE TEMP TABLE p1_08_failure_results (
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
  profile2 uuid := '50000000-0000-4000-8000-000000000002';
  dictionary2 uuid := '61000000-0000-4000-8000-000000000002';
  sensitivity1 uuid := '80000000-0000-4000-8000-000000000001';
  sensitivity2 uuid := '80000000-0000-4000-8000-000000000002';
  candidate1 uuid := '90000000-0000-4000-8000-000000000001';
  bogus_candidate uuid := '90000000-0000-4000-8000-000000000998';
  fixture_checksum text := repeat('9', 64);
  fixture_checksum2 text := repeat('8', 64);
  fabricated_sha text := repeat('a', 64);
  review_item1 uuid;
  source1 uuid;
  source2 uuid;
  parser_run1 uuid;
  parser_run2 uuid;
BEGIN
  -- Self-contained fixture chain (file -> profile -> dictionary -> sensitivity
  -- profile -> candidate -> review item), matching the established P1-07 runner
  -- ordering: this script runs before any package's smoke seed applies.
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
  INSERT INTO kai.intake_sensitivity_profiles (
    intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
    profile_canonical_sha256, created_at
  ) VALUES (
    sensitivity1, org1, file1, profile1, dictionary1, fixture_checksum, now()
  );
  INSERT INTO kai.intake_parser_runs (
    organization_id, intake_file_id, parser_name, parser_version, checksum, parser_status, started_at
  ) VALUES (
    org1, file1, 'kai_local_profiling_kernel', '1.0.0', fixture_checksum2, 'running', now()
  ) RETURNING parser_run_id INTO parser_run2;
  INSERT INTO kai.intake_file_profiles (
    file_profile_id, organization_id, intake_file_id, parser_run_id, parser_name, parser_version,
    checksum, profile, profile_canonical_sha256, created_at
  ) VALUES (
    profile2, org1, file1, parser_run2, 'kai_local_profiling_kernel', '1.0.0', fixture_checksum2,
    '{"status":"profiled","variant":2}'::jsonb, fixture_checksum2, now()
  );
  INSERT INTO kai.data_dictionaries (
    data_dictionary_id, organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at
  ) VALUES (
    dictionary2, org1, file1, profile2, fixture_checksum2, now()
  );
  INSERT INTO kai.intake_sensitivity_profiles (
    intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
    profile_canonical_sha256, created_at
  ) VALUES (
    sensitivity2, org1, file1, profile2, dictionary2, fixture_checksum2, now()
  );
  INSERT INTO kai.intake_source_candidates (
    intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
    data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
  ) VALUES (
    candidate1, org1, file1, profile1, dictionary1, sensitivity1, fixture_checksum, 'human'
  );
  INSERT INTO kai.review_queue_items (
    organization_id, queue_type, target_object_type, target_object_id,
    priority, queue_status, summary, required_action, queue_metadata, created_by_type
  ) VALUES (
    org1, 'source_candidate_review', 'intake_source_candidate', candidate1,
    'normal', 'open', 'Review intake source-candidate stub for human classification.',
    'Human review is required.', jsonb_build_object('p0_stub', true), 'human'
  ) RETURNING review_queue_item_id INTO review_item1;

  -- reviewed_source_type vocabulary enforcement: neither a fabricated value nor
  -- 'unknown' is accepted.
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (
      organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type, decision_status
    ) VALUES (org1, candidate1, review_item1, 'unknown', 'rejected');
    INSERT INTO p1_08_failure_results VALUES ('reviewed_source_type_unknown_rejected', 'FAIL', 'unknown was unexpectedly accepted as a reviewed_source_type');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('reviewed_source_type_unknown_rejected', 'PASS', 'safe check-violation failure');
  END;
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (
      organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type, decision_status
    ) VALUES (org1, candidate1, review_item1, 'fabricated_type_from_a_filename', 'rejected');
    INSERT INTO p1_08_failure_results VALUES ('reviewed_source_type_fabricated_rejected', 'FAIL', 'a fabricated reviewed_source_type was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('reviewed_source_type_fabricated_rejected', 'PASS', 'safe check-violation failure');
  END;

  -- decision_status vocabulary enforcement: P1-08 CORRECTION - the vocabulary is
  -- now 'needs_more_information'/'rejected'/'promoted' (the old transient
  -- 'decided' value no longer exists and is itself now rejected, alongside any
  -- other fabricated status).
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (
      organization_id, intake_source_candidate_id, review_queue_item_id, decision_status
    ) VALUES (org1, candidate1, review_item1, 'decided');
    INSERT INTO p1_08_failure_results VALUES ('decision_status_vocabulary_enforced', 'FAIL', 'an unsupported decision_status was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('decision_status_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- promoted_binding_check: a decision cannot claim decision_status = 'promoted'
  -- without a bound reviewed_source_type/source_id/source_version_id/promoted_at,
  -- and cannot claim decision_status = 'needs_more_information'/'rejected' while
  -- already carrying any of those bindings.
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (
      organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type, decision_status
    ) VALUES (org1, candidate1, review_item1, 'organization_primary_record', 'promoted');
    INSERT INTO p1_08_failure_results VALUES ('promoted_binding_requires_source_ids', 'FAIL', 'a promoted decision with no bound source_id/source_version_id was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('promoted_binding_requires_source_ids', 'PASS', 'safe check-violation failure');
  END;

  -- non-promoted outcomes must not carry a reviewed_source_type binding either.
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (
      organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type, decision_status
    ) VALUES (org1, candidate1, review_item1, 'organization_primary_record', 'needs_more_information');
    INSERT INTO p1_08_failure_results VALUES ('needs_more_information_binding_forbids_reviewed_source_type', 'FAIL', 'a needs_more_information decision with a bound reviewed_source_type was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('needs_more_information_binding_forbids_reviewed_source_type', 'PASS', 'safe check-violation failure');
  END;

  -- fabricated candidate lineage FK rejection: a never-committed candidate id is
  -- rejected by intake_promotion_decisions_p1_08_candidate_fk.
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (
      organization_id, intake_source_candidate_id, review_queue_item_id, decision_status
    ) VALUES (org1, bogus_candidate, review_item1, 'rejected');
    INSERT INTO p1_08_failure_results VALUES ('fabricated_candidate_id_rejected', 'FAIL', 'a fabricated intake_source_candidate_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('fabricated_candidate_id_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- source_code shape enforcement.
  BEGIN
    INSERT INTO kai.sources (organization_id, source_code, reviewed_source_type)
    VALUES (org1, 'not-a-real-sha256', 'organization_primary_record');
    INSERT INTO p1_08_failure_results VALUES ('source_code_shape_enforced', 'FAIL', 'a malformed source_code was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('source_code_shape_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- sources identity-unique enforcement (organization_id, source_code).
  INSERT INTO kai.sources (source_id, organization_id, source_code, reviewed_source_type)
  VALUES (gen_random_uuid(), org1, fabricated_sha, 'organization_primary_record')
  RETURNING source_id INTO source1;
  BEGIN
    INSERT INTO kai.sources (organization_id, source_code, reviewed_source_type)
    VALUES (org1, fabricated_sha, 'public_record');
    INSERT INTO p1_08_failure_results VALUES ('source_identity_unique_enforced', 'FAIL', 'duplicate organization_id + source_code unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('source_identity_unique_enforced', 'PASS', 'safe unique-violation failure');
  END;

  -- source_versions candidate-lineage FK rejection: a checksum mismatched against
  -- the real candidate's own committed lineage is rejected.
  BEGIN
    INSERT INTO kai.source_versions (
      organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256
    ) VALUES (org1, source1, candidate1, sensitivity1, fabricated_sha);
    INSERT INTO p1_08_failure_results VALUES ('mismatched_candidate_lineage_rejected', 'FAIL', 'a mismatched profile_canonical_sha256 was unexpectedly accepted for a real candidate');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('mismatched_candidate_lineage_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- source_versions candidate-identity unique enforcement, then current-version
  -- uniqueness: a second source for the same org, with a second is_current = true
  -- version, is unaffected (this proves the partial unique index is scoped to one
  -- source, not the whole table)...
  INSERT INTO kai.source_versions (
    organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256
  ) VALUES (org1, source1, candidate1, sensitivity1, fixture_checksum);
  BEGIN
    INSERT INTO kai.source_versions (
      organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256
    ) VALUES (org1, source1, candidate1, sensitivity1, fixture_checksum);
    INSERT INTO p1_08_failure_results VALUES ('source_version_candidate_identity_unique_enforced', 'FAIL', 'duplicate organization_id + intake_source_candidate_id unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('source_version_candidate_identity_unique_enforced', 'PASS', 'safe unique-violation failure');
  END;

  -- ...but a second is_current = true version for the SAME source_id (via a
  -- different, never-actually-reachable candidate row) IS rejected by the partial
  -- unique index, proving at most one current version per source.
  INSERT INTO kai.sources (source_id, organization_id, source_code, reviewed_source_type)
  VALUES (gen_random_uuid(), org1, repeat('b', 64), 'organization_primary_record')
  RETURNING source_id INTO source2;
  INSERT INTO kai.intake_source_candidates (
    intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
    data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
  ) VALUES (
    '90000000-0000-4000-8000-000000000002', org1, file1, profile2, dictionary2, sensitivity2, fixture_checksum2, 'human'
  );
  BEGIN
    INSERT INTO kai.source_versions (
      organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256
    ) VALUES (org1, source1, '90000000-0000-4000-8000-000000000002', sensitivity2, fixture_checksum2);
    INSERT INTO p1_08_failure_results VALUES ('current_source_version_uniqueness_enforced', 'FAIL', 'a second is_current source_version for the same source was unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('current_source_version_uniqueness_enforced', 'PASS', 'safe unique-violation failure via ux_source_versions_p1_08_current_per_source');
  END;

  -- intake_promotion_decisions identity-unique enforcement (organization_id,
  -- intake_source_candidate_id).
  INSERT INTO kai.intake_promotion_decisions (
    organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type,
    decision_status, source_id, source_version_id, promoted_at
  )
  SELECT org1, candidate1, review_item1, 'organization_primary_record', 'promoted', source1, source_version_id, now()
    FROM kai.source_versions WHERE source_id = source1 AND intake_source_candidate_id = candidate1;
  BEGIN
    INSERT INTO kai.intake_promotion_decisions (
      organization_id, intake_source_candidate_id, review_queue_item_id, decision_status
    ) VALUES (org1, candidate1, review_item1, 'rejected');
    INSERT INTO p1_08_failure_results VALUES ('decision_identity_unique_enforced', 'FAIL', 'duplicate organization_id + intake_source_candidate_id unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('decision_identity_unique_enforced', 'PASS', 'safe unique-violation failure');
  END;

  -- candidate_status vocabulary is widened to include 'promoted' but nothing else.
  BEGIN
    UPDATE kai.intake_source_candidates SET candidate_status = 'approved' WHERE intake_source_candidate_id = candidate1;
    INSERT INTO p1_08_failure_results VALUES ('candidate_status_still_bounded_vocabulary', 'FAIL', 'an unsupported candidate_status value was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_08_failure_results VALUES ('candidate_status_still_bounded_vocabulary', 'PASS', 'safe check-violation failure');
  END;
  UPDATE kai.intake_source_candidates SET candidate_status = 'promoted' WHERE intake_source_candidate_id = candidate1;
  INSERT INTO p1_08_failure_results VALUES (
    'candidate_status_promoted_now_accepted',
    CASE WHEN (SELECT candidate_status FROM kai.intake_source_candidates WHERE intake_source_candidate_id = candidate1) = 'promoted'
      THEN 'PASS' ELSE 'FAIL' END,
    'candidate_status = promoted is now accepted by the widened P1-08 CHECK'
  );
  -- P1-08 CORRECTION: 'rejected' is also now accepted (the rejected outcome's
  -- terminal candidate_status).
  UPDATE kai.intake_source_candidates SET candidate_status = 'rejected' WHERE intake_source_candidate_id = candidate1;
  INSERT INTO p1_08_failure_results VALUES (
    'candidate_status_rejected_now_accepted',
    CASE WHEN (SELECT candidate_status FROM kai.intake_source_candidates WHERE intake_source_candidate_id = candidate1) = 'rejected'
      THEN 'PASS' ELSE 'FAIL' END,
    'candidate_status = rejected is now accepted by the widened P1-08 CHECK'
  );
END $$;

SELECT 'P1_08_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, 'kai.intake_promotion_decisions' AS object_name, status, detail
FROM p1_08_failure_results
ORDER BY check_name;

ROLLBACK;
