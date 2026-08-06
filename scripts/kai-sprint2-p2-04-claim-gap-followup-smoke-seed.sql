BEGIN;

-- P2-04 owner decision: the chained Gate A/P1-04 through P2-03 smoke seeds
-- (which run ahead of this seed in this package's own local-postgres runner)
-- already commit a fully promoted P1-08 source/source_version for candidate1,
-- bound to committed data-dictionary field 'field_1', plus one real, committed
-- 'column' locator and one real, committed 'dictionary_field_presence_fact'
-- evidence item (with its matching evidence_review queue item) for that field,
-- via kai-sprint2-p2-03-claim-proposal-smoke-seed.sql. But P2-03's own smoke
-- verifier exercises claim/claim_evidence_link/claim_review-queue-item creation
-- inside a transaction it always rolls back, so no persisted P2-03 kai.claims/
-- kai.claim_evidence_links row exists for that evidence item by the time this
-- package's own smoke-seed runs. This seed creates exactly one real, committed
-- 'finding' claim and its canonical claim_evidence_link over that already-
-- promoted evidence item, so the P2-04 smoke verifier has a real, tenant-scoped
-- claim to generate gaps and follow-ups against. No gap_log_item,
-- client_followup_item, or client_followup queue item is seeded here; those
-- are exercised fresh by the P2-04 smoke verifier itself.

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate1 uuid := '90000000-0000-4000-8000-000000000001';
  evidence1 uuid;
  claim_statement1 text;
  claim_fingerprint1 text;
  claim1_id uuid := gen_random_uuid();
  locator_fingerprint1 text;
BEGIN
  SELECT ei.evidence_item_id, sl.locator_fingerprint
    INTO evidence1, locator_fingerprint1
    FROM kai.evidence_items ei
    JOIN kai.source_locators sl ON sl.source_locator_id = ei.source_locator_id
    JOIN kai.source_versions sv ON sv.source_version_id = ei.source_version_id
   WHERE ei.organization_id = org1
     AND sv.intake_source_candidate_id = candidate1
     AND sl.coordinates->>'column_name' = 'field_1';

  claim_statement1 := 'The promoted source contains the committed data-dictionary field "field_1" identified by locator ' || locator_fingerprint1 || '.';
  claim_fingerprint1 := encode(digest(org1::text || '|' || evidence1::text || '|finding|' || claim_statement1, 'sha256'), 'hex');

  INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
  VALUES (claim1_id, org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1, 'human');

  INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
  VALUES (org1, claim1_id, evidence1, 'system');
END $$;

COMMIT;
