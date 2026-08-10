BEGIN;

CREATE TEMP TABLE p1_07_failure_results (
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
  bogus_sensitivity uuid := '80000000-0000-4000-8000-000000000998';
  fixture_checksum text := repeat('9', 64);
  fabricated_sha text := repeat('a', 64);
  fabricated_candidate_row_id uuid;
  parser_run1 uuid;
BEGIN
  -- This script runs before any package's smoke seed applies (matching the
  -- established P1-06 runner ordering), so - unlike P1-06's own polymorphic,
  -- FK-free target_object_id - this package's real composite lineage foreign keys
  -- require a self-contained fixture chain (file -> profile -> dictionary ->
  -- sensitivity profile) to exist before any positive-lineage insert below can be
  -- exercised at all. This whole script runs inside one BEGIN ... ROLLBACK, so
  -- nothing here is ever persisted.
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

  -- proposed_source_type is pinned to 'unknown' only: no explicit source-type
  -- producer contract exists yet, so any other value is rejected rather than
  -- fabricated.
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256, proposed_source_type
    )
    SELECT org1, file1, profile1, dictionary1, sensitivity1, profile_canonical_sha256, 'donation_platform'
      FROM kai.intake_file_profiles WHERE file_profile_id = profile1;
    INSERT INTO p1_07_failure_results VALUES ('proposed_source_type_pinned_unknown_enforced', 'FAIL', 'a fabricated non-unknown proposed_source_type was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('proposed_source_type_pinned_unknown_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- candidate_status is pinned to 'needs_gk_review' only: no promoted, approved,
  -- finalized, or export-ready state can be written by this foundation package.
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256, candidate_status
    )
    SELECT org1, file1, profile1, dictionary1, sensitivity1, profile_canonical_sha256, 'approved'
      FROM kai.intake_file_profiles WHERE file_profile_id = profile1;
    INSERT INTO p1_07_failure_results VALUES ('candidate_status_pinned_needs_review_enforced', 'FAIL', 'a fabricated promoted/approved candidate_status was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('candidate_status_pinned_needs_review_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- profile_canonical_sha256 shape enforcement.
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256
    ) VALUES (org1, file1, profile1, dictionary1, sensitivity1, 'not-a-real-sha256');
    INSERT INTO p1_07_failure_results VALUES ('profile_canonical_sha256_shape_enforced', 'FAIL', 'a malformed profile_canonical_sha256 was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('profile_canonical_sha256_shape_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- created_by_type vocabulary enforcement.
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
    )
    SELECT org1, file1, profile1, dictionary1, sensitivity1, profile_canonical_sha256, 'ai'
      FROM kai.intake_file_profiles WHERE file_profile_id = profile1;
    INSERT INTO p1_07_failure_results VALUES ('created_by_type_vocabulary_enforced', 'FAIL', 'an unsupported created_by_type was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('created_by_type_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- Composite sensitivity-lineage FK rejects a fabricated, never-committed
  -- intake_sensitivity_profile_id.
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256
    ) VALUES (org1, file1, profile1, dictionary1, bogus_sensitivity, fabricated_sha);
    INSERT INTO p1_07_failure_results VALUES ('fabricated_sensitivity_id_rejected', 'FAIL', 'a fabricated intake_sensitivity_profile_id was unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('fabricated_sensitivity_id_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- Mismatched lineage (a real sensitivity_profile_id paired with a checksum that
  -- does not belong to its own committed lineage tuple) is rejected by the same
  -- composite FK.
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256
    ) VALUES (org1, file1, profile1, dictionary1, sensitivity1, fabricated_sha);
    INSERT INTO p1_07_failure_results VALUES ('mismatched_checksum_lineage_rejected', 'FAIL', 'a mismatched profile_canonical_sha256 was unexpectedly accepted for a real sensitivity_profile_id');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('mismatched_checksum_lineage_rejected', 'PASS', 'safe foreign-key-violation failure');
  END;

  -- Identity-unique enforcement (organization_id, intake_sensitivity_profile_id).
  INSERT INTO kai.intake_source_candidates (
    organization_id, intake_file_id, file_profile_id, data_dictionary_id,
    intake_sensitivity_profile_id, profile_canonical_sha256
  )
  SELECT org1, file1, profile1, dictionary1, sensitivity1, profile_canonical_sha256
    FROM kai.intake_file_profiles WHERE file_profile_id = profile1;
  BEGIN
    INSERT INTO kai.intake_source_candidates (
      organization_id, intake_file_id, file_profile_id, data_dictionary_id,
      intake_sensitivity_profile_id, profile_canonical_sha256
    )
    SELECT org1, file1, profile1, dictionary1, sensitivity1, profile_canonical_sha256
      FROM kai.intake_file_profiles WHERE file_profile_id = profile1;
    INSERT INTO p1_07_failure_results VALUES ('identity_unique_enforced', 'FAIL', 'duplicate organization_id + intake_sensitivity_profile_id unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('identity_unique_enforced', 'PASS', 'safe unique-violation failure');
  END;

  -- source_candidate_review queue-type vocabulary already existed (reserved by
  -- P1-06); a bogus queue_type is still rejected on kai.review_queue_items.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'not_a_real_queue_type', 'intake_source_candidate', gen_random_uuid(), 'x');
    INSERT INTO p1_07_failure_results VALUES ('queue_type_vocabulary_enforced', 'FAIL', 'unsupported queue_type unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('queue_type_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- source_candidate_review identity-unique enforcement on the shared
  -- kai.review_queue_items table.
  fabricated_candidate_row_id := gen_random_uuid();
  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, required_action)
  VALUES (org1, 'source_candidate_review', 'intake_source_candidate', fabricated_candidate_row_id, 'x', 'x');
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, required_action)
    VALUES (org1, 'source_candidate_review', 'intake_source_candidate', fabricated_candidate_row_id, 'y', 'y');
    INSERT INTO p1_07_failure_results VALUES ('source_candidate_review_identity_unique_enforced', 'FAIL', 'duplicate source_candidate_review identity unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('source_candidate_review_identity_unique_enforced', 'PASS', 'safe unique-violation failure');
  END;

  -- Other queue_types are not deduplicated by the source_candidate_review partial
  -- unique index: a second 'intake_file_review' row for the same target succeeds.
  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
  VALUES (org1, 'intake_file_review', 'intake_file', file1, 'first review');
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'intake_file_review', 'intake_file', file1, 'second review');
    INSERT INTO p1_07_failure_results VALUES ('other_queue_types_not_deduplicated', 'PASS', 'a second intake_file_review row for the same target was correctly not rejected');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_07_failure_results VALUES ('other_queue_types_not_deduplicated', 'FAIL', 'the source_candidate_review-only partial unique index unexpectedly rejected an unrelated queue_type');
  END;
END $$;

SELECT 'P1_07_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, 'kai.intake_source_candidates' AS object_name, status, detail
FROM p1_07_failure_results
ORDER BY check_name;

ROLLBACK;
