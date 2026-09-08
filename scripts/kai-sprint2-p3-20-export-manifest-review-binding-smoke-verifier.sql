DROP TABLE IF EXISTS p3_20_smoke_results;
CREATE TEMP TABLE p3_20_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  other_org uuid := '00000000-0000-4000-8000-000000000002';
  candidate1 uuid;
  draft1 uuid;
  legacy_manifest1 uuid;
  expected_review_queue_item_id uuid;
  head_grant uuid;
  manifest2 uuid := gen_random_uuid();
  fingerprint2 text := encode(digest('p3-20-smoke-verifier-manifest-2', 'sha256'), 'hex');
  rejected boolean;
  bound_count integer;
BEGIN
  SELECT export_candidate_id, generated_content_draft_id INTO candidate1, draft1
    FROM kai.export_candidates
   WHERE organization_id = org1 AND requested_audience = 'internal'
     AND canonical_fingerprint = encode(digest('p3-19-smoke-seed-candidate', 'sha256'), 'hex');

  SELECT review_queue_item_id INTO expected_review_queue_item_id
    FROM kai.review_queue_items
   WHERE organization_id = org1 AND queue_type = 'export_review'
     AND target_object_type = 'generated_content_draft' AND target_object_id = draft1;

  -- The genuine pre-P3-20 row: kai-sprint2-p3-19-export-manifest-foundation-
  -- smoke-verifier.sql's own manifest1, inserted (in the runner's own
  -- migration order) before this migration existed.
  SELECT export_manifest_id INTO legacy_manifest1
    FROM kai.export_manifests
   WHERE organization_id = org1 AND export_candidate_id = candidate1
     AND canonical_fingerprint = encode(digest('p3-19-smoke-verifier-manifest-1', 'sha256'), 'hex');

  INSERT INTO p3_20_smoke_results
  SELECT 'legacy_manifest_backfilled_to_exact_review_item',
         CASE WHEN legacy_manifest1 IS NOT NULL
                AND expected_review_queue_item_id IS NOT NULL
                AND (SELECT export_review_queue_item_id FROM kai.export_manifests WHERE export_manifest_id = legacy_manifest1) = expected_review_queue_item_id
              THEN 'PASS' ELSE 'FAIL' END,
         'the P3-19 smoke-verifier''s own pre-existing manifest row (created before this migration existed) was deterministically backfilled to the exact, unique export_review queue item for its candidate''s draft';

  SELECT d.decision_id INTO head_grant
    FROM kai.human_authority_decisions d
   WHERE d.organization_id = org1 AND d.export_candidate_id = candidate1
     AND d.decision_type = 'export_authority_granted'
     AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id);

  INSERT INTO p3_20_smoke_results
  SELECT 'seeded_re_grant_is_current_head',
         CASE WHEN head_grant IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'the P3-20 smoke-seed''s revoke-then-re-grant cycle leaves exactly one current head decision';

  -- A second manifest, bound to the second effective decision, carries the
  -- exact SAME export_review_queue_item_id as the first (legacy) manifest -
  -- proving one review item legitimately backs multiple historical
  -- manifests.
  INSERT INTO kai.export_manifests (export_manifest_id, organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, export_review_queue_item_id, created_by, created_by_type)
  VALUES (manifest2, org1, candidate1, head_grant, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', fingerprint2, expected_review_queue_item_id, org1, 'human');

  INSERT INTO p3_20_smoke_results
  SELECT 'second_manifest_bound_to_same_review_item_accepted', 'PASS',
         'a second manifest (distinct effective decision, distinct fingerprint) is accepted with the exact same export_review_queue_item_id as the first';

  SELECT count(*) INTO bound_count
    FROM kai.export_manifests
   WHERE organization_id = org1 AND export_review_queue_item_id = expected_review_queue_item_id;
  INSERT INTO p3_20_smoke_results
  SELECT 'one_review_item_backs_multiple_historical_manifests',
         CASE WHEN bound_count >= 2 THEN 'PASS' ELSE 'FAIL' END,
         'the same export_review_queue_item_id now legitimately backs multiple distinct manifest rows - no UNIQUE(export_review_queue_item_id) was violated';

  -- A manifest cannot reference a review item belonging to a different organization.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (export_manifest_id, organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, export_review_queue_item_id, created_by, created_by_type)
    VALUES (gen_random_uuid(), other_org, candidate1, head_grant, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', encode(digest('p3-20-smoke-verifier-cross-tenant-review-item', 'sha256'), 'hex'), expected_review_queue_item_id, other_org, 'human');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_20_smoke_results VALUES ('cross_tenant_review_item_binding_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot bind a review-item/candidate pair across organizations');

  -- A manifest cannot reference a nonexistent review item.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (export_manifest_id, organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, export_review_queue_item_id, created_by, created_by_type)
    VALUES (gen_random_uuid(), org1, candidate1, head_grant, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', encode(digest('p3-20-smoke-verifier-missing-review-item', 'sha256'), 'hex'), gen_random_uuid(), org1, 'human');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_20_smoke_results VALUES ('missing_review_item_binding_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot bind a nonexistent review_queue_item_id');

  -- Append-only is unaffected: an ordinary UPDATE of the new column is still rejected.
  DECLARE
    update_rejected boolean := false;
  BEGIN
    BEGIN
      UPDATE kai.export_manifests SET export_review_queue_item_id = gen_random_uuid() WHERE export_manifest_id = manifest2;
    EXCEPTION WHEN OTHERS THEN
      update_rejected := true;
    END;
    INSERT INTO p3_20_smoke_results VALUES ('ordinary_update_of_review_binding_rejected', CASE WHEN update_rejected THEN 'PASS' ELSE 'FAIL' END, 'the P3-19 append-only trigger rejects an ordinary UPDATE of export_review_queue_item_id exactly as it rejects any other column');
  END;
END $$;

SELECT * FROM p3_20_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_20_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-20 export-manifest-review-binding smoke verifier failed';
  END IF;
END $$;
