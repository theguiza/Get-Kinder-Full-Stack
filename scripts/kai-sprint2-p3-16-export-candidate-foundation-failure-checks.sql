DROP TABLE IF EXISTS p3_16_failure_results;
CREATE TEMP TABLE p3_16_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  draft1 uuid;
  claim1 uuid;
  evidence1 uuid;
  current_snapshot uuid;
  rejected boolean;
BEGIN
  SELECT d.generated_content_draft_id INTO draft1
    FROM kai.generated_content_drafts d
    JOIN kai.generation_runs r ON r.generation_run_id = d.generation_run_id
   WHERE r.organization_id = org1 AND r.idempotency_key = 'p3-16-smoke-seed';
  SELECT claim_id INTO claim1 FROM kai.claims WHERE organization_id = org1 AND statement = 'P3-16 smoke-seed claim one.';
  SELECT evidence_item_id INTO evidence1 FROM kai.claim_evidence_links WHERE organization_id = org1 AND claim_id = claim1;
  SELECT limitation_snapshot_id INTO current_snapshot FROM kai.limitation_snapshots WHERE generated_content_draft_id = draft1 AND superseded_by_snapshot_id IS NULL;

  -- 1. A second non-superseded snapshot for the same draft is rejected by the partial unique index.
  rejected := false;
  BEGIN
    INSERT INTO kai.limitation_snapshots (organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, created_by_type)
    VALUES (org1, draft1, org1, 'gk_reviewer', repeat('f', 64), 'human');
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_16_failure_results
  VALUES ('second_current_snapshot_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'at most one non-superseded snapshot per draft is enforced');

  -- 2. A malformed limitation code is rejected by the check constraint.
  rejected := false;
  BEGIN
    INSERT INTO kai.limitation_snapshot_entries (limitation_snapshot_id, organization_id, claim_id, evidence_item_id, limitation_codes)
    VALUES (current_snapshot, org1, claim1, evidence1, ARRAY['NOT VALID']);
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_16_failure_results
  VALUES ('malformed_limitation_code_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'limitation codes outside the accepted syntax are rejected');

  -- 3. A duplicate (limitation_snapshot_id, claim_id, evidence_item_id) entry is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.limitation_snapshot_entries (limitation_snapshot_id, organization_id, claim_id, evidence_item_id, limitation_codes)
    VALUES (current_snapshot, org1, claim1, evidence1, ARRAY[]::text[]);
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_16_failure_results
  VALUES ('duplicate_cited_pair_entry_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'exactly one entry per cited pair per snapshot is enforced');

  -- 4. A cross-tenant entry (claim not owned by the stated organization) is rejected by the FK.
  rejected := false;
  BEGIN
    INSERT INTO kai.limitation_snapshot_entries (limitation_snapshot_id, organization_id, claim_id, evidence_item_id, limitation_codes)
    VALUES (current_snapshot, org2, claim1, gen_random_uuid(), ARRAY[]::text[]);
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_16_failure_results
  VALUES ('cross_tenant_entry_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a cited pair entry stated under a different organization is rejected');

  -- 5. An export candidate referencing a nonexistent limitation snapshot fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_candidates (organization_id, generated_content_draft_id, content_type, requested_audience, limitation_snapshot_id, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, draft1, 'evidence_summary', 'internal', gen_random_uuid(), 'kai-sprint2-p3-16-export-candidate-fingerprint-v1', repeat('9', 64), org1, 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_16_failure_results
  VALUES ('missing_snapshot_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'an export candidate cannot reference a nonexistent limitation snapshot');

  -- 6. An export candidate pinned to an unsupported fingerprint contract version fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_candidates (organization_id, generated_content_draft_id, content_type, requested_audience, limitation_snapshot_id, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, draft1, 'evidence_summary', 'internal', current_snapshot, 'kai-sprint2-p3-16-export-candidate-fingerprint-v2', repeat('9', 64), org1, 'human');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_16_failure_results
  VALUES ('unsupported_fingerprint_contract_version_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'export candidates are pinned to exactly one fingerprint contract version');

  -- 7. A confirmed_by_role outside gk_reviewer/gk_admin fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.limitation_snapshots (organization_id, generated_content_draft_id, confirmed_by, confirmed_by_role, entries_fingerprint, created_by_type)
    VALUES (org1, draft1, org1, 'client_admin', repeat('1', 64), 'human');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_16_failure_results
  VALUES ('non_reviewer_admin_confirmed_by_role_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'only gk_reviewer/gk_admin may be recorded as the confirming role');
END $$;

COMMIT;

SELECT * FROM p3_16_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_16_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-16 export-candidate-foundation failure-checks verifier failed';
  END IF;
END $$;
