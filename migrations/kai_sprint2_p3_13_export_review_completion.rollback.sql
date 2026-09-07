BEGIN;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation = 'export_review_completed';

UPDATE kai.review_queue_items
   SET queue_status = 'in_progress',
       review_status = 'needs_gk_review'
 WHERE queue_type = 'export_review'
   AND queue_status = 'resolved'
   AND review_status = 'resolved';

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_13_metadata_object_check;

-- Reverse the repaired forward migration's monotonic predecessor-extension:
-- it added "... OR operation = 'export_review_completed'" as the outermost
-- disjunct of whatever the predecessor predicate was. Strip that trailing
-- disjunct with a tolerant, anchored pattern instead of reconstructing from a
-- static historical allowlist, but still fail closed if the current predicate
-- does not have the expected shape. Mirrors the mechanism
-- kai_sprint2_p3_09_export_review_start.rollback.sql established for this
-- exact constraint.
DO $p3_13_rollback$
DECLARE
  existing_predicate text;
  restored_predicate text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
     AND c.convalidated;

  IF existing_predicate IS NULL THEN
    RAISE EXCEPTION 'validated kai.upload_lifecycle_audit_gate_a_operation_check is required before the P3-13 export-review-completion rollback';
  END IF;

  IF position('export_review_completed' IN existing_predicate) = 0 THEN
    -- Already rolled back (or never applied by the repaired forward shape); nothing to reverse.
    NULL;
  ELSE
    restored_predicate := regexp_replace(
      existing_predicate,
      '\s*OR\s*\(operation\s*=\s*''export_review_completed''(::text)?\)(?=\)*\s*$)',
      ''
    );

    IF restored_predicate = existing_predicate
       OR restored_predicate = ''
       OR position('export_review_completed' IN restored_predicate) <> 0
    THEN
      RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check does not have the expected P3-13 monotonic-extension shape; refusing the P3-13 export-review-completion rollback';
    END IF;

    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_13_rollback CHECK (%s) NOT VALID',
      restored_predicate
    );
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_13_rollback;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_13_rollback
      TO upload_lifecycle_audit_gate_a_operation_check;
  END IF;
END $p3_13_rollback$;

ALTER TABLE IF EXISTS kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_13_export_review_contract_check,
  ADD CONSTRAINT review_queue_items_p3_09_export_review_contract_check
    CHECK (
      queue_type <> 'export_review'
      OR (
        target_object_type = 'generated_content_draft'
        AND (
          (queue_status = 'open' AND review_status = 'needs_gk_review')
          OR (queue_status = 'in_progress' AND review_status = 'needs_gk_review')
        )
        AND priority = 'medium'
        AND summary = 'Generated draft requires export review.'
        AND required_action = 'Review audience authority, current eligibility, citations, and the final export gate before any export.'
        AND blocked_reason IS NULL
        AND assigned_to IS NULL
        AND due_at IS NULL
        AND queue_metadata = '{}'::jsonb
        AND created_by IS NULL
        AND created_by_type = 'system'
      )
    );

COMMIT;
