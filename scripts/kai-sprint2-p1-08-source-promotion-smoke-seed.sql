BEGIN;

-- P1-08 owner decision: the existing, unmodified Gate A/P1-04/P1-05/P1-06 smoke
-- seeds already committed two independent, predicate-satisfying P1-05 sensitivity
-- profiles under org1 (sensitivity1, sensitivity2), but no earlier package's smoke
-- seed inserts an actual kai.intake_source_candidates row - P1-07's own smoke seed
-- intentionally seeds none, reusing only the P1-05 profiles directly. P1-08's
-- verifier exercises decision creation, so this seed inserts the two P1-07
-- candidate/review-item pairs it targets: one complete, open pair per sensitivity
-- profile, at the exact P1-07-pinned defaults (candidate_status =
-- 'needs_gk_review', queue_status = 'open'). No source, source_version, or
-- promotion-decision row is seeded here; those are exercised fresh by the P1-08
-- smoke verifier itself.

INSERT INTO kai.intake_source_candidates (
  intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
  data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
)
SELECT '90000000-0000-4000-8000-000000000001'::uuid, organization_id, intake_file_id, file_profile_id,
       data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, 'human'
  FROM kai.intake_sensitivity_profiles
 WHERE intake_sensitivity_profile_id = '80000000-0000-4000-8000-000000000001';

INSERT INTO kai.review_queue_items (
  organization_id, queue_type, target_object_type, target_object_id,
  priority, queue_status, summary, required_action, queue_metadata, created_by_type
)
SELECT organization_id, 'source_candidate_review', 'intake_source_candidate', '90000000-0000-4000-8000-000000000001'::uuid,
       'medium', 'open', 'Review intake source-candidate stub for human classification.',
       'Human review is required. This is a review-only source-candidate stub: source promotion is not authorized, and no source or source_version has been created.',
       jsonb_build_object('p0_stub', true), 'human'
  FROM kai.intake_source_candidates WHERE intake_source_candidate_id = '90000000-0000-4000-8000-000000000001';

INSERT INTO kai.intake_source_candidates (
  intake_source_candidate_id, organization_id, intake_file_id, file_profile_id,
  data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
)
SELECT '90000000-0000-4000-8000-000000000002'::uuid, organization_id, intake_file_id, file_profile_id,
       data_dictionary_id, intake_sensitivity_profile_id, profile_canonical_sha256, 'human'
  FROM kai.intake_sensitivity_profiles
 WHERE intake_sensitivity_profile_id = '80000000-0000-4000-8000-000000000002';

INSERT INTO kai.review_queue_items (
  organization_id, queue_type, target_object_type, target_object_id,
  priority, queue_status, summary, required_action, queue_metadata, created_by_type
)
SELECT organization_id, 'source_candidate_review', 'intake_source_candidate', '90000000-0000-4000-8000-000000000002'::uuid,
       'medium', 'open', 'Review intake source-candidate stub for human classification.',
       'Human review is required. This is a review-only source-candidate stub: source promotion is not authorized, and no source or source_version has been created.',
       jsonb_build_object('p0_stub', true), 'human'
  FROM kai.intake_source_candidates WHERE intake_source_candidate_id = '90000000-0000-4000-8000-000000000002';

COMMIT;
