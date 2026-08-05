BEGIN;

-- P2-01 owner decision: the existing, unmodified Gate A/P1-04 through P1-08 smoke
-- seeds already committed a complete, review-open P1-07 candidate/review pair
-- (candidate1 = 90000000-0000-4000-8000-000000000001, bound to
-- sensitivity1/dictionary1, which already carries two committed
-- kai.data_dictionary_fields rows: field_1, field_2) and P1-08's own smoke
-- verifier exercises promotion inside a transaction it always rolls back, so no
-- promoted kai.sources/kai.source_versions/kai.intake_promotion_decisions row for
-- candidate1 persists into this package's own run. This seed advances candidate1
-- through exactly the same promotion this package's own P1-08 dependency requires
-- - candidate_status -> 'promoted', its review item -> 'resolved', one
-- deterministic kai.sources row, and its current kai.source_versions row - so the
-- P2-01 smoke verifier has a real, fully promoted lineage to extract evidence
-- from. No evidence_item, source_locator, or evidence_review queue item is seeded
-- here; those are exercised fresh by the P2-01 smoke verifier itself.

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate1 uuid := '90000000-0000-4000-8000-000000000001';
  reviewed_type text := 'organization_primary_record';
  review_item1 uuid;
  checksum1 text;
  sensitivity1 uuid;
  source_code1 text;
  source1 uuid := gen_random_uuid();
  source_version1 uuid;
BEGIN
  SELECT review_queue_item_id INTO review_item1 FROM kai.review_queue_items
   WHERE organization_id = org1 AND queue_type = 'source_candidate_review' AND target_object_id = candidate1;
  SELECT profile_canonical_sha256, intake_sensitivity_profile_id INTO checksum1, sensitivity1
    FROM kai.intake_source_candidates WHERE intake_source_candidate_id = candidate1;
  source_code1 := encode(digest(org1::text || '|' || sensitivity1::text || '|' || checksum1 || '|' || reviewed_type, 'sha256'), 'hex');

  UPDATE kai.intake_source_candidates
     SET candidate_status = 'promoted'
   WHERE intake_source_candidate_id = candidate1 AND candidate_status = 'needs_gk_review';

  UPDATE kai.review_queue_items
     SET queue_status = 'resolved', review_status = 'resolved'
   WHERE review_queue_item_id = review_item1 AND queue_status = 'open';

  INSERT INTO kai.sources (source_id, organization_id, source_code, reviewed_source_type, created_by_type)
  VALUES (source1, org1, source_code1, reviewed_type, 'human');

  INSERT INTO kai.source_versions (
    organization_id, source_id, intake_source_candidate_id, intake_sensitivity_profile_id, profile_canonical_sha256, created_by_type
  ) VALUES (org1, source1, candidate1, sensitivity1, checksum1, 'human')
  RETURNING source_version_id INTO source_version1;

  INSERT INTO kai.intake_promotion_decisions (
    organization_id, intake_source_candidate_id, review_queue_item_id, reviewed_source_type,
    decision_status, source_id, source_version_id, promoted_at, created_by_type
  ) VALUES (org1, candidate1, review_item1, reviewed_type, 'promoted', source1, source_version1, now(), 'human');
END $$;

COMMIT;
