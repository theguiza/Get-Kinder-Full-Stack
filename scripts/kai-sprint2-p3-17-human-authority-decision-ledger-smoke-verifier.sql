DROP TABLE IF EXISTS p3_17_smoke_results;
CREATE TEMP TABLE p3_17_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  internal_candidate uuid;
  funder_candidate uuid;
  public_candidate uuid;
  grant1 uuid := gen_random_uuid();
  revoke1 uuid := gen_random_uuid();
  regrant1 uuid := gen_random_uuid();
  rejected boolean;
  head_id uuid;
BEGIN
  SELECT export_candidate_id INTO internal_candidate FROM kai.export_candidates WHERE organization_id = org1 AND requested_audience = 'internal' AND canonical_fingerprint = encode(digest('p3-17-smoke-seed-candidate-internal', 'sha256'), 'hex');
  SELECT export_candidate_id INTO funder_candidate FROM kai.export_candidates WHERE organization_id = org1 AND requested_audience = 'funder' AND canonical_fingerprint = encode(digest('p3-17-smoke-seed-candidate-funder', 'sha256'), 'hex');
  SELECT export_candidate_id INTO public_candidate FROM kai.export_candidates WHERE organization_id = org1 AND requested_audience = 'public' AND canonical_fingerprint = encode(digest('p3-17-smoke-seed-candidate-public', 'sha256'), 'hex');

  -- Audience compatibility: funder_ready/public_ready reject a mismatched candidate, accept the matching one.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, internal_candidate, 'funder_ready', 'grant', org1, 'gk_admin');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_17_smoke_results VALUES ('funder_ready_on_internal_candidate_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'funder_ready cannot bind an internal-audience export candidate');

  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, funder_candidate, 'public_ready', 'grant', org1, 'gk_admin');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_17_smoke_results VALUES ('public_ready_on_funder_candidate_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'public_ready cannot bind a funder-audience export candidate');

  INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
  VALUES (org1, funder_candidate, 'funder_ready', 'grant', org1, 'gk_admin');
  INSERT INTO p3_17_smoke_results VALUES ('funder_ready_on_funder_candidate_accepted', 'PASS', 'funder_ready grants on a funder-audience export candidate');

  INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
  VALUES (org1, public_candidate, 'public_ready', 'grant', org1, 'gk_admin');
  INSERT INTO p3_17_smoke_results VALUES ('public_ready_on_public_candidate_accepted', 'PASS', 'public_ready grants on a public-audience export candidate');

  -- client_reviewed / export_authority_granted remain bound to the candidate's actual audience without restriction.
  INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
  VALUES (org1, internal_candidate, 'client_reviewed', 'grant', org1, 'client_reviewer');
  INSERT INTO p3_17_smoke_results VALUES ('client_reviewed_unrestricted_by_audience', 'PASS', 'client_reviewed binds any audience candidate');

  -- Decision-type/role compatibility.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, internal_candidate, 'client_reviewed', 'grant', org1, 'gk_admin');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_smoke_results VALUES ('client_reviewed_requires_client_reviewer_role', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'client_reviewed cannot be decided by gk_admin');

  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, internal_candidate, 'export_authority_granted', 'grant', org1, 'client_reviewer');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_smoke_results VALUES ('export_authority_granted_requires_gk_admin_role', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'export_authority_granted cannot be decided by client_reviewer');

  -- Exact candidate binding: a nonexistent export candidate fails closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, gen_random_uuid(), 'export_authority_granted', 'grant', org1, 'gk_admin');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p3_17_smoke_results VALUES ('nonexistent_candidate_binding_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a decision cannot reference a nonexistent export candidate');

  -- The first event in a lineage must be a grant.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, public_candidate, 'export_authority_granted', 'revoke', org1, 'gk_admin');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_smoke_results VALUES ('root_revoke_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a root (first, no-predecessor) decision must be a grant');

  -- Append-only grant -> revoke -> re-grant lineage on internal_candidate's export_authority_granted.
  INSERT INTO kai.human_authority_decisions (decision_id, organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
  VALUES (grant1, org1, internal_candidate, 'export_authority_granted', 'grant', org1, 'gk_admin');

  INSERT INTO p3_17_smoke_results
  SELECT 'fresh_grant_is_current_head',
         CASE WHEN EXISTS (
                SELECT 1 FROM kai.human_authority_decisions
                 WHERE decision_id = grant1
                   AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = grant1)
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'a freshly recorded grant (no successor yet) is the current head';

  INSERT INTO kai.human_authority_decisions (decision_id, organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
  VALUES (revoke1, org1, internal_candidate, 'export_authority_granted', 'revoke', org1, 'gk_admin', grant1);

  INSERT INTO p3_17_smoke_results
  SELECT 'revoke_is_a_successor_never_a_root',
         CASE WHEN (SELECT supersedes_decision_id FROM kai.human_authority_decisions WHERE decision_id = revoke1) = grant1
              THEN 'PASS' ELSE 'FAIL' END,
         'the revoke event carries a backward pointer at the grant it revokes; it is never an unrelated root';

  INSERT INTO p3_17_smoke_results
  SELECT 'prior_grant_unchanged_after_revoke',
         CASE WHEN EXISTS (
                SELECT 1 FROM kai.human_authority_decisions
                 WHERE decision_id = grant1 AND decision_action = 'grant' AND decided_by_role = 'gk_admin' AND supersedes_decision_id IS NULL
              )
              THEN 'PASS' ELSE 'FAIL' END,
         'the prior grant row is never rewritten by the revoke';

  DECLARE
    update_rejected boolean := false;
    delete_rejected boolean := false;
  BEGIN
    BEGIN
      UPDATE kai.human_authority_decisions SET decision_action = 'grant' WHERE decision_id = grant1;
    EXCEPTION WHEN OTHERS THEN
      update_rejected := true;
    END;
    BEGIN
      DELETE FROM kai.human_authority_decisions WHERE decision_id = grant1;
    EXCEPTION WHEN OTHERS THEN
      delete_rejected := true;
    END;
    INSERT INTO p3_17_smoke_results VALUES ('ordinary_update_of_grant_rejected', CASE WHEN update_rejected THEN 'PASS' ELSE 'FAIL' END, 'the append-only trigger rejects an ordinary UPDATE of a persisted decision row');
    INSERT INTO p3_17_smoke_results VALUES ('ordinary_delete_of_grant_rejected', CASE WHEN delete_rejected THEN 'PASS' ELSE 'FAIL' END, 'the append-only trigger rejects an ordinary DELETE of a persisted decision row');
  END;

  -- Re-grant after revoke is another successor event, and becomes the new current head.
  INSERT INTO kai.human_authority_decisions (decision_id, organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
  VALUES (regrant1, org1, internal_candidate, 'export_authority_granted', 'grant', org1, 'gk_admin', revoke1);

  SELECT d.decision_id INTO head_id
    FROM kai.human_authority_decisions d
   WHERE d.export_candidate_id = internal_candidate AND d.decision_type = 'export_authority_granted'
     AND NOT EXISTS (SELECT 1 FROM kai.human_authority_decisions s WHERE s.supersedes_decision_id = d.decision_id);

  INSERT INTO p3_17_smoke_results
  SELECT 're_grant_after_revoke_is_current_head',
         CASE WHEN head_id = regrant1 THEN 'PASS' ELSE 'FAIL' END,
         'a re-grant after revoke is another successor event and becomes the current head';

  -- No lineage forks: a second root for the same (org, candidate, type) is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role)
    VALUES (org1, funder_candidate, 'funder_ready', 'grant', org1, 'gk_admin');
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_smoke_results VALUES ('second_root_for_same_lineage_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'at most one root decision per (organization, export_candidate_id, decision_type)');

  -- No lineage forks: a second successor of the same predecessor is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
    VALUES (org1, internal_candidate, 'export_authority_granted', 'revoke', org1, 'gk_admin', regrant1);
    INSERT INTO kai.human_authority_decisions (organization_id, export_candidate_id, decision_type, decision_action, decided_by, decided_by_role, supersedes_decision_id)
    VALUES (org1, internal_candidate, 'export_authority_granted', 'revoke', org1, 'gk_admin', regrant1);
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO p3_17_smoke_results VALUES ('second_successor_of_same_predecessor_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'at most one direct successor may exist per predecessor decision');
END $$;

SELECT * FROM p3_17_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p3_17_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P3-17 human-authority-decision-ledger smoke verifier failed';
  END IF;
END $$;
