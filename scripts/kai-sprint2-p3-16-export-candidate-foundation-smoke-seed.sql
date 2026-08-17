BEGIN;

-- P3-16 owner decision: the chained Gate A/P1-04 through P2-03 smoke seeds
-- (which run ahead of this seed in this package's own local-postgres runner)
-- already commit exactly one real, tenant-scoped evidence item for org1
-- (field1_evidence_id, bound to candidate1's promoted source/source_version),
-- because kai_sprint2_p2_03_claim_proposal-smoke-seed.sql itself creates that
-- committed 'dictionary_field_presence_fact' evidence item. Because
-- kai.claims enforces at most one 'finding' claim per (organization,
-- evidence_item), this seed creates one additional real, committed evidence
-- item against the same already-promoted source_version, then proposes
-- exactly one real, committed claim against each of the two evidence items,
-- builds one real generated-content draft with one block citing both claims
-- against their own evidence item, and
-- resolves both the generated-content-review and export-review queue items
-- for that draft - so the P3-16 smoke verifier has a real, tenant-scoped,
-- fully-eligible draft to confirm a limitation snapshot and create an export
-- candidate against. No limitation_snapshot, limitation_snapshot_entry, or
-- export_candidate row is seeded here; those are exercised fresh by the P3-16
-- smoke verifier itself.

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  source1 uuid;
  source_version1 uuid;
  evidence1 uuid;
  evidence2 uuid := gen_random_uuid();
  locator2 uuid := gen_random_uuid();
  locator2_fingerprint text;
  evidence2_statement text := 'P3-16 smoke-seed source version''s committed data dictionary includes field "field_2" of committed type "number".';
  evidence2_fingerprint text;
  claim1 uuid := gen_random_uuid();
  claim2 uuid := gen_random_uuid();
  run1 uuid := gen_random_uuid();
  draft1 uuid := gen_random_uuid();
  block1 uuid := gen_random_uuid();
BEGIN
  SELECT evidence_item_id, source_id, source_version_id INTO evidence1, source1, source_version1
    FROM kai.evidence_items
   WHERE organization_id = org1 AND evidence_type = 'dictionary_field_presence_fact';

  locator2_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|column|field_2', 'sha256'), 'hex');
  evidence2_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|dictionary_field_presence_fact|' || evidence2_statement, 'sha256'), 'hex');

  INSERT INTO kai.source_locators (source_locator_id, organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
  VALUES (locator2, org1, source_version1, 'column', jsonb_build_object('column_name', 'field_2'), locator2_fingerprint);

  INSERT INTO kai.evidence_items (evidence_item_id, organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
  VALUES (evidence2, org1, source1, source_version1, locator2, 'dictionary_field_presence_fact', 'organization_committed_metadata', 'unknown', 'unassessed', evidence2_statement, evidence2_fingerprint, 'human');

  INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
  VALUES
    (claim1, org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', 'P3-16 smoke-seed claim one.', repeat('a', 64), 'system'),
    (claim2, org1, evidence2, 'finding', 'proposed', 'needs_gk_review', 'unassessed', 'P3-16 smoke-seed claim two.', repeat('b', 64), 'system');

  INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
  VALUES (org1, claim1, evidence1, 'system'), (org1, claim2, evidence2, 'system');

  INSERT INTO kai.generation_runs (generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type)
  VALUES (run1, org1, 'p3-16-smoke-seed', repeat('c', 64), 'evidence_summary', 'internal', 'system');

  INSERT INTO kai.generated_content_drafts (generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type)
  VALUES (draft1, run1, org1, 'evidence_summary', 'internal', 'draft', 'needs_gk_review', '[]'::jsonb, 'system');

  INSERT INTO kai.generated_content_blocks (generated_content_block_id, generated_content_draft_id, organization_id, ordinal, text)
  VALUES (block1, draft1, org1, 1, 'P3-16 smoke-seed generated block citing two claims, each against its own evidence item.');

  INSERT INTO kai.generated_content_citations (generated_content_block_id, organization_id, claim_id, evidence_item_id)
  VALUES (block1, org1, claim1, evidence1), (block1, org1, claim2, evidence2);

  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
  VALUES (org1, 'generated_content_review', 'generated_content_draft', draft1, 'medium', 'resolved', 'resolved', 'Generated draft requires human review.', 'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.', '{}'::jsonb, 'system');

  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
  VALUES (org1, 'export_review', 'generated_content_draft', draft1, 'medium', 'resolved', 'resolved', 'Generated draft requires export review.', 'Review audience authority, current eligibility, citations, and the final export gate before any export.', '{}'::jsonb, 'system');
END $$;

COMMIT;
