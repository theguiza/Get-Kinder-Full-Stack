BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.evidence_items WHERE support_strength = 'reviewed_supported') THEN
    RAISE EXCEPTION 'rollback refused: kai.evidence_items has reviewed_supported rows';
  END IF;
  IF EXISTS (SELECT 1 FROM kai.claims WHERE claim_strength = 'reviewed_supported') THEN
    RAISE EXCEPTION 'rollback refused: kai.claims has reviewed_supported rows';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM kai.review_queue_items
     WHERE queue_type = 'client_followup'
       AND queue_status = 'resolved'
       AND review_status = 'resolved'
  ) THEN
    RAISE EXCEPTION 'rollback refused: client_followup resolved/resolved queue rows exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.upload_lifecycle_audit
     WHERE operation IN (
       'evidence_review_completed',
       'claim_review_completed_internal_approval',
       'client_followup_completed'
     )
  ) THEN
    RAISE EXCEPTION 'rollback refused: audit rows use operations widened/restored by reconciliation';
  END IF;
END $$;

DO $$
DECLARE
  old_expr text;
  pre_ops text[];
  kept_ops text[];
  preserved boolean;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO old_expr
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

  IF old_expr IS NULL THEN
    RAISE EXCEPTION 'rollback refused: shared upload_lifecycle_audit operation CHECK is required';
  END IF;

  SELECT array_agg(DISTINCT op ORDER BY op)
    INTO pre_ops
    FROM (
      SELECT regexp_split_to_table(
               CASE WHEN m[1] LIKE '{%' THEN trim(both '{}' from m[1]) ELSE m[1] END,
               CASE WHEN m[1] LIKE '{%' THEN ',' ELSE E'\\x1f' END
             ) AS op
        FROM regexp_matches(old_expr, '''([^'']+)''', 'g') AS m
    ) ops;

  IF pre_ops IS NULL OR cardinality(pre_ops) = 0 THEN
    RAISE EXCEPTION 'rollback refused: could not prove current audit operation vocabulary from %', old_expr;
  END IF;
  IF NOT 'coverage_review_decision_accepted_internal_with_limitation' = ANY (pre_ops) THEN
    RAISE EXCEPTION 'rollback refused: P2-10 audit operation is absent from current shared audit CHECK';
  END IF;
  IF NOT ARRAY['generated_content_draft_created', 'generated_content_review_completed', 'export_review_requested', 'export_review_started', 'export_review_completed', 'limitation_snapshot_confirmed', 'export_candidate_created']::text[] <@ pre_ops THEN
    RAISE EXCEPTION 'rollback refused: later/P3 audit operations are not all present in current shared audit CHECK: %', old_expr;
  END IF;

  SELECT array_agg(op ORDER BY op)
    INTO kept_ops
    FROM unnest(pre_ops) AS op
   WHERE op <> ALL (ARRAY[
     'evidence_review_completed',
     'claim_review_completed_internal_approval',
     'client_followup_completed'
   ]::text[]);

  EXECUTE format(
    'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon CHECK (operation = ANY (%L::text[])) NOT VALID',
    kept_ops
  );
  ALTER TABLE kai.upload_lifecycle_audit
    VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon;
  ALTER TABLE kai.upload_lifecycle_audit
    DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
  ALTER TABLE kai.upload_lifecycle_audit
    RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon
    TO upload_lifecycle_audit_gate_a_operation_check;

  SELECT bool_and(operation = ANY (kept_ops))
    INTO preserved
    FROM unnest(kept_ops) AS probe(operation);
  IF preserved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'rollback refused: narrowed audit operation CHECK did not preserve kept vocabulary';
  END IF;
END $$;

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check,
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_claim_review_metadata_object_check,
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check;

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p2_04_client_followup_contract_check,
  ADD CONSTRAINT review_queue_items_p2_04_client_followup_contract_check
    CHECK (
      queue_type <> 'client_followup'
      OR (
        target_object_type = 'client_followup_item'
        AND queue_status = 'waiting_on_client'
        AND review_status = 'proposed'
        AND priority = 'medium'
        AND summary = 'Client clarification is required for an unresolved claim gap.'
        AND assigned_to IS NULL
        AND due_at IS NULL
        AND required_action IN (
          'Confirm the business meaning of the unresolved field or measure.',
          'Confirm the denominator and how it is calculated.',
          'Confirm the reporting period represented by this source.',
          'Confirm the entity level represented by the unresolved field or measure.'
        )
      )
    ) NOT VALID;

ALTER TABLE kai.review_queue_items
  VALIDATE CONSTRAINT review_queue_items_p2_04_client_followup_contract_check;

ALTER TABLE kai.claims
  DROP CONSTRAINT IF EXISTS claims_p2_03_claim_strength_check,
  ADD CONSTRAINT claims_p2_03_claim_strength_check
    CHECK (claim_strength = 'unassessed') NOT VALID;
ALTER TABLE kai.claims
  VALIDATE CONSTRAINT claims_p2_03_claim_strength_check;

ALTER TABLE kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_support_strength_check,
  ADD CONSTRAINT evidence_items_p2_01_support_strength_check
    CHECK (support_strength = 'unassessed') NOT VALID;
ALTER TABLE kai.evidence_items
  VALIDATE CONSTRAINT evidence_items_p2_01_support_strength_check;

COMMIT;
