BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.intake_sensitivity_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles is required before P1-06 review-queue migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-06 review-queue migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-06 review-queue migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_sensitivity_profiles'
       AND c.conname = 'intake_sensitivity_profiles_p1_05_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles_p1_05_identity_unique is required before P1-06 review-queue migration';
  END IF;
END $$;

-- P1-06 owner decision: this is the first tracked creation of the canonical,
-- already-production-used kai.review_queue_items table (Backend/kai/db/kaiIntakeQueries.js
-- and Backend/kai/services/kaiReviewQueueService.js already code against this exact
-- column list; scripts/kai-sprint2-ddl-vocabulary-status-check.sql already asserts the
-- queue_type/queue_status vocabularies below as required). This migration creates the
-- full canonical table - not a P1-06-only narrow subset - so every existing and future
-- queue_type keeps working unmodified. P1-06 itself only ever writes queue_type =
-- 'sensitivity_review', queue_status = 'open', priority = 'medium' rows: the wider
-- vocabulary below exists because the table is shared, not because P1-06 uses it.
CREATE TABLE IF NOT EXISTS kai.review_queue_items (
  review_queue_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  queue_type text NOT NULL,
  target_object_type text NOT NULL,
  target_object_id uuid NOT NULL,
  priority text NOT NULL DEFAULT 'medium',
  queue_status text NOT NULL DEFAULT 'open',
  review_status text NOT NULL DEFAULT 'needs_gk_review',
  blocked_reason text,
  assigned_to uuid,
  due_at timestamptz,
  summary text NOT NULL,
  required_action text,
  queue_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT review_queue_items_p1_06_queue_type_check
    CHECK (queue_type IN (
      'intake_file_review',
      'source_candidate_review',
      'sensitivity_review',
      'data_dictionary_review',
      'evidence_review',
      'claim_review',
      'client_followup',
      'conflict_resolution',
      'generated_content_review',
      'export_review'
    )),
  CONSTRAINT review_queue_items_p1_06_queue_status_check
    CHECK (queue_status IN (
      'open',
      'in_progress',
      'blocked',
      'waiting_on_client',
      'waiting_on_gk',
      'resolved',
      'cancelled'
    )),
  CONSTRAINT review_queue_items_p1_06_review_status_check
    CHECK (review_status IN ('proposed', 'needs_gk_review', 'resolved')),
  CONSTRAINT review_queue_items_p1_06_priority_check
    CHECK (priority IN (
      'mandatory',
      'immediate_fix',
      'high',
      'medium',
      'low',
      'backlog',
      'not_applicable',
      'unknown'
    )),
  CONSTRAINT review_queue_items_p1_06_created_by_type_check
    CHECK (created_by_type IN ('human', 'system')),
  CONSTRAINT review_queue_items_p1_06_target_object_type_check
    CHECK (length(target_object_type) BETWEEN 1 AND 128),
  CONSTRAINT review_queue_items_p1_06_summary_check
    CHECK (length(summary) BETWEEN 1 AND 2000),
  CONSTRAINT review_queue_items_p1_06_required_action_check
    CHECK (required_action IS NULL OR length(required_action) BETWEEN 1 AND 2000),
  CONSTRAINT review_queue_items_p1_06_sensrev_required_action_check
    CHECK (
      queue_type <> 'sensitivity_review'
      OR (
        required_action IS NOT NULL
        AND length(btrim(required_action)) BETWEEN 1 AND 2000
      )
    ),
  CONSTRAINT review_queue_items_p1_06_blocked_reason_check
    CHECK (blocked_reason IS NULL OR length(blocked_reason) BETWEEN 1 AND 2000),
  CONSTRAINT review_queue_items_p1_06_queue_metadata_object_check
    CHECK (jsonb_typeof(queue_metadata) = 'object')
);

-- P1-06 idempotency identity for the 'sensitivity_review' queue_type only: a partial
-- unique index, not a table-wide constraint, so other queue_types already assumed by
-- kaiIntakeQueries.js/kaiReviewQueueService.js (for example a re-opened
-- 'intake_file_review' item for the same intake_file after an earlier one resolved)
-- keep their own legitimate multi-row-per-target behavior unmodified.
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p1_06_sensitivity_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'sensitivity_review';

CREATE INDEX IF NOT EXISTS ix_review_queue_items_p1_06_tenant_queue
  ON kai.review_queue_items (organization_id, queue_type, queue_status);

-- Row-level `updated_at` maintenance: the existing production
-- updateReviewQueueItemStatusIfCurrent query (Backend/kai/db/kaiIntakeQueries.js) never
-- sets updated_at itself, so the canonical table maintains it with a trigger, exactly
-- like any other server-maintained bookkeeping column in this schema.
CREATE OR REPLACE FUNCTION kai.review_queue_items_p1_06_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_queue_items_p1_06_touch_updated_at ON kai.review_queue_items;
CREATE TRIGGER trg_review_queue_items_p1_06_touch_updated_at
  BEFORE UPDATE ON kai.review_queue_items
  FOR EACH ROW
  EXECUTE FUNCTION kai.review_queue_items_p1_06_touch_updated_at();

-- P1-06 does not add a polymorphic or conditional foreign key from
-- review_queue_items.target_object_id: the table already carries queue_types
-- ('intake_file_review', 'data_dictionary_review', 'evidence_review', 'claim_review',
-- and others) whose target_object_id points at different target tables, so a single
-- table-wide FOREIGN KEY on that shared column cannot be expressed for one queue_type
-- without breaking the others. Instead, the P1-06 repository
-- (Backend/kai/dictionary/postgresReviewQueueRepository.js) authoritatively verifies,
-- inside the same transaction as the insert, that the referenced
-- kai.intake_sensitivity_profiles row exists and is tenant-matched before writing a
-- 'sensitivity_review' item against it.

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_operation_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
    CHECK (operation IN (
      'reserve_upload',
      'start_upload',
      'complete_object_version',
      'confirm_upload',
      'block_upload',
      'abandon_upload',
      'expire_upload',
      'policy_decision_compare_and_set',
      'parser_run_recorded',
      'file_profile_persisted',
      'data_dictionary_draft_persisted',
      'intake_sensitivity_profile_persisted',
      'sensitivity_review_queue_item_created'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_metadata_object_check
    CHECK (
      jsonb_typeof(metadata) = 'object'
      AND kai.gate_a_p0_jsonb_metadata_only(metadata)
      AND (
        operation <> 'policy_decision_compare_and_set'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_policy_status'
          AND metadata ? 'policy_decision_outcome'
          AND metadata ? 'object_version_bound'
          AND metadata ? 'verified_checksum_bound'
          AND metadata ? 'verified_size_bytes_bound'
          AND metadata ? 'declared_mime'
          AND metadata ? 'extension'
          AND metadata ? 'replay_contract_version'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'sanitized_result'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_policy_status',
            'policy_decision_outcome',
            'object_version_bound',
            'verified_checksum_bound',
            'verified_size_bytes_bound',
            'declared_mime',
            'extension',
            'replay_contract_version',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'parser_run_recorded'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'parser_name'
          AND metadata ? 'parser_version'
          AND metadata ? 'checksum_bound'
          AND metadata ? 'parser_status'
          AND metadata ? 'retry_count'
          AND metadata ? 'error_code'
          AND metadata ? 'error_message_safe'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'parser_name',
            'parser_version',
            'checksum_bound',
            'parser_status',
            'retry_count',
            'error_code',
            'error_message_safe',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'file_profile_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'parser_name'
          AND metadata ? 'parser_version'
          AND metadata ? 'checksum_bound'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'profile'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'parser_name',
            'parser_version',
            'checksum_bound',
            'profile_canonical_sha256',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'data_dictionary_draft_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'dictionary_status'
          AND metadata ? 'field_count'
          AND metadata ? 'mapping_count'
          AND metadata ? 'finding_count'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'profile'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_profile_id',
            'profile_canonical_sha256',
            'dictionary_status',
            'field_count',
            'mapping_count',
            'finding_count',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'intake_sensitivity_profile_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'file_profile_id'
          AND metadata ? 'data_dictionary_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'human_review_required'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'file_profile_id',
            'data_dictionary_id',
            'profile_canonical_sha256',
            'human_review_required',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'sensitivity_review_queue_item_created'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'queue_type'
          AND metadata ? 'target_object_type'
          AND metadata ? 'target_object_id'
          AND metadata ? 'queue_status'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'queue_type',
            'target_object_type',
            'target_object_id',
            'queue_status',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
    );

COMMIT;
