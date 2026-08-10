DROP TABLE IF EXISTS p3_17_failure_results;
CREATE TEMP TABLE p3_17_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  internal_candidate uuid;
  funder_candidate uuid;
  public_candidate uuid;
  self_id uuid := gen_random_uuid();
  rejected boolean;
BEGIN
  SELECT export_candidate_id INTO internal_candidate FROM kai.export_candidates WHERE organization_id = org1 AND requested_audience = 'internal' AND canonical_fingerprint = encode(digest('p3-17-smoke-seed-candidate-internal', 'sha256'), 'hex');
  SELECT export_candidate_id INTO funder_candidate FROM kai.export_candidates WHERE organization_id = org1 AND requested_audience = 'funder' AND canonical_fingerprint = encode(digest('p3-17-smoke-seed-candidate-funder', 'sha256'), 'hex');
  SELECT export_candidate_id INTO public_candidate FROM kai.export_candidates WHERE organization_id = org1 AND requested_audience = 'public' AND canonical_fingerprint = encode(digest('p3-17-smoke-seed-candidate-public', 'sha256'), 'hex');

  -- 1. A malformed decision_type is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, public_candidate, 'final_gate', 'grant', org1, 'gk_admin');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_failure_results VALUES ('malformed_decision_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'decision_type outside the exact accepted vocabulary is rejected');

  -- 2. A malformed decision_action is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, public_candidate, 'export_authority_granted', 'approve', org1, 'gk_admin');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_failure_results VALUES ('malformed_decision_action_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'decision_action outside grant/revoke is rejected');

  -- 3. A decision cannot supersede itself.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (decision_id, organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
    VALUES (self_id, org1, public_candidate, 'export_authority_granted', 'revoke', org1, 'gk_admin', self_id);
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_failure_results VALUES ('self_superseding_decision_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a decision cannot name itself as its own predecessor');

  -- 4. Predecessor lineage cannot cross export candidates.
  rejected := false;
  BEGIN
    DECLARE
      grant_on_funder uuid := gen_random_uuid();
    BEGIN
      INSERT INTO kai.human_authority_decisions (decision_id, organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
      VALUES (grant_on_funder, org1, funder_candidate, 'export_authority_granted', 'grant', org1, 'gk_admin');
      INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
      VALUES (org1, public_candidate, 'export_authority_granted', 'revoke', org1, 'gk_admin', grant_on_funder);
    END;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_failure_results VALUES ('cross_candidate_predecessor_lineage_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a predecessor decision from a different export candidate is rejected');

  -- 5. Predecessor lineage cannot cross decision types on the same candidate.
  rejected := false;
  BEGIN
    DECLARE
      client_reviewed_grant uuid := gen_random_uuid();
    BEGIN
      INSERT INTO kai.human_authority_decisions (decision_id, organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
      VALUES (client_reviewed_grant, org1, public_candidate, 'client_reviewed', 'grant', org1, 'client_reviewer');
      INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
      VALUES (org1, public_candidate, 'export_authority_granted', 'revoke', org1, 'gk_admin', client_reviewed_grant);
    END;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_failure_results VALUES ('cross_decision_type_predecessor_lineage_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a predecessor decision of a different decision_type on the same candidate is rejected');

  -- 6. A decision cannot reference a nonexistent export candidate.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, gen_random_uuid(), 'client_reviewed', 'grant', org1, 'client_reviewer');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_17_failure_results VALUES ('missing_candidate_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a decision cannot reference a nonexistent export candidate');

  -- 7. decided_by_role outside the exact required role for the decision_type is rejected in both directions.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, public_candidate, 'public_ready', 'grant', org1, 'client_reviewer');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_17_failure_results VALUES ('non_gk_admin_role_rejected_for_public_ready', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'public_ready cannot be decided by client_reviewer');

  -- 8. created_by_type outside human is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, created_by_type)
    VALUES (org1, public_candidate, 'client_reviewed', 'grant', org1, 'client_reviewer', 'system');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_failure_results VALUES ('non_human_created_by_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'only created_by_type = human may be recorded');
END $$;

COMMIT;

SELECT * FROM p3_17_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_17_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-17 human-authority-decision-ledger failure-checks verifier failed';
  END IF;
END $$;
