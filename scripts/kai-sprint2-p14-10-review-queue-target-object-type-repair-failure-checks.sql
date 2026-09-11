DROP TABLE IF EXISTS p14_10_failure_results;
CREATE TEMP TABLE p14_10_failure_results (
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
  -- A generated_content_review row whose target_object_type is anything
  -- other than 'generated_content_draft' must still be rejected by the
  -- untouched P3-04 generated-content-specific contract, not by the
  -- (now-canonical, generic) target_object_type length bound.
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
      '14100000-0000-4000-8000-000000000201',
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
  INSERT INTO p14_10_failure_results
  VALUES (
    'wrong_generated_content_review_target_rejected_by_p3_04',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a generated_content_review row with target_object_type <> generated_content_draft is rejected by review_queue_items_p3_04_generated_content_review_contract_chec (23514), not admitted by the repaired generic constraint'
  );
END $$;

DO $$
DECLARE
  rejected boolean;
  sqlstate_text text;
  constraint_text text;
BEGIN
  -- Any queue_type's target_object_type outside the canonical 1..128 length
  -- bound must still be rejected by the repaired generic constraint.
  rejected := false;
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary,
      queue_metadata, created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'claim_review',
      repeat('x', 129),
      '14100000-0000-4000-8000-000000000201',
      'medium', 'open', 'needs_gk_review', 'x',
      '{}'::jsonb, 'system'
    );
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS
      sqlstate_text = RETURNED_SQLSTATE,
      constraint_text = CONSTRAINT_NAME;
    rejected := sqlstate_text = '23514'
      AND constraint_text = 'review_queue_items_p1_06_target_object_type_check';
  END;
  INSERT INTO p14_10_failure_results
  VALUES (
    'oversized_generic_target_object_type_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a target_object_type longer than 128 characters is rejected by review_queue_items_p1_06_target_object_type_check (23514)'
  );
END $$;

DO $$
DECLARE
  rejected boolean;
  sqlstate_text text;
  constraint_text text;
BEGIN
  -- The empty-string boundary of the same canonical bound.
  rejected := false;
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary,
      queue_metadata, created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      'claim_review',
      '',
      '14100000-0000-4000-8000-000000000201',
      'medium', 'open', 'needs_gk_review', 'x',
      '{}'::jsonb, 'system'
    );
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS
      sqlstate_text = RETURNED_SQLSTATE,
      constraint_text = CONSTRAINT_NAME;
    rejected := sqlstate_text = '23514'
      AND constraint_text = 'review_queue_items_p1_06_target_object_type_check';
  END;
  INSERT INTO p14_10_failure_results
  VALUES (
    'empty_generic_target_object_type_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'an empty target_object_type is rejected by review_queue_items_p1_06_target_object_type_check (23514)'
  );
END $$;

SELECT * FROM p14_10_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_10_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-10 review-queue target_object_type schema-repair failure-checks failed';
  END IF;
END $$;
