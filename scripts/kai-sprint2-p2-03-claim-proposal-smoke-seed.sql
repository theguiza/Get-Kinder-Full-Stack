BEGIN;

-- P2-03 owner decision: the chained Gate A/P1-04 through P2-01 smoke seeds (which
-- run ahead of this seed in this package's own local-postgres runner) already
-- commit a fully promoted P1-08 source/source_version for candidate1
-- (90000000-0000-4000-8000-000000000001, bound to a committed data-dictionary
-- field 'field_1'), because kai_sprint2_p2_01_evidence_lineage-smoke-seed.sql
-- itself advances that candidate through the exact P1-08 promotion it depends
-- on. But P2-01's own smoke verifier exercises evidence-item/locator creation
-- inside a transaction it always rolls back, so no persisted P2-01
-- kai.evidence_items/kai.source_locators row exists for that source_version by
-- the time this package's own smoke-seed runs. This seed creates exactly one
-- real, committed 'column' locator and one real, committed
-- 'dictionary_field_presence_fact' evidence item (plus its matching
-- evidence_review queue item) bound to field_1 of that already-promoted
-- source_version, so the P2-03 smoke verifier has real, tenant-scoped,
-- promoted evidence lineage to propose a claim against. No claim,
-- claim_evidence_link, or claim_review queue item is seeded here; those are
-- exercised fresh by the P2-03 smoke verifier itself.

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate1 uuid := '90000000-0000-4000-8000-000000000001';
  source1 uuid;
  source_version1 uuid;
  field1_statement text;
  field1_locator_fingerprint text;
  field1_fingerprint text;
  field1_locator_id uuid := gen_random_uuid();
  field1_evidence_id uuid := gen_random_uuid();
  required_action1 text := 'Review the evidence item''s lineage, sensitivity, support strength, and audience eligibility before use.';
BEGIN
  SELECT source_id, source_version_id INTO source1, source_version1
    FROM kai.source_versions
   WHERE organization_id = org1 AND intake_source_candidate_id = candidate1;

  field1_statement := 'Source version''s committed data dictionary includes field "field_1" of committed type "number".';
  field1_locator_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|column|field_1', 'sha256'), 'hex');
  field1_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|dictionary_field_presence_fact|' || field1_statement, 'sha256'), 'hex');

  INSERT INTO kai.source_locators (source_locator_id, organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
  VALUES (field1_locator_id, org1, source_version1, 'column', jsonb_build_object('column_name', 'field_1'), field1_locator_fingerprint);

  INSERT INTO kai.evidence_items (evidence_item_id, organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
  VALUES (field1_evidence_id, org1, source1, source_version1, field1_locator_id, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'unknown', 'unassessed', field1_statement, field1_fingerprint, 'human');

  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
  VALUES (org1, 'evidence_review', 'evidence_item', field1_evidence_id, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', required_action1, '{}'::jsonb, 'system');
END $$;

COMMIT;
