BEGIN;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation = 'generated_content_review_started';

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gcrs_metadata_object_check;

-- Reverse the forward migration's monotonic predecessor-extension: it added
-- "... OR operation = 'generated_content_review_started'" as the outermost
-- disjunct of whatever the predecessor predicate was. Postgres re-serializes
-- the stored expression (adding ::text casts and precedence parens) rather
-- than preserving the exact text supplied, so strip the trailing disjunct
-- with a tolerant, anchored pattern instead of an exact literal-text suffix
-- match - but still fail closed (never reconstruct from a static historical
-- allowlist) if the current predicate does not have the expected shape.
-- Mirrors the same rollback mechanism
-- kai_sprint2_p3_09_export_review_start.rollback.sql established for this
-- exact constraint.
DO $gcrs_rollback$
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
    RAISE EXCEPTION 'validated kai.upload_lifecycle_audit_gate_a_operation_check is required before the generated-content-review-start audit-contract rollback';
  END IF;

  IF position('generated_content_review_started' IN existing_predicate) = 0 THEN
    -- Already rolled back (or never applied by the repaired forward shape); nothing to reverse.
    NULL;
  ELSE
    restored_predicate := regexp_replace(
      existing_predicate,
      '\s*OR\s*\(operation\s*=\s*''generated_content_review_started''(::text)?\)(?=\)*\s*$)',
      ''
    );

    IF restored_predicate = existing_predicate
       OR restored_predicate = ''
       OR position('generated_content_review_started' IN restored_predicate) <> 0
    THEN
      RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check does not have the expected monotonic-extension shape; refusing the generated-content-review-start audit-contract rollback';
    END IF;

    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_gcrs_rollback CHECK (%s) NOT VALID',
      restored_predicate
    );
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_gcrs_rollback;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_gcrs_rollback
      TO upload_lifecycle_audit_gate_a_operation_check;
  END IF;
END $gcrs_rollback$;

UPDATE kai.review_queue_items
   SET queue_status = 'open'
 WHERE queue_type = 'generated_content_review'
   AND review_status = 'needs_gk_review'
   AND queue_status = 'in_progress';

COMMIT;
