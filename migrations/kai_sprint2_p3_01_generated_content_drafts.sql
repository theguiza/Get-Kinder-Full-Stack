BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before P3-01 generated-content migration';
  END IF;
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before P3-01 generated-content migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P3-01 generated-content migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P3-01 generated-content migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.generation_runs (
  generation_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL,
  content_type text NOT NULL,
  requested_audience text NOT NULL,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generation_runs_p3_01_identity_unique
    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT generation_runs_p3_01_id_org_unique
    UNIQUE (generation_run_id, organization_id),
  CONSTRAINT generation_runs_p3_01_fingerprint_check
    CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT generation_runs_p3_01_content_type_check
    CHECK (content_type = 'evidence_summary'),
  CONSTRAINT generation_runs_p3_01_requested_audience_check
    CHECK (requested_audience IN ('internal', 'funder', 'public')),
  CONSTRAINT generation_runs_p3_01_created_by_type_check
    CHECK (created_by_type = 'system')
);

CREATE TABLE IF NOT EXISTS kai.generated_content_drafts (
  generated_content_draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_run_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  content_type text NOT NULL,
  requested_audience text NOT NULL,
  draft_status text NOT NULL DEFAULT 'draft',
  review_status text NOT NULL DEFAULT 'needs_gk_review',
  validator_results jsonb NOT NULL,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generated_content_drafts_p3_01_run_unique
    UNIQUE (organization_id, generation_run_id),
  CONSTRAINT generated_content_drafts_p3_01_id_org_unique
    UNIQUE (generated_content_draft_id, organization_id),
  CONSTRAINT generated_content_drafts_p3_01_run_fk
    FOREIGN KEY (generation_run_id, organization_id)
    REFERENCES kai.generation_runs (generation_run_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT generated_content_drafts_p3_01_content_type_check
    CHECK (content_type = 'evidence_summary'),
  CONSTRAINT generated_content_drafts_p3_01_requested_audience_check
    CHECK (requested_audience IN ('internal', 'funder', 'public')),
  CONSTRAINT generated_content_drafts_p3_01_draft_status_check
    CHECK (draft_status = 'draft'),
  CONSTRAINT generated_content_drafts_p3_01_review_status_check
    CHECK (review_status = 'needs_gk_review'),
  CONSTRAINT generated_content_drafts_p3_01_validator_results_check
    CHECK (jsonb_typeof(validator_results) = 'array'),
  CONSTRAINT generated_content_drafts_p3_01_created_by_type_check
    CHECK (created_by_type = 'system')
);

CREATE TABLE IF NOT EXISTS kai.generated_content_blocks (
  generated_content_block_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_content_draft_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  ordinal integer NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generated_content_blocks_p3_01_identity_unique
    UNIQUE (generated_content_draft_id, ordinal),
  CONSTRAINT generated_content_blocks_p3_01_id_org_unique
    UNIQUE (generated_content_block_id, organization_id),
  CONSTRAINT generated_content_blocks_p3_01_draft_fk
    FOREIGN KEY (generated_content_draft_id, organization_id)
    REFERENCES kai.generated_content_drafts (generated_content_draft_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT generated_content_blocks_p3_01_ordinal_check
    CHECK (ordinal BETWEEN 1 AND 20),
  CONSTRAINT generated_content_blocks_p3_01_text_check
    CHECK (length(text) BETWEEN 1 AND 4000)
);

CREATE TABLE IF NOT EXISTS kai.generated_content_citations (
  generated_content_citation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_content_block_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generated_content_citations_p3_01_identity_unique
    UNIQUE (generated_content_block_id, claim_id, evidence_item_id),
  CONSTRAINT generated_content_citations_p3_01_block_fk
    FOREIGN KEY (generated_content_block_id, organization_id)
    REFERENCES kai.generated_content_blocks (generated_content_block_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT generated_content_citations_p3_01_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT generated_content_citations_p3_01_evidence_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p3_01_generated_content_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'generated_content_review';

ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p3_01_generated_content_review_contract_check,
  ADD CONSTRAINT review_queue_items_p3_01_generated_content_review_contract_check
    CHECK (
      queue_type <> 'generated_content_review'
      OR (
        target_object_type = 'generated_content_draft'
        AND queue_status = 'open'
        AND review_status = 'needs_gk_review'
        AND priority = 'medium'
        AND summary = 'Generated draft requires human review.'
        AND required_action = 'Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.'
        AND assigned_to IS NULL
        AND due_at IS NULL
        AND created_by_type = 'system'
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
      'conflict_review_candidate_created',
      'generated_content_draft_created'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_01_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p3_01_metadata_object_check
    CHECK (
      operation <> 'generated_content_draft_created'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'generation_run_id'
        AND metadata ? 'generated_content_draft_id'
        AND metadata ? 'queue_type'
        AND metadata ? 'queue_status'
        AND metadata ? 'review_status'
        AND metadata ? 'requested_audience'
        AND metadata ? 'claim_count'
        AND metadata ? 'block_count'
        AND metadata ? 'validator_keys'
        AND NOT metadata ? 'actor_user_id'
        AND NOT metadata ? 'claim_text'
        AND NOT metadata ? 'claim_statement'
        AND NOT metadata ? 'block_text'
        AND NOT metadata ? 'prompt'
        AND NOT metadata ? 'raw_content'
        AND NOT metadata ? 'source_text'
        AND NOT metadata ? 'generated_text'
        AND metadata - ARRAY[
          'metadata_only',
          'contract',
          'generation_run_id',
          'generated_content_draft_id',
          'queue_type',
          'queue_status',
          'review_status',
          'requested_audience',
          'claim_count',
          'block_count',
          'validator_keys'
        ] = '{}'::jsonb
      )
    );

COMMIT;
