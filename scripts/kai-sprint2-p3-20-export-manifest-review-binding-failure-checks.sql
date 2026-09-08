DROP TABLE IF EXISTS p3_20_failure_results;
CREATE TEMP TABLE p3_20_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate1 uuid;
  draft1 uuid;
  grant_decision uuid;
  export_review_queue_item_id uuid;
  other_queue_type_item_id uuid;
  rejected boolean;
BEGIN
  SELECT export_candidate_id, generated_content_draft_id INTO candidate1, draft1
    FROM kai.export_candidates
   WHERE organization_id = org1 AND requested_audience = 'internal'
     AND canonical_fingerprint = encode(digest('p3-19-smoke-seed-candidate', 'sha256'), 'hex');

  SELECT review_queue_item_id INTO export_review_queue_item_id
    FROM kai.review_queue_items
   WHERE organization_id = org1 AND queue_type = 'export_review'
     AND target_object_type = 'generated_content_draft' AND target_object_id = draft1;

  SELECT review_queue_item_id INTO other_queue_type_item_id
    FROM kai.review_queue_items
   WHERE organization_id = org1 AND queue_type = 'generated_content_review'
     AND target_object_type = 'generated_content_draft' AND target_object_id = draft1;

  SELECT d.decision_id INTO grant_decision
    FROM kai.human_authority_decisions d
   WHERE d.organization_id = org1 AND d.export_candidate_id = candidate1
     AND d.decision_type = 'export_authority_granted'
     AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id);

  -- 1. A NULL export_review_queue_item_id fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, export_review_queue_item_id, created_by, created_by_type)
    VALUES (org1, candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', repeat('1', 64), NULL, org1, 'human');
  EXCEPTION WHEN not_null_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_20_failure_results
  VALUES ('null_review_queue_item_id_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot be created without its originating export_review_queue_item_id');

  -- 2. A nonexistent export_review_queue_item_id fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, export_review_queue_item_id, created_by, created_by_type)
    VALUES (org1, candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', repeat('2', 64), gen_random_uuid(), org1, 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_20_failure_results
  VALUES ('nonexistent_review_queue_item_id_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot reference a nonexistent review_queue_item row');

  -- 3. A tenant-mismatched (organization_id, export_review_queue_item_id) pair fails closed
  --    even when the review item id itself is real (belongs to org1, manifest claims a
  --    different organization_id).
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, export_review_queue_item_id, created_by, created_by_type)
    VALUES ('00000000-0000-4000-8000-000000000002', candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', repeat('3', 64), export_review_queue_item_id, '00000000-0000-4000-8000-000000000002', 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_20_failure_results
  VALUES ('tenant_mismatched_review_item_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot claim an organization_id that does not match the review item''s own organization_id, even though the FK alone cannot see queue_type');

  -- 4. Documented boundary (not a schema-level rejection): the FK alone does not
  --    distinguish queue_type - a same-tenant review item of a DIFFERENT queue_type
  --    (e.g. generated_content_review) satisfies the FK. This is intentionally left to
  --    the application layer (evaluateFinalExportEligibilityInTransaction's
  --    isExportReviewQueueContractRow check, proven in the accepted
  --    FUNCTIONAL_DEPENDENCY_PROOF), never re-derived at the DB boundary - recorded
  --    here as an explicit, disclosed acceptance, not silently assumed.
  INSERT INTO p3_20_failure_results
  VALUES (
    'cross_queue_type_review_item_is_a_documented_application_layer_boundary',
    CASE WHEN other_queue_type_item_id IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'a generated_content_review-typed row for the same draft exists and would satisfy the P3-20 FK alone; queue_type/target-object correctness is enforced by the application layer, not this migration - disclosed, not silently assumed'
  );
END $$;

COMMIT;

SELECT * FROM p3_20_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_20_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-20 export-manifest-review-binding failure-checks verifier failed';
  END IF;
END $$;
