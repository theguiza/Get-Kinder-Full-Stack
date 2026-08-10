BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.source_versions') IS NULL THEN
    RAISE EXCEPTION 'kai.source_versions is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.sources') IS NULL THEN
    RAISE EXCEPTION 'kai.sources is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.intake_source_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_source_candidates is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.intake_promotion_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_promotion_decisions is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.intake_sensitivity_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.data_dictionaries') IS NULL THEN
    RAISE EXCEPTION 'kai.data_dictionaries is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.data_dictionary_fields') IS NULL THEN
    RAISE EXCEPTION 'kai.data_dictionary_fields is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-01 evidence-lineage migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-01 evidence-lineage migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-01 evidence-lineage migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'source_versions'
       AND c.conname = 'source_versions_p1_08_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.source_versions_p1_08_id_org_unique is required before P2-01 evidence-lineage migration';
  END IF;
END $$;

-- P2-01 foundation table: one row per exact committed coordinate a locator was
-- created for. This package's own extractor only ever creates the 'column'
-- coordinate kind - the per-field profile_field_key of an already-committed
-- kai.data_dictionary_fields row - because that is the only exact, already-
-- committed, non-fabricated coordinate available from upstream metadata without
-- reading raw file content. Sheet/row/paragraph/section/page/cell-range coordinates
-- are not implemented in this package because no currently committed upstream
-- metadata source supplies them; this package never fabricates the missing ones,
-- so locator_type is pinned to a single value rather than widened to a vocabulary
-- this package cannot actually produce.
CREATE TABLE IF NOT EXISTS kai.source_locators (
  source_locator_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  locator_type text NOT NULL,
  coordinates jsonb NOT NULL,
  locator_fingerprint text NOT NULL,

  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_locators_p2_01_identity_unique
    UNIQUE (organization_id, source_version_id, locator_fingerprint),
  CONSTRAINT source_locators_p2_01_id_org_unique
    UNIQUE (source_locator_id, organization_id),
  CONSTRAINT source_locators_p2_01_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_locators_p2_01_locator_type_check
    CHECK (locator_type = 'column'),
  CONSTRAINT source_locators_p2_01_coordinates_check
    CHECK (
      jsonb_typeof(coordinates) = 'object'
      AND coordinates ? 'column_name'
      AND coordinates - ARRAY['column_name'] = '{}'::jsonb
      AND jsonb_typeof(coordinates->'column_name') = 'string'
    ),
  CONSTRAINT source_locators_p2_01_fingerprint_check
    CHECK (locator_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT source_locators_p2_01_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_source_locators_p2_01_tenant_version
  ON kai.source_locators (organization_id, source_version_id);

-- P2-01C correction: the migration originally accepted an unlocated
-- 'dictionary_field_count_fact' aggregate evidence type with no source_locator_id.
-- That vocabulary value and its locator-optional shape are removed entirely - this
-- package now creates only 'dictionary_field_presence_fact' evidence, and every row
-- carries a non-null source_locator_id, a non-null source_id, and a
-- sensitivity_level copied verbatim from the authoritative
-- kai.data_dictionary_fields.sensitivity value it was derived from.

-- P2-01C correction: kai.source_versions was created by P1-08 with only a
-- two-column (source_version_id, organization_id) unique constraint - insufficient
-- to prove, by foreign key alone, that a given source_version_id actually belongs
-- to a given source_id within a given organization_id. This three-column unique
-- constraint is the target of evidence_items_p2_01_source_version_fk below; it adds
-- no new column and narrows no existing behavior of the accepted P1-08 table. Added
-- here, before kai.evidence_items, because the foreign key below depends on it.
ALTER TABLE kai.source_versions
  DROP CONSTRAINT IF EXISTS source_versions_p2_01_id_source_org_unique,
  ADD CONSTRAINT source_versions_p2_01_id_source_org_unique
    UNIQUE (source_version_id, source_id, organization_id);

-- P2-01 foundation table: one row per deterministic evidence statement, derived
-- only from already-committed kai.data_dictionary_fields rows bound to the current
-- source_version's promoted lineage, each row bound to its exact committed column
-- coordinate. organization_id + source_id + source_version_id is enforced as one
-- tenant-safe lineage tuple by a single composite foreign key
-- (evidence_items_p2_01_source_version_fk) against
-- source_versions_p2_01_id_source_org_unique below - never by independent
-- source_id/source_version_id foreign keys, which could not by themselves prove the
-- stored source_version belongs to the stored source and organization. Every
-- governance/allowed-use column below is fail-closed-pinned exactly like P1-04/
-- P1-05's own fail-closed defaults: this package creates internal-only, GK-review-
-- gated evidence and grants no public, funder, LLM-processing, or product-learning
-- use.
CREATE TABLE IF NOT EXISTS kai.evidence_items (
  evidence_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_locator_id uuid NOT NULL,
  evidence_type text NOT NULL,
  data_class text NOT NULL,
  sensitivity_level text NOT NULL,
  support_strength text NOT NULL,
  statement text NOT NULL,
  statement_fingerprint text NOT NULL,

  evidence_review_status text NOT NULL DEFAULT 'needs_gk_review',
  internal_only boolean NOT NULL DEFAULT true,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  llm_processing_allowed boolean NOT NULL DEFAULT false,
  product_learning_allowed boolean NOT NULL DEFAULT false,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidence_items_p2_01_identity_unique
    UNIQUE (organization_id, source_version_id, statement_fingerprint),
  CONSTRAINT evidence_items_p2_01_id_org_unique
    UNIQUE (evidence_item_id, organization_id),
  CONSTRAINT evidence_items_p2_01_source_version_fk
    FOREIGN KEY (source_version_id, source_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, source_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_items_p2_01_source_locator_fk
    FOREIGN KEY (source_locator_id, organization_id)
    REFERENCES kai.source_locators (source_locator_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_items_p2_01_evidence_type_check
    CHECK (evidence_type = 'dictionary_field_presence_fact'),
  CONSTRAINT evidence_items_p2_01_data_class_check
    CHECK (data_class = 'organization_committed_metadata'),
  CONSTRAINT evidence_items_p2_01_sensitivity_level_check
    CHECK (sensitivity_level = 'unknown'),
  CONSTRAINT evidence_items_p2_01_support_strength_check
    CHECK (support_strength = 'unassessed'),
  CONSTRAINT evidence_items_p2_01_statement_check
    CHECK (
      length(statement) BETWEEN 1 AND 500
      AND statement !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    ),
  CONSTRAINT evidence_items_p2_01_statement_fingerprint_check
    CHECK (statement_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_items_p2_01_review_status_check
    CHECK (evidence_review_status = 'needs_gk_review'),
  CONSTRAINT evidence_items_p2_01_internal_only_check
    CHECK (internal_only = true),
  CONSTRAINT evidence_items_p2_01_public_use_check
    CHECK (public_use_allowed = false),
  CONSTRAINT evidence_items_p2_01_funder_use_check
    CHECK (funder_use_allowed = false),
  CONSTRAINT evidence_items_p2_01_llm_processing_check
    CHECK (llm_processing_allowed = false),
  CONSTRAINT evidence_items_p2_01_product_learning_check
    CHECK (product_learning_allowed = false),
  CONSTRAINT evidence_items_p2_01_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_evidence_items_p2_01_tenant_version
  ON kai.evidence_items (organization_id, source_version_id);

-- P2-01 idempotency identity for the 'evidence_review' queue_type only: a partial
-- unique index, not a table-wide constraint, mirroring the P1-06/P1-07 precedent
-- exactly (ux_review_queue_items_p1_06_sensitivity_review_identity,
-- ux_review_queue_items_p1_07_source_candidate_review_identity). 'evidence_review'
-- was already an accepted queue_type value in the P1-06 migration, unused until
-- this package. target_object_type for these rows is the literal
-- 'evidence_item'; target_object_id is the evidence_item_id.
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p2_01_evidence_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'evidence_review';

-- P2-01C correction: mirrors the exact P1-06 sensitivity_review required_action
-- precedent (see migrations/kai_sprint2_p1_06_review_queue.sql), for the
-- 'evidence_review' queue_type only. required_action must be present, non-blank,
-- and within the already-established table-wide 1-2000 character bound
-- (review_queue_items_p1_06_required_action_check) - no other queue_type is
-- affected.
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_p2_01_evidence_review_required_action_check,
  ADD CONSTRAINT review_queue_items_p2_01_evidence_review_required_action_check
    CHECK (
      queue_type <> 'evidence_review'
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
      'evidence_lineage_extracted'
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
    );

COMMIT;
