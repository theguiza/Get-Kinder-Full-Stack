DROP TABLE IF EXISTS brcem_failure_results;
CREATE TEMP TABLE brcem_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate_a uuid := '15030000-0000-4000-8000-000000000323';
  candidate_b uuid := '15030000-0000-4000-8000-000000000322';
  decision_a uuid := '15070000-0000-4000-8000-000000000601';
  actor uuid := '00000000-0000-4000-8000-000000000901';
  rejected boolean;
BEGIN
  -- 1. A malformed fingerprint_contract_version is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate_a, decision_a, 'export_authority_granted', 'not-the-pinned-contract-version', repeat('1', 64), actor, 'human');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('malformed_fingerprint_contract_version_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'fingerprint_contract_version outside the pinned literal is rejected');

  -- 2. A malformed canonical_fingerprint shape is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate_a, decision_a, 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', 'not-64-hex-chars', actor, 'human');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('malformed_canonical_fingerprint_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'canonical_fingerprint outside lowercase 64-hex-char shape is rejected');

  -- 3. A malformed effective_authority_decision_type is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate_a, decision_a, 'board_release_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('2', 64), actor, 'human');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('malformed_decision_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'effective_authority_decision_type outside export_authority_granted is rejected');

  -- 4. A non-human created_by_type is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate_a, decision_a, 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('3', 64), actor, 'system');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('non_human_created_by_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'only created_by_type = human may be recorded');

  -- 5. A manifest cannot reference a nonexistent Board Reporting candidate.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, gen_random_uuid(), decision_a, 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('4', 64), actor, 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('missing_candidate_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot reference a nonexistent Board Reporting candidate');

  -- 6. A manifest cannot reference a nonexistent authority decision.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate_a, gen_random_uuid(), 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('5', 64), actor, 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('missing_authority_decision_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot reference a nonexistent authority decision');

  -- 7. Candidate A's decision cannot be bound to candidate B's manifest -
  -- cross-candidate substitution is rejected because the composite FK pins
  -- (decision_id, organization_id, board_reporting_candidate_id, decision_type)
  -- together; decision_a belongs to candidate_a, not candidate_b.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate_b, decision_a, 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('6', 64), actor, 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('cross_candidate_authority_decision_substitution_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a decision effective for candidate A can never be bound as the effective decision for candidate B''s manifest');

  -- 8. A manifest cannot reference a member-level kai.export_candidates id or
  -- packet-level kai.grant_response_packet_export_candidates id in place of a
  -- Board candidate (the tables are structurally disjoint; neither id can
  -- ever satisfy this FK).
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    SELECT org1, export_candidate_id, decision_a, 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('7', 64), actor, 'human'
      FROM kai.export_candidates
     WHERE organization_id = org1
     LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
      VALUES (org1, gen_random_uuid(), decision_a, 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('7', 64), actor, 'human');
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('member_export_candidate_cannot_substitute_board_candidate', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a member-level kai.export_candidates id can never satisfy the Board candidate FK');

  -- 9. Conflicting replay identity: the exact same (organization, candidate,
  -- canonical_fingerprint) as the smoke-seeded manifest, but under a
  -- different manifest id and a different bound decision, is rejected as a
  -- unique_violation rather than silently minting a second row for the same
  -- effective-authority state.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (board_reporting_candidate_export_manifest_id, organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (gen_random_uuid(), org1, candidate_a, decision_a, 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('e', 64), actor, 'human');
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('conflicting_replay_identity_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a second manifest row for the same organization/candidate/canonical_fingerprint is rejected, not silently duplicated');

  -- 10. Wrong tenant: candidate_a exists only under org1, so pairing it with
  -- a different organization_id can never satisfy the tenant-safe composite
  -- candidate FK, regardless of whether that other organization row exists.
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_export_manifests (organization_id, board_reporting_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES ('00000000-0000-4000-8000-000000000002', candidate_a, decision_a, 'export_authority_granted', 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1', repeat('8', 64), actor, 'human');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('wrong_tenant_candidate_binding_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'candidate A can never be bound to a manifest under a different organization_id');

  -- 11. The append-only trigger rejects UPDATE and DELETE.
  rejected := false;
  BEGIN
    UPDATE kai.board_reporting_candidate_export_manifests SET canonical_fingerprint = repeat('9', 64) WHERE board_reporting_candidate_export_manifest_id = '15090000-0000-4000-8000-000000000701';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('append_only_update_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'UPDATE of an existing manifest row is rejected');

  rejected := false;
  BEGIN
    DELETE FROM kai.board_reporting_candidate_export_manifests WHERE board_reporting_candidate_export_manifest_id = '15090000-0000-4000-8000-000000000701';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO brcem_failure_results VALUES ('append_only_delete_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'DELETE of an existing manifest row is rejected');
END $$;

COMMIT;

SELECT * FROM brcem_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM brcem_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'board-reporting-candidate-export-manifest-foundation failure-checks verifier failed';
  END IF;
END $$;
