DROP TABLE IF EXISTS gcrs_failure_results;
CREATE TEMP TABLE gcrs_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

DO $$
DECLARE
  rejected boolean;
  sqlstate_text text;
  constraint_text text;
BEGIN
  -- An unrelated, never-allowlisted operation must still be rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    )
    SELECT '00000000-0000-4000-8000-000000000001', f.intake_file_id,
           'not_a_real_operation', f.upload_state, f.upload_state, 'success', '{}'::jsonb
      FROM kai.intake_files f
     WHERE f.organization_id = '00000000-0000-4000-8000-000000000001'
     ORDER BY f.intake_file_id ASC LIMIT 1;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS
      sqlstate_text = RETURNED_SQLSTATE,
      constraint_text = CONSTRAINT_NAME;
    rejected := sqlstate_text = '23514'
      AND constraint_text = 'upload_lifecycle_audit_gate_a_operation_check';
  END;
  INSERT INTO gcrs_failure_results
  VALUES (
    'invalid_audit_operation_still_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'an operation value outside the (now-extended) allowlist is still rejected by upload_lifecycle_audit_gate_a_operation_check (23514)'
  );
END $$;

DO $$
DECLARE
  rejected boolean;
  sqlstate_text text;
  constraint_text text;
BEGIN
  -- generated_content_review_started with missing required metadata keys
  -- must be rejected by the new metadata-only CHECK.
  rejected := false;
  BEGIN
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    )
    SELECT '00000000-0000-4000-8000-000000000001', f.intake_file_id,
           'generated_content_review_started', f.upload_state, f.upload_state, 'success',
           '{"contract":"p3_stage_b_generated_content_review_start_v1"}'::jsonb
      FROM kai.intake_files f
     WHERE f.organization_id = '00000000-0000-4000-8000-000000000001'
     ORDER BY f.intake_file_id ASC LIMIT 1;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS
      sqlstate_text = RETURNED_SQLSTATE,
      constraint_text = CONSTRAINT_NAME;
    rejected := sqlstate_text = '23514'
      AND constraint_text = 'upload_lifecycle_audit_gcrs_metadata_object_check';
  END;
  INSERT INTO gcrs_failure_results
  VALUES (
    'missing_required_start_metadata_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'generated_content_review_started metadata missing required identifiers/timestamps/validator_keys is rejected (23514)'
  );
END $$;

DO $$
DECLARE
  rejected boolean;
  sqlstate_text text;
  constraint_text text;
BEGIN
  -- A forbidden, non-enumerated metadata key ('notes') must still be
  -- rejected by this package's own metadata-shape check (the
  -- "metadata - ARRAY[...] = '{}'::jsonb" / "NOT metadata ? 'notes'" clauses)
  -- even with every required key present. 'raw_content' is deliberately not
  -- used here: it is already caught by the generic, all-operations
  -- upload_lifecycle_audit_gate_a_metadata_object_check content-pattern
  -- guard (kai.gate_a_p0_jsonb_metadata_only) before this package's own
  -- constraint is ever evaluated - a real, independently-enforced defense
  -- this package does not need to duplicate, but this check exists to prove
  -- this package's OWN constraint fails closed too.
  rejected := false;
  BEGIN
    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    )
    SELECT '00000000-0000-4000-8000-000000000001', f.intake_file_id,
           'generated_content_review_started', f.upload_state, f.upload_state, 'success',
           jsonb_build_object(
             'contract', 'p3_stage_b_generated_content_review_start_v1',
             'organization_id', '00000000-0000-4000-8000-000000000001',
             'generation_run_id', '9c500000-0000-4000-8000-000000000101',
             'generated_content_draft_id', '9c500000-0000-4000-8000-000000000201',
             'review_queue_item_id', '9c500000-0000-4000-8000-000000000301',
             'actor_id', '90000000-0000-4000-8000-000000000001',
             'actor_type', 'human',
             'expected_updated_at', '2026-08-06T10:00:00.000Z',
             'requested_start_timestamp', '2026-08-06T10:00:01.000Z',
             'previous_queue_status', 'open',
             'resulting_queue_status', 'in_progress',
             'previous_review_status', 'needs_gk_review',
             'resulting_review_status', 'needs_gk_review',
             'validator_keys', jsonb_build_array('VAL-REV-START-001'),
             'notes', 'forbidden extra key'
           )
      FROM kai.intake_files f
     WHERE f.organization_id = '00000000-0000-4000-8000-000000000001'
     ORDER BY f.intake_file_id ASC LIMIT 1;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS
      sqlstate_text = RETURNED_SQLSTATE,
      constraint_text = CONSTRAINT_NAME;
    rejected := sqlstate_text = '23514'
      AND constraint_text = 'upload_lifecycle_audit_gcrs_metadata_object_check';
  END;
  INSERT INTO gcrs_failure_results
  VALUES (
    'forbidden_extra_metadata_key_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'generated_content_review_started metadata carrying a prohibited, non-enumerated notes key is rejected by this package''s own constraint even when every required key is present (23514)'
  );
END $$;

DO $$
DECLARE
  rejected boolean;
  sqlstate_text text;
  constraint_text text;
BEGIN
  -- A wrong lifecycle transition (queue_type=generated_content_review with a
  -- target_object_type other than generated_content_draft) must still be
  -- rejected by the untouched P3-04 contract, proving this package left it
  -- fail-closed.
  rejected := false;
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action,
      queue_metadata, created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'generated_content_review',
      'some_other_object',
      '9c500000-0000-4000-8000-000000000201',
      'medium', 'open', 'needs_gk_review',
      'Generated draft requires human review.',
      'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.',
      '{}'::jsonb, 'system'
    );
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS
      sqlstate_text = RETURNED_SQLSTATE,
      constraint_text = CONSTRAINT_NAME;
    rejected := sqlstate_text = '23514'
      AND constraint_text = 'review_queue_items_p3_04_generated_content_review_contract_chec';
  END;
  INSERT INTO gcrs_failure_results
  VALUES (
    'invalid_queue_lifecycle_still_blocked',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'the untouched P3-04 generated_content_review contract still rejects a wrong target_object_type (23514)'
  );
END $$;

SELECT * FROM gcrs_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gcrs_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'generated-content-review-start audit-contract failure-checks failed';
  END IF;
END $$;
