BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P3-09 export-review-start migration';
  END IF;
  IF to_regclass('kai.generated_content_drafts') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_drafts is required before P3-09 export-review-start migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P3-09 export-review-start migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'kai'
      AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P3-09 export-review-start migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'review_queue_items_p3_05_export_review_contract_check'
  ) THEN
    RAISE EXCEPTION 'P3-05 export_review contract check is required before P3-09 export-review-start migration';
  END IF;
END $$;

-- Relax the P3-05 export_review contract to admit the P3-09 lifecycle matrix
-- (open/needs_gk_review, in_progress/needs_gk_review) while every other
-- static field remains pinned exactly as P3-05 established it.
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_05_export_review_contract_check,
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_09_export_review_contract_check,
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

-- Preserve the validated predecessor audit-operation predicate exactly and
-- add only the P3-09 start operation, following the same monotonic
-- predecessor-preservation approach established by the repaired P3-04 and
-- P3-05 migrations (and later reaffirmed by P3-17): reconstructing a static
-- historical allowlist here would silently drop any operation the actual
-- validated predecessor predicate admits but this file's author did not
-- enumerate, which is exactly the defect that caused the production
-- SQLSTATE 23514 failure this migration now guards against.
DO $$
DECLARE
  existing_predicate text;
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
    RAISE EXCEPTION 'validated kai.upload_lifecycle_audit_gate_a_operation_check is required before P3-09 export-review-start migration';
  END IF;

  IF position('export_review_started' IN existing_predicate) = 0 THEN
    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_09 CHECK ((%s) OR operation = ''export_review_started'') NOT VALID',
      existing_predicate
    );
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_09;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_09
      TO upload_lifecycle_audit_gate_a_operation_check;
  END IF;
END $$;

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_09_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p3_09_metadata_object_check
    CHECK (
      operation <> 'export_review_started'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'contract'
        AND metadata ? 'organization_id'
        AND metadata ? 'generated_content_draft_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'actor_id'
        AND metadata ? 'actor_type'
        AND metadata ? 'expected_updated_at'
        AND metadata ? 'requested_start_timestamp'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'validator_keys'
        AND NOT metadata ? 'draft_text'
        AND NOT metadata ? 'claim_text'
        AND NOT metadata ? 'claim_statement'
        AND NOT metadata ? 'evidence_text'
        AND NOT metadata ? 'block_text'
        AND NOT metadata ? 'citations'
        AND NOT metadata ? 'filename'
        AND NOT metadata ? 'storage_path'
        AND NOT metadata ? 'prompt'
        AND NOT metadata ? 'raw_content'
        AND NOT metadata ? 'source_text'
        AND NOT metadata ? 'generated_text'
        AND NOT metadata ? 'credential'
        AND NOT metadata ? 'notes'
        AND NOT metadata ? 'requested_export_audience'
        AND metadata - ARRAY[
          'contract',
          'organization_id',
          'generated_content_draft_id',
          'review_queue_item_id',
          'actor_id',
          'actor_type',
          'expected_updated_at',
          'requested_start_timestamp',
          'previous_queue_status',
          'resulting_queue_status',
          'previous_review_status',
          'resulting_review_status',
          'validator_keys'
        ] = '{}'::jsonb
      )
    );

COMMIT;
