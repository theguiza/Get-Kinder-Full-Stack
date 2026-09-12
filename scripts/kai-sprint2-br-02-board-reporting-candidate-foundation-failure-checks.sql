DROP TABLE IF EXISTS br_02_failure_results;
CREATE TEMP TABLE br_02_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidates (
      organization_id, engagement_id, packet_audience, idempotency_key,
      fingerprint_contract_version, canonical_fingerprint, candidate_status, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000001',
      'internal',
      'br-02-bad-engagement',
      'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1',
      repeat('d', 64),
      'created',
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO br_02_failure_results VALUES ('fabricated_engagement_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'candidate must FK to a real same-tenant engagement');

  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidates (
      organization_id, engagement_id, packet_audience, idempotency_key,
      fingerprint_contract_version, canonical_fingerprint, candidate_status, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '15020000-0000-4000-8000-000000000001',
      'funder',
      'br-02-bad-audience',
      'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1',
      repeat('e', 64),
      'created',
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO br_02_failure_results VALUES ('non_internal_audience_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'Board candidates are internal only');

  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidates (
      organization_id, engagement_id, packet_audience, idempotency_key,
      fingerprint_contract_version, canonical_fingerprint, candidate_status, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '15020000-0000-4000-8000-000000000001',
      'internal',
      'br-02-bad-fingerprint',
      'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1',
      'not-a-fingerprint',
      'created',
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO br_02_failure_results VALUES ('malformed_fingerprint_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'canonical_fingerprint must be sha256 hex');

  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_members (
      board_reporting_candidate_id, organization_id, generated_content_draft_id, ordinal
    )
    VALUES (
      '15020000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000002',
      9
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO br_02_failure_results VALUES ('fabricated_member_draft_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'member draft must exist in same tenant');

  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_members (
      board_reporting_candidate_id, organization_id, generated_content_draft_id, ordinal
    )
    VALUES (
      '15020000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000001',
      '15020000-0000-4000-8000-000000000201',
      2
    );
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO br_02_failure_results VALUES ('duplicate_candidate_draft_member_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'candidate member draft uniqueness is enforced');

  rejected := false;
  BEGIN
    INSERT INTO kai.board_reporting_candidate_members (
      board_reporting_candidate_id, organization_id, generated_content_draft_id, ordinal
    )
    VALUES (
      '15020000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000001',
      '15020000-0000-4000-8000-000000000202',
      0
    );
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO br_02_failure_results VALUES ('duplicate_ordinal_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'candidate member ordinal uniqueness is enforced');
END $$;

ROLLBACK;

DO $$
DECLARE
  rejected boolean;
  member_id uuid;
BEGIN
  rejected := false;
  BEGIN
    UPDATE kai.board_reporting_candidates
       SET candidate_status = 'changed'
     WHERE board_reporting_candidate_id = '15020000-0000-4000-8000-000000000301';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO br_02_failure_results VALUES ('candidate_update_rejected_append_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'candidate UPDATE is rejected');

  SELECT board_reporting_candidate_member_id INTO member_id
    FROM kai.board_reporting_candidate_members
   WHERE board_reporting_candidate_id = '15020000-0000-4000-8000-000000000301'
   ORDER BY ordinal
   LIMIT 1;

  rejected := false;
  BEGIN
    DELETE FROM kai.board_reporting_candidate_members
     WHERE board_reporting_candidate_member_id = member_id;
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO br_02_failure_results VALUES ('member_delete_rejected_append_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'member DELETE is rejected');
END $$;

SELECT * FROM br_02_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM br_02_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'BR-02 board-reporting-candidate-foundation failure checks failed';
  END IF;
END $$;
