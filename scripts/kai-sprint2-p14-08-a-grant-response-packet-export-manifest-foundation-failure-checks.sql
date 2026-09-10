DROP TABLE IF EXISTS p14_08a_failure_results;
CREATE TEMP TABLE p14_08a_failure_results (
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
  decision_a uuid := '14070000-0000-4000-8000-000000000601';
  rejected boolean;
BEGIN
  -- 1. A malformed effective_authority_decision_type is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    VALUES (org1, candidate_a, decision_a, 'packet_approved', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('1', 64), org1);
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('malformed_decision_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'effective_authority_decision_type outside export_authority_granted is rejected');

  -- 2. A malformed fingerprint_contract_version is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    VALUES (org1, candidate_a, decision_a, 'export_authority_granted', 'wrong-version', repeat('2', 64), org1);
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('malformed_fingerprint_contract_version_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'fingerprint_contract_version outside the exact P14-08A version string is rejected');

  -- 3. A malformed canonical_fingerprint (not 64 hex chars) is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    VALUES (org1, candidate_a, decision_a, 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', 'not-a-fingerprint', org1);
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('malformed_canonical_fingerprint_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'canonical_fingerprint must be a 64-hex-char sha256 digest');

  -- 4. created_by_type outside human is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by, created_by_type)
    VALUES (org1, candidate_a, decision_a, 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('3', 64), org1, 'system');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('non_human_created_by_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'only created_by_type = human may be recorded');

  -- 5. A manifest cannot reference a nonexistent packet candidate.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    VALUES (org1, gen_random_uuid(), decision_a, 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('4', 64), org1);
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('missing_candidate_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot reference a nonexistent packet export candidate');

  -- 6. A manifest cannot reference a member-level kai.export_candidates row
  -- in place of a packet candidate (the two tables are structurally
  -- disjoint; a member export_candidate_id can never satisfy this FK).
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    SELECT org1, export_candidate_id, decision_a, 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('5', 64), org1
      FROM kai.export_candidates
     WHERE organization_id = org1
     LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
      VALUES (org1, gen_random_uuid(), decision_a, 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('5', 64), org1);
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('member_export_candidate_cannot_substitute_packet_candidate', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a member-level kai.export_candidates id can never satisfy the packet candidate FK');

  -- 7. A manifest cannot reference a nonexistent authority decision.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    VALUES (org1, candidate_a, gen_random_uuid(), 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('6', 64), org1);
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('missing_authority_decision_reference_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a manifest cannot reference a nonexistent effective authority decision');

  -- 8. A manifest cannot reference a member-level kai.human_authority_decisions
  -- row in place of a packet authority decision.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    SELECT org1, candidate_a, decision_id, 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('7', 64), org1
      FROM kai.human_authority_decisions
     WHERE organization_id = org1
     LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
      VALUES (org1, candidate_a, gen_random_uuid(), 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('7', 64), org1);
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('member_authority_decision_cannot_substitute_packet_authority', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a member-level kai.human_authority_decisions id can never satisfy the packet authority-decision FK');

  -- 9. Candidate A's own decision cannot bind a manifest declared under
  -- candidate B (the composite FK pins organization + candidate + decision
  -- type together, so the decision's own candidate must match).
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    VALUES (org1, candidate_b, decision_a, 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('8', 64), org1);
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('cross_candidate_authority_decision_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'candidate A''s effective authority decision can never bind a manifest declared under candidate B');
END $$;

COMMIT;

-- 10. Replay convergence: a second manifest for the same (organization,
-- candidate, fingerprint) triple with a genuinely different id is rejected
-- by the unique constraint (the repository itself avoids this by using
-- ON CONFLICT DO NOTHING; a bare INSERT proves the constraint is real).
DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  candidate_a uuid := '14030000-0000-4000-8000-000000000501';
  decision_a uuid := '14070000-0000-4000-8000-000000000601';
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO kai.grant_response_packet_export_manifests (organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_id, effective_authority_decision_type, fingerprint_contract_version, canonical_fingerprint, created_by)
    VALUES (org1, candidate_a, decision_a, 'export_authority_granted', 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1', repeat('d', 64), org1);
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('replay_convergence_unique_rejects_duplicate_insert', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a bare duplicate INSERT for the same (organization, candidate, fingerprint) triple is rejected by the convergence-unique constraint');
END $$;

-- 11/12. The append-only trigger rejects UPDATE and DELETE.
DO $$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    UPDATE kai.grant_response_packet_export_manifests SET canonical_fingerprint = repeat('9', 64) WHERE grant_response_packet_export_manifest_id = '14080000-0000-4000-8000-000000000701';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('append_only_update_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'UPDATE of an existing manifest row is rejected');

  rejected := false;
  BEGIN
    DELETE FROM kai.grant_response_packet_export_manifests WHERE grant_response_packet_export_manifest_id = '14080000-0000-4000-8000-000000000701';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_08a_failure_results VALUES ('append_only_delete_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'DELETE of an existing manifest row is rejected');
END $$;

SELECT * FROM p14_08a_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_08a_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-08A grant-response-packet-export-manifest-foundation failure-checks verifier failed';
  END IF;
END $$;
