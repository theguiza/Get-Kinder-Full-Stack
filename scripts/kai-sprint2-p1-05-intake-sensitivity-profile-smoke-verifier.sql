BEGIN;

CREATE TEMP TABLE p1_05_results (
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
  profile2 uuid := '50000000-0000-4000-8000-000000000002';
  dictionary1 uuid := '60000000-0000-4000-8000-000000000001';
  dictionary2 uuid := '61000000-0000-4000-8000-000000000002';
  bogus_profile uuid := '50000000-0000-4000-8000-000000000999';
  bogus_dictionary uuid := '61000000-0000-4000-8000-000000000999';
  sensitivity_count integer;
  audit_count integer;
  fresh_sensitivity uuid;
  sensitivity_count_before integer;
  sensitivity_count_after integer;
  audit_count_before integer;
  audit_count_after integer;
  profile2_sha text;
  sensitivity_insert_reached boolean := false;
  audit_insert_reached boolean := false;
BEGIN
  SELECT count(*) INTO sensitivity_count
    FROM kai.intake_sensitivity_profiles
   WHERE organization_id = org1 AND file_profile_id = profile1 AND data_dictionary_id = dictionary1;
  INSERT INTO p1_05_results VALUES ('smoke_seed_sensitivity_persisted', CASE WHEN sensitivity_count = 1 THEN 'PASS' ELSE 'FAIL' END, 'exactly one sensitivity profile for the accepted org1/profile1/dictionary1 identity');

  SELECT count(*) INTO audit_count
    FROM kai.upload_lifecycle_audit
   WHERE organization_id = org1 AND intake_file_id = file1 AND operation = 'intake_sensitivity_profile_persisted';
  INSERT INTO p1_05_results VALUES ('smoke_seed_audit_persisted', CASE WHEN audit_count = 1 THEN 'PASS' ELSE 'FAIL' END, 'exactly one audit row for the persisted sensitivity profile');

  INSERT INTO p1_05_results VALUES (
    'cross_tenant_invisible',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.intake_sensitivity_profiles WHERE organization_id = org2 AND file_profile_id = profile1
    ) THEN 'PASS' ELSE 'FAIL' END,
    'tenant/profile/dictionary identity prevents cross-tenant visibility'
  );

  -- one sensitivity profile per organization_id + file_profile_id + data_dictionary_id
  BEGIN
    INSERT INTO kai.intake_sensitivity_profiles (organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
    SELECT org1, file1, profile1, dictionary1, profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = profile1;
    INSERT INTO p1_05_results VALUES ('duplicate_identity_rejected', 'FAIL', 'duplicate organization_id + file_profile_id + data_dictionary_id unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_05_results VALUES ('duplicate_identity_rejected', 'PASS', 'safe unique-violation failure');
  END;

  -- unknown remains a real, distinct, CHECK-enforced enum value: an unsupported token is rejected
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000098';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, pii_status)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary2, profile_canonical_sha256, 'yes' FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('pii_status_enum_enforced', 'FAIL', 'unsupported pii_status token unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_05_results VALUES ('pii_status_enum_enforced', 'PASS', 'safe check-violation failure');
  END;

  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000097';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, allowed_use_status)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary2, profile_canonical_sha256, 'sometimes' FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('allowed_use_status_enum_enforced', 'FAIL', 'unsupported allowed_use_status token unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_05_results VALUES ('allowed_use_status_enum_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- llm_processing_allowed is fail-closed to false
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000096';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, llm_processing_allowed)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary2, profile_canonical_sha256, true FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('llm_processing_locked', 'FAIL', 'llm_processing_allowed=true unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_05_results VALUES ('llm_processing_locked', 'PASS', 'safe check-violation failure');
  END;

  -- product_learning_allowed is fail-closed to false (distinct from LLM processing)
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000095';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, product_learning_allowed)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary2, profile_canonical_sha256, true FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('product_learning_locked', 'FAIL', 'product_learning_allowed=true unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_05_results VALUES ('product_learning_locked', 'PASS', 'safe check-violation failure');
  END;

  -- public_use_allowed is fail-closed to false
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000094';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, public_use_allowed)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary2, profile_canonical_sha256, true FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('public_use_locked', 'FAIL', 'public_use_allowed=true unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_05_results VALUES ('public_use_locked', 'PASS', 'safe check-violation failure');
  END;

  -- funder_use_allowed is fail-closed to false
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000093';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, funder_use_allowed)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary2, profile_canonical_sha256, true FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('funder_use_locked', 'FAIL', 'funder_use_allowed=true unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_05_results VALUES ('funder_use_locked', 'PASS', 'safe check-violation failure');
  END;

  -- human_review_required is fail-closed to true
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000092';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, human_review_required)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary2, profile_canonical_sha256, false FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('human_review_locked', 'FAIL', 'human_review_required=false unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_05_results VALUES ('human_review_locked', 'PASS', 'safe check-violation failure');
  END;

  -- retention_posture is a pinned labeled restriction, never a retention execution
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000091';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256, retention_posture)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary2, profile_canonical_sha256, 'purge_scheduled' FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('retention_posture_locked', 'FAIL', 'non-default retention_posture unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_05_results VALUES ('retention_posture_locked', 'PASS', 'safe check-violation failure');
  END;

  -- lineage FK requires the exact stored profile hash, not a caller-supplied one
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000090';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
    VALUES (fresh_sensitivity, org1, file1, profile2, dictionary2, repeat('9', 64));
    INSERT INTO p1_05_results VALUES ('lineage_hash_mismatch_rejected', 'FAIL', 'sensitivity profile bound to a mismatched profile hash unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_05_results VALUES ('lineage_hash_mismatch_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- nonexistent file_profile_id is rejected
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000089';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
    VALUES (fresh_sensitivity, org1, file1, bogus_profile, dictionary2, repeat('1', 64));
    INSERT INTO p1_05_results VALUES ('nonexistent_file_profile_rejected', 'FAIL', 'foreign-key violation unexpectedly absent');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_05_results VALUES ('nonexistent_file_profile_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- nonexistent data_dictionary_id is rejected
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000088';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
    SELECT fresh_sensitivity, org1, file1, profile2, bogus_dictionary, profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('nonexistent_dictionary_rejected', 'FAIL', 'foreign-key violation unexpectedly absent');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_05_results VALUES ('nonexistent_dictionary_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- a dictionary bound to a different profile than the one supplied is rejected
  -- (dictionary1 is bound to profile1, so pairing it with profile2 here violates
  -- the composite dictionary-lineage FK)
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000087';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
    SELECT fresh_sensitivity, org1, file1, profile2, dictionary1, profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
    INSERT INTO p1_05_results VALUES ('dictionary_profile_lineage_mismatch_rejected', 'FAIL', 'mismatched dictionary/profile lineage unexpectedly accepted');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_05_results VALUES ('dictionary_profile_lineage_mismatch_rejected', 'PASS', 'safe foreign-key violation failure');
  END;

  -- transaction-and-audit atomicity proof: profile2/dictionary2 have no sensitivity
  -- profile of their own yet (every probe above that touched this identity failed on a
  -- constraint violation and rolled back to its own savepoint without committing), so
  -- this is a genuine valid, unseeded lineage - not a duplicate-key probe. Both inserts
  -- must actually succeed and be reached before the forced exception, and the forced
  -- exception must roll back both together, leaving the exact pre-block counts.
  SELECT count(*) INTO sensitivity_count_before FROM kai.intake_sensitivity_profiles;
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit WHERE operation = 'intake_sensitivity_profile_persisted';
  SELECT profile_canonical_sha256 INTO profile2_sha FROM kai.intake_file_profiles WHERE file_profile_id = profile2;
  BEGIN
    fresh_sensitivity := '80000000-0000-4000-8000-000000000099';
    INSERT INTO kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id, profile_canonical_sha256)
    VALUES (fresh_sensitivity, org1, file1, profile2, dictionary2, profile2_sha);
    sensitivity_insert_reached := true;

    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    ) VALUES (
      org1, file1, 'intake_sensitivity_profile_persisted', 'reserved', 'reserved', 'success',
      jsonb_build_object(
        'metadata_only', true, 'contract', 'p1_intake_sensitivity_and_allowed_use_v1',
        'file_profile_id', profile2::text, 'data_dictionary_id', dictionary2::text,
        'profile_canonical_sha256', profile2_sha, 'human_review_required', true,
        'validator_key', 'VAL-KAI-P1-05-001'
      )
    );
    audit_insert_reached := true;

    RAISE EXCEPTION 'force rollback after sensitivity profile and audit insert';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT count(*) INTO sensitivity_count_after FROM kai.intake_sensitivity_profiles;
  SELECT count(*) INTO audit_count_after FROM kai.upload_lifecycle_audit WHERE operation = 'intake_sensitivity_profile_persisted';
  INSERT INTO p1_05_results VALUES (
    'transaction_and_audit_atomicity',
    CASE WHEN sensitivity_insert_reached
           AND audit_insert_reached
           AND sensitivity_count_after = sensitivity_count_before
           AND audit_count_after = audit_count_before
         THEN 'PASS' ELSE 'FAIL' END,
    'both the sensitivity-profile insert and its required audit insert were reached and executed against a valid, previously-unseeded profile2/dictionary2 lineage before a forced exception rolled back both together'
  );

  INSERT INTO p1_05_results VALUES (
    'audit_metadata_no_raw_content',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'intake_sensitivity_profile_persisted'
         AND (metadata ? 'profile' OR metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/)')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'sensitivity-profile audit rows exclude raw profile content'
  );

  INSERT INTO p1_05_results VALUES (
    'audit_metadata_exact_keys',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'intake_sensitivity_profile_persisted'
         AND metadata - ARRAY[
           'metadata_only', 'contract', 'file_profile_id', 'data_dictionary_id',
           'profile_canonical_sha256', 'human_review_required', 'validator_key'
         ] <> '{}'::jsonb
    ) THEN 'PASS' ELSE 'FAIL' END,
    'sensitivity-profile audit metadata carries no keys beyond the accepted allowlist'
  );
END $$;

SELECT 'P1_05_SMOKE' AS result_type, check_name, status, detail
FROM p1_05_results
ORDER BY check_name;

ROLLBACK;
