BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before P2-03 claim-proposal migration';
  END IF;
  IF to_regclass('kai.source_locators') IS NULL THEN
    RAISE EXCEPTION 'kai.source_locators is required before P2-03 claim-proposal migration';
  END IF;
  IF to_regclass('kai.intake_source_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_source_candidates is required before P2-03 claim-proposal migration';
  END IF;
  IF to_regclass('kai.intake_promotion_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_promotion_decisions is required before P2-03 claim-proposal migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-03 claim-proposal migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-03 claim-proposal migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-03 claim-proposal migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'evidence_items'
       AND c.conname = 'evidence_items_p2_01_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.evidence_items_p2_01_id_org_unique is required before P2-03 claim-proposal migration';
  END IF;
END $$;

-- P2-03 foundation table: one row per proposed, internal-only, GK-review-gated
-- claim, deterministically derived only from exactly one already-committed P2-01
-- kai.evidence_items row's own locator coordinates - never from the evidence
-- item's own `statement` text (which could smuggle a different evidence_type's
-- semantics into the claim), never from caller-supplied text, and never from raw
-- file content or a sample value. claim_type/claim_status/claim_review_status/
-- claim_strength and every audience-gate boolean below are pinned to a single
-- fail-closed value each, mirroring the exact P2-01 evidence_items governance
-- idiom: this package proposes internal, unsupported-until-reviewed findings only
-- and grants no public, funder, LLM-processing, product-learning, or export use.
CREATE TABLE IF NOT EXISTS kai.claims (
  claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  claim_type text NOT NULL,
  claim_status text NOT NULL,
  claim_review_status text NOT NULL,
  claim_strength text NOT NULL,
  statement text NOT NULL,
  statement_fingerprint text NOT NULL,

  internal_only boolean NOT NULL DEFAULT true,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  llm_processing_allowed boolean NOT NULL DEFAULT false,
  product_learning_allowed boolean NOT NULL DEFAULT false,
  export_ready boolean NOT NULL DEFAULT false,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT claims_p2_03_identity_unique
    UNIQUE (organization_id, evidence_item_id, claim_type),
  CONSTRAINT claims_p2_03_id_org_unique
    UNIQUE (claim_id, organization_id),
  CONSTRAINT claims_p2_03_evidence_item_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT claims_p2_03_claim_type_check
    CHECK (claim_type = 'finding'),
  CONSTRAINT claims_p2_03_claim_status_check
    CHECK (claim_status = 'proposed'),
  CONSTRAINT claims_p2_03_claim_review_status_check
    CHECK (claim_review_status = 'needs_gk_review'),
  CONSTRAINT claims_p2_03_claim_strength_check
    CHECK (claim_strength = 'unassessed'),
  CONSTRAINT claims_p2_03_statement_check
    CHECK (
      length(statement) BETWEEN 1 AND 500
      AND statement !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    ),
  CONSTRAINT claims_p2_03_statement_fingerprint_check
    CHECK (statement_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT claims_p2_03_internal_only_check
    CHECK (internal_only = true),
  CONSTRAINT claims_p2_03_public_use_check
    CHECK (public_use_allowed = false),
  CONSTRAINT claims_p2_03_funder_use_check
    CHECK (funder_use_allowed = false),
  CONSTRAINT claims_p2_03_llm_processing_check
    CHECK (llm_processing_allowed = false),
  CONSTRAINT claims_p2_03_product_learning_check
    CHECK (product_learning_allowed = false),
  CONSTRAINT claims_p2_03_export_ready_check
    CHECK (export_ready = false),
  CONSTRAINT claims_p2_03_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_claims_p2_03_tenant_evidence
  ON kai.claims (organization_id, evidence_item_id);

-- P2-03 foundation table: canonical claim-to-evidence links, kept as its own
-- standalone junction table (rather than relying solely on kai.claims'
-- evidence_item_id column) because "canonical claim-to-evidence links" is listed
-- as its own distinct deliverable from "canonical claims persistence" - today's
-- cardinality is always exactly one link per claim (see
-- claim_evidence_links_p2_03_one_link_per_claim_unique below), and this package
-- adds no column or feature that would allow more than one; a later package may
-- extend claims to multiple evidence items without a schema migration of this
-- table's shape.
CREATE TABLE IF NOT EXISTS kai.claim_evidence_links (
  claim_evidence_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,

  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT claim_evidence_links_p2_03_identity_unique
    UNIQUE (organization_id, claim_id, evidence_item_id),
  CONSTRAINT claim_evidence_links_p2_03_one_link_per_claim_unique
    UNIQUE (organization_id, claim_id),
  CONSTRAINT claim_evidence_links_p2_03_id_org_unique
    UNIQUE (claim_evidence_link_id, organization_id),
  CONSTRAINT claim_evidence_links_p2_03_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT claim_evidence_links_p2_03_evidence_item_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT claim_evidence_links_p2_03_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_claim_evidence_links_p2_03_tenant_claim
  ON kai.claim_evidence_links (organization_id, claim_id);

-- P2-03 idempotency identity for the 'claim_review' queue_type only: a partial
-- unique index, not a table-wide constraint, mirroring the P1-06/P2-01 precedent
-- exactly (ux_review_queue_items_p1_06_sensitivity_review_identity,
-- ux_review_queue_items_p2_01_evidence_review_identity). 'claim_review' was
-- already an accepted queue_type value in the P1-06 migration, unused until this
-- package. target_object_type for these rows is the literal 'claim';
-- target_object_id is the claim_id.
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p2_03_claim_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'claim_review';

-- Mirrors the exact P1-06/P2-01 required_action precedent, for the
-- 'claim_review' queue_type only. required_action must be present, non-blank,
-- and within the already-established table-wide 1-2000 character bound
-- (review_queue_items_p1_06_required_action_check) - no other queue_type is
-- affected.
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p2_03_claim_review_required_action_check,
  ADD CONSTRAINT review_queue_items_p2_03_claim_review_required_action_check
    CHECK (
      queue_type <> 'claim_review'
      OR (
        required_action IS NOT NULL
        AND length(btrim(required_action)) BETWEEN 1 AND 2000
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
      'claim_proposed'
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
      AND (
        operation <> 'intake_source_candidate_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'intake_sensitivity_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'proposed_source_type'
          AND metadata ? 'candidate_status'
          AND metadata ? 'queue_type'
          AND metadata ? 'target_object_type'
          AND metadata ? 'target_object_id'
          AND metadata ? 'queue_status'
          AND metadata ? 'validator_key'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'intake_sensitivity_profile_id',
            'profile_canonical_sha256',
            'proposed_source_type',
            'candidate_status',
            'queue_type',
            'target_object_type',
            'target_object_id',
            'queue_status',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'source_promotion_decision_persisted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'intake_source_candidate_id'
          AND metadata ? 'intake_sensitivity_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'reviewed_source_type'
          AND metadata ? 'decision_status'
          AND metadata ? 'candidate_status'
          AND metadata ? 'queue_status'
          AND metadata ? 'source_id'
          AND metadata ? 'source_version_id'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'storage_uri'
          AND NOT metadata ? 'signed_url'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'intake_source_candidate_id',
            'intake_sensitivity_profile_id',
            'profile_canonical_sha256',
            'reviewed_source_type',
            'decision_status',
            'candidate_status',
            'queue_status',
            'source_id',
            'source_version_id',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'evidence_lineage_extracted'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'source_version_id'
          AND metadata ? 'intake_sensitivity_profile_id'
          AND metadata ? 'profile_canonical_sha256'
          AND metadata ? 'evidence_item_count'
          AND metadata ? 'source_locator_count'
          AND metadata ? 'review_queue_item_count'
          AND metadata ? 'fresh_write_count'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'statement'
          AND NOT metadata ? 'statement_fingerprint'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'source_version_id',
            'intake_sensitivity_profile_id',
            'profile_canonical_sha256',
            'evidence_item_count',
            'source_locator_count',
            'review_queue_item_count',
            'fresh_write_count',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
      AND (
        operation <> 'claim_proposed'
        OR (
          metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'evidence_item_id'
          AND metadata ? 'claim_id'
          AND metadata ? 'claim_type'
          AND metadata ? 'claim_status'
          AND metadata ? 'claim_review_status'
          AND metadata ? 'requirement_coverage_status'
          AND metadata ? 'warning_count'
          AND metadata ? 'review_queue_item_count'
          AND metadata ? 'fresh_write_count'
          AND metadata ? 'validator_key'
          AND NOT metadata ? 'claim_statement'
          AND metadata - ARRAY[
            'metadata_only',
            'contract',
            'evidence_item_id',
            'claim_id',
            'claim_type',
            'claim_status',
            'claim_review_status',
            'requirement_coverage_status',
            'warning_count',
            'review_queue_item_count',
            'fresh_write_count',
            'validator_key'
          ] = '{}'::jsonb
        )
      )
    );

COMMIT;
