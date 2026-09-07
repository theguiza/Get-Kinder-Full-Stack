BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P3-05 export-review-request migration';
  END IF;
  IF to_regclass('kai.generated_content_drafts') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_drafts is required before P3-05 export-review-request migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P3-05 export-review-request migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'kai'
      AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P3-05 export-review-request migration';
  END IF;
END $$;

-- Fail closed unless the validated predecessor review_queue_items queue_type
-- contract actually admits 'export_review'. This proves the assumption behind
-- the P3-05 per-queue_type constraints below by inspection of the live
-- predicate, rather than by comment.
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
     AND r.relname = 'review_queue_items'
     AND c.conname = 'review_queue_items_p1_06_queue_type_check'
     AND c.convalidated;

  IF existing_predicate IS NULL THEN
    RAISE EXCEPTION 'validated kai.review_queue_items_p1_06_queue_type_check is required before P3-05 export-review-request migration';
  END IF;

  IF position('''export_review''' IN existing_predicate) = 0 THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_type_check does not admit export_review; refusing P3-05 export-review-request migration';
  END IF;
END $$;

-- 'export_review' is already an admitted kai.review_queue_items.queue_type value
-- (see review_queue_items_p1_06_queue_type_check, proven above). This migration
-- adds the per-queue_type identity and static-contract constraints P3-05
-- requires, following the exact pattern P3-01/P3-04 established for
-- 'generated_content_review'.
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p3_05_export_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'export_review';

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_05_export_review_contract_check,
  ADD CONSTRAINT review_queue_items_p3_05_export_review_contract_check
    CHECK (
      queue_type <> 'export_review'
      OR (
        target_object_type = 'generated_content_draft'
        AND queue_status = 'open'
        AND review_status = 'needs_gk_review'
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

-- Preserve the validated predecessor audit-operation predicate exactly and add
-- only the P3-05 request operation, following the same monotonic
-- predecessor-preservation approach established by the repaired P3-04
-- migration. This keeps P3-05 correct whether the predecessor is the ordinary
-- P3-01/P3-04 vocabulary or an already-expanded valid predecessor.
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
    RAISE EXCEPTION 'validated kai.upload_lifecycle_audit_gate_a_operation_check is required before P3-05 export-review-request migration';
  END IF;

  IF position('export_review_requested' IN existing_predicate) = 0 THEN
    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_05 CHECK ((%s) OR operation = ''export_review_requested'') NOT VALID',
      existing_predicate
    );
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_05;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_05
      TO upload_lifecycle_audit_gate_a_operation_check;
  END IF;
END $$;

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_05_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p3_05_metadata_object_check
    CHECK (
      operation <> 'export_review_requested'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'contract'
        AND metadata ? 'organization_id'
        AND metadata ? 'generated_content_draft_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'requested_export_audience'
        AND metadata ? 'actor_id'
        AND metadata ? 'actor_type'
        AND metadata ? 'requested_timestamp'
        AND metadata ? 'validator_key'
        AND metadata ? 'failed_gates'
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
        AND metadata - ARRAY[
          'contract',
          'organization_id',
          'generated_content_draft_id',
          'review_queue_item_id',
          'requested_export_audience',
          'actor_id',
          'actor_type',
          'requested_timestamp',
          'validator_key',
          'failed_gates'
        ] = '{}'::jsonb
      )
    );

COMMIT;
