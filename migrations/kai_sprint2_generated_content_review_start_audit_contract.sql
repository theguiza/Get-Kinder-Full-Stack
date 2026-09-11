BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before the generated-content-review-start audit-contract migration';
  END IF;
  IF to_regclass('kai.generated_content_drafts') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_drafts is required before the generated-content-review-start audit-contract migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before the generated-content-review-start audit-contract migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'kai'
      AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before the generated-content-review-start audit-contract migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'review_queue_items_p3_04_generated_content_review_contract_check'
  ) THEN
    RAISE EXCEPTION 'P3-04 generated_content_review contract check is required before the generated-content-review-start audit-contract migration';
  END IF;
END $$;

-- Scope note: unlike P3-04, this migration does NOT alter
-- review_queue_items_p3_04_generated_content_review_contract_check. That
-- constraint already admits the queue_status='in_progress' AND
-- review_status='needs_gk_review' lifecycle state
-- startGeneratedContentReview transitions into (verified directly above and
-- again by this package's own verifier) - the review-queue side of the
-- /start transition was never the defect. The defect is isolated to
-- kai.upload_lifecycle_audit's operation vocabulary: application code
-- (Backend/kai/dictionary/postgresGeneratedContentRepository.js,
-- START_REVIEW_AUDIT_OPERATION = 'generated_content_review_started') has
-- always written this audit operation on every /start call, but no
-- migration ever added it to upload_lifecycle_audit_gate_a_operation_check -
-- unlike its siblings 'generated_content_review_completed' (added by P3-04)
-- and 'export_review_started' (added by P3-09). Every real /start database
-- write has therefore always raised SQLSTATE 23514 on this INSERT.

-- Preserve the validated predecessor audit-operation predicate exactly and
-- add only the missing start-review operation, following the same
-- monotonic predecessor-preservation approach established by P3-04, P3-05,
-- P3-09, and P3-17's own repair: reconstructing a static historical
-- allowlist here would silently drop any operation the actual validated
-- predecessor predicate admits but this file's author did not enumerate.
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
    RAISE EXCEPTION 'validated kai.upload_lifecycle_audit_gate_a_operation_check is required before the generated-content-review-start audit-contract migration';
  END IF;

  IF position('generated_content_review_started' IN existing_predicate) = 0 THEN
    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_gcrs CHECK ((%s) OR operation = ''generated_content_review_started'') NOT VALID',
      existing_predicate
    );
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_gcrs;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_gcrs
      TO upload_lifecycle_audit_gate_a_operation_check;
  END IF;
END $$;

-- Metadata-only audit CHECK for the start-review operation, derived from the
-- exact fields buildGeneratedContentStartReviewAuditMetadata
-- (Backend/kai/dictionary/postgresGeneratedContentRepository.js) writes, and
-- from the same prohibited-content vocabulary the P3-04/P3-09 metadata
-- checks already enforce.
ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gcrs_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_gcrs_metadata_object_check
    CHECK (
      operation <> 'generated_content_review_started'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'contract'
        AND metadata ? 'organization_id'
        AND metadata ? 'generation_run_id'
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
        AND metadata - ARRAY[
          'contract',
          'organization_id',
          'generation_run_id',
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
