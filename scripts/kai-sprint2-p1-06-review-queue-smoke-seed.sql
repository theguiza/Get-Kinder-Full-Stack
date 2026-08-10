BEGIN;

-- This smoke seed runs after the existing, unmodified Gate A, P1-04, and P1-05 smoke
-- seeds. P1-05's own smoke seed already committed sensitivity1 (org1/file1/profile1/
-- dictionary1) with every VAL-FUP-001-P0 predicate column at its fail-closed default
-- (human_review_required = true, public/funder/llm/product_learning_allowed = false,
-- retention_posture = 'restricted_pending_review'), so it already satisfies the P1-06
-- creation-trigger predicate without any P1-06-side change. This seed adds a second,
-- independent, equally predicate-satisfying sensitivity profile (org1/file1/profile2/
-- dictionary2, both already created by the P1-04/P1-05 smoke seeds) so the smoke
-- verifier below can exercise a second, distinct target identity.
WITH constants AS (
  SELECT '00000000-0000-4000-8000-000000000001'::uuid AS org1,
         '20000000-0000-4000-8000-000000000001'::uuid AS file1,
         '50000000-0000-4000-8000-000000000002'::uuid AS profile2_id,
         '61000000-0000-4000-8000-000000000002'::uuid AS dictionary2_id,
         '80000000-0000-4000-8000-000000000002'::uuid AS sensitivity2_id
)
INSERT INTO kai.intake_sensitivity_profiles (
  intake_sensitivity_profile_id, organization_id, intake_file_id, file_profile_id, data_dictionary_id,
  profile_canonical_sha256, created_at
)
SELECT sensitivity2_id, org1, file1, profile2_id, dictionary2_id, profile_canonical_sha256, '2026-08-04T10:00:07Z'
  FROM constants
  JOIN kai.intake_file_profiles ON intake_file_profiles.file_profile_id = constants.profile2_id
 WHERE EXISTS (
   SELECT 1 FROM kai.data_dictionaries
    WHERE data_dictionary_id = constants.dictionary2_id
      AND organization_id = constants.org1
      AND file_profile_id = constants.profile2_id
 );

COMMIT;
