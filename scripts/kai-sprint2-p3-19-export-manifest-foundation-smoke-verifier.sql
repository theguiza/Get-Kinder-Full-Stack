DROP TABLE IF EXISTS p3_19_smoke_results;
CREATE TEMP TABLE p3_19_smoke_results (
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
  grant_decision uuid;
  funder_ready_decision uuid;
  manifest1 uuid := gen_random_uuid();
  fingerprint1 text := encode(digest('p3-19-smoke-verifier-manifest-1', 'sha256'), 'hex');
  rejected boolean;
  manifest_count integer;
BEGIN
  SELECT export_candidate_id, generated_content_draft_id INTO candidate1, draft1
    FROM kai.export_candidates
   WHERE organization_id = org1 AND requested_audience = 'internal'
     AND canonical_fingerprint = encode(digest('p3-19-smoke-seed-candidate', 'sha256'), 'hex');

  SELECT d.decision_id INTO grant_decision
    FROM kai.human_authority_decisions d
   WHERE d.organization_id = org1 AND d.export_candidate_id = candidate1
     AND d.decision_type = 'export_authority_granted'
     AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id);

  INSERT INTO p3_19_smoke_results
  SELECT 'seeded_grant_is_current_head',
         CASE WHEN grant_decision IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         'the P3-19 smoke-seed grant decision is the current (only) head of its lineage';

  -- A manifest can bind to the exact effective grant decision.
  INSERT INTO kai.export_manifests (export_manifest_id, organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
  VALUES (manifest1, org1, candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', fingerprint1, org1, 'human');

  INSERT INTO p3_19_smoke_results
  SELECT 'manifest_bound_to_effective_grant_accepted', 'PASS',
         'a manifest referencing the exact effective export_authority_granted decision is accepted';

  -- Replay convergence: the same (organization, candidate, fingerprint) does
  -- not create a second row (this is exactly the ON CONFLICT DO NOTHING
  -- idiom the repository uses; proven here directly at the constraint
  -- level).
  INSERT INTO kai.export_manifests (export_manifest_id, organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
  VALUES (gen_random_uuid(), org1, candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', fingerprint1, org1, 'human')
  ON CONFLICT (organization_id, export_candidate_id, canonical_fingerprint) DO NOTHING;

  SELECT count(*) INTO manifest_count FROM kai.export_manifests WHERE organization_id = org1 AND export_candidate_id = candidate1 AND canonical_fingerprint = fingerprint1;
  INSERT INTO p3_19_smoke_results
  SELECT 'replay_converges_to_one_manifest_row',
         CASE WHEN manifest_count = 1 THEN 'PASS' ELSE 'FAIL' END,
         'replay of the same (organization, candidate, fingerprint) converges to exactly one manifest row';

  -- A manifest cannot bind to a decision of any type other than export_authority_granted.
  INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
  VALUES (org1, candidate1, 'client_reviewed', 'grant', org1, 'client_reviewer')
  RETURNING decision_id INTO funder_ready_decision;

  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (export_manifest_id, organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (gen_random_uuid(), org1, candidate1, funder_ready_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', encode(digest('p3-19-smoke-verifier-wrong-decision-type', 'sha256'), 'hex'), org1, 'human');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_19_smoke_results VALUES ('manifest_binding_to_non_export_authority_decision_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot bind to a client_reviewed (or any non-export_authority_granted) decision row');

  -- Cross-tenant object: a manifest cannot bind a decision/candidate pair that spans organizations.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (export_manifest_id, organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (gen_random_uuid(), other_org, candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', encode(digest('p3-19-smoke-verifier-cross-tenant', 'sha256'), 'hex'), other_org, 'human');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_19_smoke_results VALUES ('cross_tenant_manifest_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot bind a candidate/decision pair across organizations');

  -- Append-only: ordinary UPDATE/DELETE of a persisted manifest is rejected.
  DECLARE
    update_rejected boolean := false;
    delete_rejected boolean := false;
  BEGIN
    BEGIN
      UPDATE kai.export_manifests SET canonical_fingerprint = encode(digest('mutated', 'sha256'), 'hex') WHERE export_manifest_id = manifest1;
    EXCEPTION WHEN OTHERS THEN
      update_rejected := true;
    END;
    BEGIN
      DELETE FROM kai.export_manifests WHERE export_manifest_id = manifest1;
    EXCEPTION WHEN OTHERS THEN
      delete_rejected := true;
    END;
    INSERT INTO p3_19_smoke_results VALUES ('ordinary_update_of_manifest_rejected', CASE WHEN update_rejected THEN 'PASS' ELSE 'FAIL' END, 'the append-only trigger rejects an ordinary UPDATE of a persisted manifest row');
    INSERT INTO p3_19_smoke_results VALUES ('ordinary_delete_of_manifest_rejected', CASE WHEN delete_rejected THEN 'PASS' ELSE 'FAIL' END, 'the append-only trigger rejects an ordinary DELETE of a persisted manifest row');
  END;

  -- The source draft's lifecycle is untouched by any of the above.
  INSERT INTO p3_19_smoke_results
  SELECT 'source_draft_still_draft_status',
         CASE WHEN (SELECT draft_status FROM kai.generated_content_drafts WHERE generated_content_draft_id = draft1) = 'draft'
              THEN 'PASS' ELSE 'FAIL' END,
         'kai.generated_content_drafts.draft_status remains ''draft'' after manifest creation';
END $$;

SELECT * FROM p3_19_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_19_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-19 export-manifest-foundation smoke verifier failed';
  END IF;
END $$;
