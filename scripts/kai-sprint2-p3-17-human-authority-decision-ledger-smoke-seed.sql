BEGIN;

-- P3-17 smoke seed: creates three real, tenant-scoped, fully-eligible
-- (resolved/resolved on both queues) generated-content drafts for org1 - one
-- per requested audience (internal, funder, public) - each with one claim
-- against its own committed evidence item, one confirmed (root) limitation
-- snapshot, and one export candidate bound to that snapshot, using the exact
-- same mechanism P3-16's own smoke-verifier already exercises directly in
-- SQL. No kai.human_authority_decisions row is seeded here; those are
-- exercised fresh by the P3-17 smoke verifier itself.

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  template_evidence uuid;
  audiences text[] := ARRAY['internal', 'funder', 'public'];
  audience text;
  idx int := 0;
  evidence1 uuid;
  claim1 uuid;
  run1 uuid;
  draft1 uuid;
  block1 uuid;
  snapshot1 uuid;
  candidate1 uuid;
BEGIN
  SELECT evidence_item_id INTO template_evidence
    FROM kai.evidence_items WHERE organization_id = org1 LIMIT 1;

  FOREACH audience IN ARRAY audiences LOOP
    idx := idx + 1;
    evidence1 := gen_random_uuid();
    claim1 := gen_random_uuid();
    run1 := gen_random_uuid();
    draft1 := gen_random_uuid();
    block1 := gen_random_uuid();
    snapshot1 := gen_random_uuid();
    candidate1 := gen_random_uuid();

    INSERT INTO kai.evidence_items (evidence_item_id, organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
    SELECT evidence1, organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength,
           'P3-17 smoke-seed evidence item for audience ' || audience || '.', encode(digest('p3-17-smoke-seed-' || audience, 'sha256'), 'hex'), created_by_type
      FROM kai.evidence_items WHERE evidence_item_id = template_evidence;

    INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
    VALUES (claim1, org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', 'P3-17 smoke-seed claim for audience ' || audience || '.', encode(digest('p3-17-smoke-seed-claim-' || audience, 'sha256'), 'hex'), 'system');

    INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
    VALUES (org1, claim1, evidence1, 'system');

    INSERT INTO kai.generation_runs (generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type)
    VALUES (run1, org1, 'p3-17-smoke-seed-' || audience, encode(digest('p3-17-smoke-seed-run-' || audience, 'sha256'), 'hex'), 'evidence_summary', audience, 'system');

    INSERT INTO kai.generated_content_drafts (generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type)
    VALUES (draft1, run1, org1, 'evidence_summary', audience, 'draft', 'needs_gk_review', '[]'::jsonb, 'system');

    INSERT INTO kai.generated_content_blocks (generated_content_block_id, generated_content_draft_id, organization_id, ordinal, text)
    VALUES (block1, draft1, org1, 1, 'P3-17 smoke-seed generated block for audience ' || audience || '.');

    INSERT INTO kai.generated_content_citations (generated_content_block_id, organization_id, claim_id, evidence_item_id)
    VALUES (block1, org1, claim1, evidence1);

    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
    VALUES (org1, 'generated_content_review', 'generated_content_draft', draft1, 'normal', 'resolved', 'resolved', 'Generated draft requires human review.', 'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.', '{}'::jsonb, 'system');

    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
    VALUES (org1, 'export_review', 'generated_content_draft', draft1, 'normal', 'resolved', 'resolved', 'Generated draft requires export review.', 'Review audience authority, current eligibility, citations, and the final export gate before any export.', '{}'::jsonb, 'system');

    INSERT INTO kai.limitation_snapshots (limitation_snapshot_id, organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, created_by_type)
    VALUES (snapshot1, org1, draft1, org1, 'gk_reviewer', encode(digest('p3-17-smoke-seed-snapshot-' || audience, 'sha256'), 'hex'), 'human');

    INSERT INTO kai.limitation_snapshot_entries (limitation_snapshot_id, organization_id, claim_id, evidence_item_id, limitation_codes)
    VALUES (snapshot1, org1, claim1, evidence1, ARRAY[]::text[]);

    INSERT INTO kai.export_candidates (export_candidate_id, organization_id, generated_content_draft_id, content_type, requested_audience, limitation_snapshot_id, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (candidate1, org1, draft1, 'evidence_summary', audience, snapshot1, 'kai-sprint2-p3-16-export-candidate-fingerprint-v1', encode(digest('p3-17-smoke-seed-candidate-' || audience, 'sha256'), 'hex'), org1, 'human');
  END LOOP;
END $$;

COMMIT;
