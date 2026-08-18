BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before P2-05 conflict-review-candidate migration';
  END IF;
  IF to_regclass('kai.gap_log_items') IS NULL THEN
    RAISE EXCEPTION 'kai.gap_log_items is required before P2-05 conflict-review-candidate migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-05 conflict-review-candidate migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-05 conflict-review-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-05 conflict-review-candidate migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.conflict_groups (
  conflict_group_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lower_claim_id uuid NOT NULL,
  higher_claim_id uuid NOT NULL,
  lower_claim_conflict_gap_id uuid NOT NULL,
  higher_claim_conflict_gap_id uuid NOT NULL,
  basis_code text NOT NULL,
  safe_summary text NOT NULL,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT conflict_groups_p2_05_identity_unique
    UNIQUE (organization_id, lower_claim_id, higher_claim_id),
  CONSTRAINT conflict_groups_p2_05_id_org_unique
    UNIQUE (conflict_group_id, organization_id),
  CONSTRAINT conflict_groups_p2_05_lower_claim_fk
    FOREIGN KEY (lower_claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT conflict_groups_p2_05_higher_claim_fk
    FOREIGN KEY (higher_claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT conflict_groups_p2_05_lower_gap_fk
    FOREIGN KEY (lower_claim_conflict_gap_id, organization_id)
    REFERENCES kai.gap_log_items (gap_log_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT conflict_groups_p2_05_higher_gap_fk
    FOREIGN KEY (higher_claim_conflict_gap_id, organization_id)
    REFERENCES kai.gap_log_items (gap_log_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT conflict_groups_p2_05_claim_order_check
    CHECK (lower_claim_id < higher_claim_id),
  CONSTRAINT conflict_groups_p2_05_basis_code_check
    CHECK (basis_code = 'human_selected_unresolved_comparison'),
  CONSTRAINT conflict_groups_p2_05_safe_summary_check
    CHECK (safe_summary = 'Potential claim conflict requires GK review.'),
  CONSTRAINT conflict_groups_p2_05_created_by_type_check
    CHECK (created_by_type = 'system')
);

CREATE INDEX IF NOT EXISTS ix_conflict_groups_p2_05_tenant_pair
  ON kai.conflict_groups (organization_id, lower_claim_id, higher_claim_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p2_05_conflict_resolution_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'conflict_resolution';

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p2_05_conflict_resolution_contract_check,
  ADD CONSTRAINT review_queue_items_p2_05_conflict_resolution_contract_check
    CHECK (
      queue_type <> 'conflict_resolution'
      OR (
        target_object_type = 'conflict_group'
        AND queue_status = 'open'
        AND review_status = 'needs_gk_review'
        AND priority = 'medium'
        AND summary = 'Potential claim conflict requires GK review.'
        AND required_action = 'Compare both claims, their evidence lineage, definitions, reporting periods, entity levels, denominators, and support limitations. Record whether a conflict exists. Do not approve or promote either claim.'
        AND assigned_to IS NULL
        AND due_at IS NULL
      )
    );

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
      'sensitivity_review_queue_item_created',
      'intake_source_candidate_persisted',
      'source_promotion_decision_persisted',
      'evidence_lineage_extracted',
      'claim_proposed',
      'claim_gap_and_followup_generated',
      'conflict_review_candidate_created'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_05_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p2_05_metadata_object_check
    CHECK (
      operation <> 'conflict_review_candidate_created'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'conflict_group_id'
        AND metadata ? 'lower_claim_id'
        AND metadata ? 'higher_claim_id'
        AND metadata ? 'lower_claim_conflict_gap_id'
        AND metadata ? 'higher_claim_conflict_gap_id'
        AND metadata ? 'basis_code'
        AND metadata ? 'queue_type'
        AND metadata ? 'queue_status'
        AND metadata ? 'review_status'
        AND metadata ? 'review_queue_item_count'
        AND metadata ? 'fresh_write_count'
        AND metadata ? 'replayed'
        AND metadata ? 'validator_key'
        AND NOT metadata ? 'claim_text'
        AND NOT metadata ? 'claim_statement'
        AND NOT metadata ? 'statement'
        AND NOT metadata ? 'evidence_text'
        AND NOT metadata ? 'gap_summary'
        AND NOT metadata ? 'filename'
        AND NOT metadata ? 'raw_content'
        AND NOT metadata ? 'sample'
        AND NOT metadata ? 'storage_uri'
        AND NOT metadata ? 'storage_bucket'
        AND NOT metadata ? 'storage_object_key'
        AND NOT metadata ? 'object_key'
        AND NOT metadata ? 'signed_url'
        AND NOT metadata ? 'prompt'
        AND NOT metadata ? 'credential'
        AND NOT metadata ? 'conflict_status'
        AND NOT metadata ? 'resolution_status'
        AND NOT metadata ? 'confidence'
        AND NOT metadata ? 'asserted_conflict'
        AND NOT metadata ? 'conflict_exists'
        AND metadata - ARRAY[
          'metadata_only',
          'contract',
          'conflict_group_id',
          'lower_claim_id',
          'higher_claim_id',
          'lower_claim_conflict_gap_id',
          'higher_claim_conflict_gap_id',
          'basis_code',
          'queue_type',
          'queue_status',
          'review_status',
          'review_queue_item_count',
          'fresh_write_count',
          'replayed',
          'validator_key'
        ] = '{}'::jsonb
      )
    );

COMMIT;
