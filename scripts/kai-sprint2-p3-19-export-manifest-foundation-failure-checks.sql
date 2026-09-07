DROP TABLE IF EXISTS p3_19_failure_results;
CREATE TEMP TABLE p3_19_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate1 uuid;
  grant_decision uuid;
  rejected boolean;
BEGIN
  SELECT export_candidate_id INTO candidate1
    FROM kai.export_candidates
   WHERE organization_id = org1 AND requested_audience = 'internal'
     AND canonical_fingerprint = encode(digest('p3-19-smoke-seed-candidate', 'sha256'), 'hex');

  SELECT d.decision_id INTO grant_decision
    FROM kai.human_authority_decisions d
   WHERE d.organization_id = org1 AND d.export_candidate_id = candidate1
     AND d.decision_type = 'export_authority_granted'
     AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id);

  -- 1. A nonexistent effective_authority_decision_id fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate1, gen_random_uuid(), 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', repeat('9', 64), org1, 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_19_failure_results
  VALUES ('missing_decision_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot reference a nonexistent human-authority-decision row');

  -- 2. A nonexistent export_candidate_id fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, gen_random_uuid(), grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', repeat('8', 64), org1, 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_19_failure_results
  VALUES ('missing_candidate_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot reference a nonexistent export candidate');

  -- 3. An unsupported fingerprint contract version fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v2', repeat('7', 64), org1, 'human');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_19_failure_results
  VALUES ('unsupported_fingerprint_contract_version_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'export manifests are pinned to exactly one fingerprint contract version');

  -- 4. A malformed (non-hex, wrong-length) canonical_fingerprint fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', 'NOT-A-VALID-FINGERPRINT', org1, 'human');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_19_failure_results
  VALUES ('malformed_canonical_fingerprint_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'canonical_fingerprint outside the accepted lowercase-64-hex syntax is rejected');

  -- 5. A non-human created_by_type fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate1, grant_decision, 'export_authority_granted', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', repeat('6', 64), org1, 'system');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_19_failure_results
  VALUES ('non_human_created_by_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'only created_by_type=human is accepted');

  -- 6. An effective_authority_decision_type outside export_authority_granted fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.export_manifests (organization_id, export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate1, grant_decision, 'client_reviewed', 'kai-sprint2-p3-19-export-manifest-fingerprint-v1', repeat('5', 64), org1, 'human');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_19_failure_results
  VALUES ('non_export_authority_granted_decision_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'effective_authority_decision_type outside export_authority_granted is rejected');
END $$;

COMMIT;

SELECT * FROM p3_19_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_19_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-19 export-manifest-foundation failure-checks verifier failed';
  END IF;
END $$;
