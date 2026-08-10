BEGIN;

CREATE TEMP TABLE p2_05_failure_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
);

DO $$
DECLARE
  org_id uuid := '00000000-0000-4000-8000-000000000001';
  lower_claim uuid := '10000000-0000-4000-8000-000000000001';
  higher_claim uuid := '20000000-0000-4000-8000-000000000001';
  group_id uuid := '30000000-0000-4000-8000-000000000001';
  gap1 uuid := '40000000-0000-4000-8000-000000000001';
  gap2 uuid := '50000000-0000-4000-8000-000000000001';
BEGIN
  BEGIN
    INSERT INTO kai.conflict_groups (
      conflict_group_id, organization_id, lower_claim_id, higher_claim_id,
      lower_claim_conflict_gap_id, higher_claim_conflict_gap_id,
      basis_code, safe_summary, created_by_type
    ) VALUES (
      group_id, org_id, higher_claim, lower_claim, gap1, gap2,
      'human_selected_unresolved_comparison', 'Potential claim conflict requires GK review.', 'system'
    );
    INSERT INTO p2_05_failure_results VALUES ('reversed_pair_rejected', 'FAIL', 'reversed pair was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_05_failure_results VALUES ('reversed_pair_rejected', 'PASS', 'lower_claim_id < higher_claim_id check rejected reversed persistence');
  END;

  BEGIN
    INSERT INTO kai.conflict_groups (
      conflict_group_id, organization_id, lower_claim_id, higher_claim_id,
      lower_claim_conflict_gap_id, higher_claim_conflict_gap_id,
      basis_code, safe_summary, created_by_type
    ) VALUES (
      gen_random_uuid(), org_id, lower_claim, lower_claim, gap1, gap2,
      'human_selected_unresolved_comparison', 'Potential claim conflict requires GK review.', 'system'
    );
    INSERT INTO p2_05_failure_results VALUES ('self_pair_rejected', 'FAIL', 'self-pair was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_05_failure_results VALUES ('self_pair_rejected', 'PASS', 'self-pair fails the same normalized ordering check');
  END;

  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      queue_status, review_status, priority, summary, required_action, queue_metadata, created_by_type
    ) VALUES (
      org_id, 'conflict_resolution', 'conflict_group', group_id,
      'open', 'needs_gk_review', 'normal', 'Potential claim conflict requires GK review.',
      'Record a proven conflict.', '{}'::jsonb, 'system'
    );
    INSERT INTO p2_05_failure_results VALUES ('queue_required_action_exact', 'FAIL', 'wrong conflict_resolution required_action was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_05_failure_results VALUES ('queue_required_action_exact', 'PASS', 'scoped queue contract rejected unsupported required_action');
  END;

  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      queue_status, review_status, priority, summary, required_action, assigned_to, queue_metadata, created_by_type
    ) VALUES (
      org_id, 'conflict_resolution', 'conflict_group', group_id,
      'open', 'needs_gk_review', 'normal', 'Potential claim conflict requires GK review.',
      'Compare both claims, their evidence lineage, definitions, reporting periods, entity levels, denominators, and support limitations. Record whether a conflict exists. Do not approve or promote either claim.',
      '90000000-0000-4000-8000-000000000001', '{}'::jsonb, 'system'
    );
    INSERT INTO p2_05_failure_results VALUES ('queue_assignment_null_required', 'FAIL', 'assigned conflict_resolution row was unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p2_05_failure_results VALUES ('queue_assignment_null_required', 'PASS', 'scoped queue contract rejected assigned_to');
  END;

  INSERT INTO p2_05_failure_results
  SELECT 'audit_asserted_conflict_branch_present',
         CASE WHEN EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class r ON r.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = r.relnamespace
            WHERE n.nspname = 'kai'
              AND r.relname = 'upload_lifecycle_audit'
              AND c.conname = 'upload_lifecycle_audit_p2_05_metadata_object_check'
              AND pg_get_constraintdef(c.oid) LIKE '%asserted_conflict%'
              AND pg_get_constraintdef(c.oid) LIKE '%claim_statement%'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'catalog branch rejects asserted-conflict and raw claim statement metadata without requiring audit FK setup';
END $$;

SELECT 'P2_05_FAILURE_CHECKS' AS result_type, check_name, status, detail
FROM p2_05_failure_results
ORDER BY check_name;

ROLLBACK;
