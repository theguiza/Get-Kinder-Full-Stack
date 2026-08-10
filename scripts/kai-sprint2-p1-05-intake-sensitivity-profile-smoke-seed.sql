BEGIN;

-- This smoke seed runs after the existing, unmodified Gate A and P1-04 smoke seeds,
-- which already created org1/file1, profile1 (bound to dictionary1), and profile2
-- (a second completed profile under the same tenant/file with no dictionary bundle
-- yet). It adds a second dictionary bundle bound to profile2, used only by the
-- targeted negative tests below so they are not shadowed by the one-bundle-per-
-- organization_id + file_profile_id rule already exercised by P1-04's own seed.
WITH constants AS (
  SELECT '00000000-0000-4000-8000-000000000001'::uuid AS org1,
         '20000000-0000-4000-8000-000000000001'::uuid AS file1,
         '50000000-0000-4000-8000-000000000001'::uuid AS profile1_id,
         '50000000-0000-4000-8000-000000000002'::uuid AS profile2_id,
         '60000000-0000-4000-8000-000000000001'::uuid AS dictionary1_id,
         '61000000-0000-4000-8000-000000000002'::uuid AS dictionary2_id,
         '80000000-0000-4000-8000-000000000001'::uuid AS sensitivity1_id
),
dictionary2_insert AS (
  INSERT INTO kai.data_dictionaries (
    data_dictionary_id, organization_id, intake_file_id, file_profile_id, profile_canonical_sha256, created_at
  )
  SELECT dictionary2_id, org1, file1, profile2_id, profile_canonical_sha256, '2026-08-04T10:00:05Z'
    FROM constants
    JOIN kai.intake_file_profiles ON intake_file_profiles.file_profile_id = constants.profile2_id
  RETURNING data_dictionary_id
),
sensitivity1_insert AS (
  INSERT INTO kai.intake_sensitivity_profiles (
    intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
    profile_canonical_sha256, created_at
  )
  SELECT sensitivity1_id, org1, file1, profile1_id, dictionary1_id, profile_canonical_sha256, '2026-08-04T10:00:06Z'
    FROM constants
    JOIN kai.intake_file_profiles ON intake_file_profiles.file_profile_id = constants.profile1_id
    WHERE EXISTS (SELECT 1 FROM dictionary2_insert)
  RETURNING intake_sensitivity_profile_id
)
INSERT INTO kai.upload_lifecycle_audit (
  organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata, created_at
)
SELECT org1, file1, 'intake_sensitivity_profile_persisted', 'reserved', 'reserved', 'success',
       jsonb_build_object(
         'metadata_only', true,
         'contract', 'p1_intake_sensitivity_and_allowed_use_v1',
         'file_profile_id', profile1_id::text,
         'data_dictionary_id', dictionary1_id::text,
         'profile_canonical_sha256', (SELECT profile_canonical_sha256 FROM kai.intake_file_profiles WHERE file_profile_id = profile1_id),
         'human_review_required', true,
         'validator_key', 'VAL-KAI-P1-05-001'
       ),
       '2026-08-04T10:00:06Z'
  FROM constants
  WHERE EXISTS (SELECT 1 FROM sensitivity1_insert);

COMMIT;
