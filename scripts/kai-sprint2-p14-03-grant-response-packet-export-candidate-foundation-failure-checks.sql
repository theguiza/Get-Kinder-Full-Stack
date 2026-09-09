DROP TABLE IF EXISTS p14_03_failure_results;
CREATE TEMP TABLE p14_03_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  rejected boolean;
BEGIN
  -- A fabricated grant_response_packet_export_identity_id (no matching row
  -- at all) must be rejected by the tenant-safe composite FK.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_candidates (
      organization_id, grant_response_packet_export_identity_id, fingerprint_contract_version,
      canonical_fingerprint, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000001',
      'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1',
      repeat('c', 64),
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('fabricated_packet_identity_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a grant_response_packet_export_identity_id with no matching row is rejected by the composite FK');

  -- A real packet identity that belongs to a DIFFERENT organization must be
  -- rejected: the composite FK requires both identity id and organization_id
  -- to match the same identity row.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_candidates (
      organization_id, grant_response_packet_export_identity_id, fingerprint_contract_version,
      canonical_fingerprint, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000002',
      '14030000-0000-4000-8000-000000000201',
      'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1',
      repeat('d', 64),
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('cross_tenant_packet_identity_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a grant_response_packet_export_identity_id belonging to a different organization_id is rejected by the composite FK');

  -- A fingerprint_contract_version other than the single pinned value must
  -- be rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_candidates (
      organization_id, grant_response_packet_export_identity_id, fingerprint_contract_version,
      canonical_fingerprint, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '14030000-0000-4000-8000-000000000201',
      'some-other-contract-version',
      repeat('e', 64),
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('non_pinned_fingerprint_contract_version_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a fingerprint_contract_version other than the single pinned value is rejected');

  -- A canonical_fingerprint that is not a lower-case 64-hex-char SHA-256
  -- must be rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_candidates (
      organization_id, grant_response_packet_export_identity_id, fingerprint_contract_version,
      canonical_fingerprint, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '14030000-0000-4000-8000-000000000201',
      'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1',
      'not-a-fingerprint',
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('malformed_fingerprint_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a canonical_fingerprint that is not a lower-case 64-hex-char SHA-256 is rejected');

  -- A fabricated generated_content_draft_id (no matching row) on a member
  -- row must be rejected by the tenant-safe composite FK.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_candidate_members (
      grant_response_packet_export_candidate_id, organization_id, generated_content_draft_id, ordinal
    )
    VALUES (
      '14030000-0000-4000-8000-000000000501',
      '00000000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000002',
      99
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('fabricated_member_draft_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a generated_content_draft_id with no matching row is rejected by the composite FK');

  -- A duplicate (candidate, draft) member is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_candidate_members (
      grant_response_packet_export_candidate_id, organization_id, generated_content_draft_id, ordinal
    )
    VALUES (
      '14030000-0000-4000-8000-000000000501',
      '00000000-0000-4000-8000-000000000001',
      '14030000-0000-4000-8000-000000000401',
      1
    );
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('duplicate_candidate_draft_member_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a duplicate (candidate, draft) member row is rejected by the unique constraint');

  -- A duplicate ordinal within the same candidate is rejected, even for a
  -- different draft.
  rejected := false;
  BEGIN
    INSERT INTO kai.generated_content_drafts (
      generated_content_draft_id, generation_run_id, organization_id, content_type, requested_audience, validator_results
    )
    VALUES (
      '14030000-0000-4000-8000-000000000402',
      '14030000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000001',
      'evidence_summary',
      'funder',
      '[]'::jsonb
    )
    ON CONFLICT (generated_content_draft_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_candidate_members (
      grant_response_packet_export_candidate_id, organization_id, generated_content_draft_id, ordinal
    )
    VALUES (
      '14030000-0000-4000-8000-000000000501',
      '00000000-0000-4000-8000-000000000001',
      '14030000-0000-4000-8000-000000000402',
      0
    );
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('duplicate_ordinal_within_candidate_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a duplicate ordinal within the same candidate is rejected by the unique constraint, even for a different draft');
END $$;

ROLLBACK;

-- Immutability must be proven against rows that actually persist, so this
-- part runs outside the rolled-back probe transaction above, against the
-- real seeded rows from the smoke-seed script.
DO $$
DECLARE
  rejected boolean;
  member_id uuid;
BEGIN
  rejected := false;
  BEGIN
    UPDATE kai.grant_response_packet_export_candidates
       SET created_by = '00000000-0000-4000-8000-000000000999'
     WHERE grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('candidate_update_rejected_append_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'UPDATE on an existing candidate row is rejected by the append-only trigger');

  SELECT grant_response_packet_export_candidate_member_id INTO member_id
    FROM kai.grant_response_packet_export_candidate_members
   WHERE grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501'
   LIMIT 1;

  rejected := false;
  BEGIN
    UPDATE kai.grant_response_packet_export_candidate_members
       SET ordinal = 42
     WHERE grant_response_packet_export_candidate_member_id = member_id;
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('member_update_rejected_append_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'UPDATE on an existing member snapshot row is rejected by the append-only trigger');

  rejected := false;
  BEGIN
    DELETE FROM kai.grant_response_packet_export_candidate_members
     WHERE grant_response_packet_export_candidate_member_id = member_id;
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('member_delete_rejected_append_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'DELETE on an existing member snapshot row is rejected by the append-only trigger');

  rejected := false;
  BEGIN
    DELETE FROM kai.grant_response_packet_export_candidates
     WHERE grant_response_packet_export_candidate_id = '14030000-0000-4000-8000-000000000501';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_03_failure_results
  VALUES ('candidate_delete_rejected_append_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'DELETE on an existing candidate row is rejected by the append-only trigger (member row still FK-referencing it also proves ON DELETE RESTRICT would otherwise block this)');
END $$;

SELECT * FROM p14_03_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_03_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-03 grant-response-packet-export-candidate-foundation failure-checks verifier failed';
  END IF;
END $$;
