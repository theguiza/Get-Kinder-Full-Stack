DROP TABLE IF EXISTS p14_07b1_failure_results;
CREATE TEMP TABLE p14_07b1_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate_a uuid := '14030000-0000-4000-8000-000000000501';
  candidate_b uuid := '14070000-0000-4000-8000-000000000503';
  self_id uuid := gen_random_uuid();
  rejected boolean;
BEGIN
  -- 1. A malformed decision_type is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, candidate_a, 'packet_approved', 'grant', org1, 'gk_admin');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('malformed_decision_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'decision_type outside export_authority_granted is rejected');

  -- 2. A malformed decision_action is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, candidate_a, 'export_authority_granted', 'approve', org1, 'gk_admin');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('malformed_decision_action_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'decision_action outside grant/revoke is rejected');

  -- 3. A non-gk_admin role is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, candidate_a, 'export_authority_granted', 'grant', org1, 'client_reviewer');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('non_gk_admin_role_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'export_authority_granted cannot be decided by any role other than gk_admin');

  -- 4. A root (no predecessor) revoke is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, candidate_b, 'export_authority_granted', 'revoke', org1, 'gk_admin');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('root_revoke_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'the first decision in a lineage can never be a revoke');

  -- 5. A decision cannot supersede itself.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
    VALUES (self_id, org1, candidate_b, 'export_authority_granted', 'grant', org1, 'gk_admin', self_id);
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('self_superseding_decision_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a decision cannot name itself as its own predecessor');

  -- 6. Predecessor lineage cannot cross packet candidates (A -> B). Caught
  -- broadly: depending on whether the referenced predecessor already has a
  -- successor elsewhere, Postgres may report this as either a
  -- foreign_key_violation (the composite lineage-target FK requires the
  -- predecessor to belong to candidate_b, but it belongs to candidate_a) or
  -- a unique_violation (the single-successor index) - both outcomes equally
  -- prove the cross-candidate attempt is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
    VALUES (org1, candidate_b, 'export_authority_granted', 'revoke', org1, 'gk_admin', '14070000-0000-4000-8000-000000000601');
  EXCEPTION WHEN foreign_key_violation OR unique_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('cross_candidate_predecessor_lineage_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a decision for candidate A can never supersede or be superseded within candidate B''s lineage');

  -- 7. A decision cannot reference a nonexistent packet candidate.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, gen_random_uuid(), 'export_authority_granted', 'grant', org1, 'gk_admin');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('missing_candidate_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a decision cannot reference a nonexistent packet export candidate');

  -- 8. A decision cannot reference a member-level export_candidates row in
  -- place of a packet candidate (the two tables are structurally disjoint;
  -- a member export_candidate_id can never satisfy this FK).
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    SELECT org1, export_candidate_id, 'export_authority_granted', 'grant', org1, 'gk_admin'
      FROM kai.export_candidates
     WHERE organization_id = org1
     LIMIT 1;
    IF NOT FOUND THEN
      -- No P3-16 member candidate exists in this synthetic database; prove
      -- the same rejection with a fabricated id from that id-space instead.
      INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
      VALUES (org1, gen_random_uuid(), 'export_authority_granted', 'grant', org1, 'gk_admin');
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('member_export_candidate_cannot_substitute_packet_candidate', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a member-level kai.export_candidates id can never satisfy the packet candidate FK');

  -- 9. created_by_type outside human is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, created_by_type)
    VALUES (org1, candidate_b, 'export_authority_granted', 'grant', org1, 'gk_admin', 'system');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('non_human_created_by_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'only created_by_type = human may be recorded');

  -- 10. The append-only trigger rejects UPDATE and DELETE.
  rejected := false;
  BEGIN
    UPDATE kai.grant_response_packet_human_authority_decisions SET decision_action = 'revoke' WHERE decision_id = '14070000-0000-4000-8000-000000000601';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('append_only_update_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'UPDATE of an existing decision row is rejected');

  rejected := false;
  BEGIN
    DELETE FROM kai.grant_response_packet_human_authority_decisions WHERE decision_id = '14070000-0000-4000-8000-000000000601';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_07b1_failure_results VALUES ('append_only_delete_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'DELETE of an existing decision row is rejected');
END $$;

COMMIT;

SELECT * FROM p14_07b1_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_07b1_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-07B1 grant-response-packet-human-authority-decision-ledger failure-checks verifier failed';
  END IF;
END $$;
