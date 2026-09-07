BEGIN;

-- P3-19 smoke seed: creates one real, tenant-scoped, fully-eligible
-- (resolved/resolved on both queues, current-use eligible) generated-content
-- draft for org1, requested audience 'internal', with one claim against its
-- own committed evidence item, one confirmed (root) limitation snapshot, one
-- export candidate bound to that snapshot (same mechanism P3-16/P3-17's own
-- smoke-seeds already exercise directly in SQL), and one root
-- export_authority_granted grant decision - a fresh, self-contained lineage
-- scoped only to this candidate, so this package does not depend on the
-- transient lineage state P3-17's own smoke-verifier leaves behind on its
-- candidates. This gives the P3-19 Node integration suite one real,
-- currently-effective authority decision to drive the shared P3-18/
-- VAL-EXP-001 composition through a genuine PASS, end to end.

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  template_evidence uuid;
  evidence1 uuid := gen_random_uuid();
  claim1 uuid := gen_random_uuid();
  run1 uuid := gen_random_uuid();
  draft1 uuid := gen_random_uuid();
  block1 uuid := gen_random_uuid();
  snapshot1 uuid := gen_random_uuid();
  candidate1 uuid := gen_random_uuid();
BEGIN
  SELECT evidence_item_id INTO template_evidence
    FROM kai.evidence_items WHERE organization_id = org1 LIMIT 1;

  INSERT INTO kai.evidence_items (evidence_item_id, organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength, statement, statement_fingerprint, created_by_type)
  SELECT evidence1, organization_id, source_id, source_version_id, source_locator_id, evidence_type, data_class, sensitivity_level, support_strength,
         'P3-19 smoke-seed evidence item.', encode(digest('p3-19-smoke-seed-evidence', 'sha256'), 'hex'), created_by_type
    FROM kai.evidence_items WHERE evidence_item_id = template_evidence;

  INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
  VALUES (claim1, org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', 'P3-19 smoke-seed claim.', encode(digest('p3-19-smoke-seed-claim', 'sha256'), 'hex'), 'system');

  INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
  VALUES (org1, claim1, evidence1, 'system');

  INSERT INTO kai.generation_runs (generation_run_id, organization_id, idempotency_key, request_fingerprint, content_type, requested_audience, created_by_type)
  VALUES (run1, org1, 'p3-19-smoke-seed', encode(digest('p3-19-smoke-seed-run', 'sha256'), 'hex'), 'evidence_summary', 'internal', 'system');

  INSERT INTO kai.generated_content_drafts (generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, draft_status, review_status, validator_results, created_by_type)
  VALUES (draft1, run1, org1, 'evidence_summary', 'internal', 'draft', 'needs_gk_review', '[]'::jsonb, 'system');

  INSERT INTO kai.generated_content_blocks (generated_content_block_id, generated_content_draft_id, organization_id, ordinal, text)
  VALUES (block1, draft1, org1, 1, 'P3-19 smoke-seed generated block.');

  INSERT INTO kai.generated_content_citations (generated_content_block_id, organization_id, claim_id, evidence_item_id)
  VALUES (block1, org1, claim1, evidence1);

  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
  VALUES (org1, 'generated_content_review', 'generated_content_draft', draft1, 'medium', 'resolved', 'resolved', 'Generated draft requires human review.', 'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.', '{}'::jsonb, 'system');

  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
  VALUES (org1, 'export_review', 'generated_content_draft', draft1, 'medium', 'resolved', 'resolved', 'Generated draft requires export review.', 'Review audience authority, current eligibility, citations, and the final export gate before any export.', '{}'::jsonb, 'system');

  INSERT INTO kai.limitation_snapshots (limitation_snapshot_id, organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, created_by_type)
  VALUES (snapshot1, org1, draft1, org1, 'gk_reviewer', encode(digest('p3-19-smoke-seed-snapshot', 'sha256'), 'hex'), 'human');

  INSERT INTO kai.limitation_snapshot_entries (limitation_snapshot_id, organization_id, claim_id, evidence_item_id, limitation_codes)
  VALUES (snapshot1, org1, claim1, evidence1, ARRAY[]::text[]);

  INSERT INTO kai.export_candidates (export_candidate_id, organization_id, generated_content_draft_id, content_type, requested_audience, limitation_snapshot_id, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
  VALUES (candidate1, org1, draft1, 'evidence_summary', 'internal', snapshot1, 'kai-sprint2-p3-16-export-candidate-fingerprint-v1', encode(digest('p3-19-smoke-seed-candidate', 'sha256'), 'hex'), org1, 'human');

  -- Fresh, self-contained root grant - the only decision in this lineage, so
  -- it is unambiguously the current head (effective).
  INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
  VALUES (org1, candidate1, 'export_authority_granted', 'grant', org1, 'gk_admin');
END $$;

COMMIT;
