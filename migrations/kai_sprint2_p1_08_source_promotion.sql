BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.intake_source_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_source_candidates is required before P1-08 source-promotion migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P1-08 source-promotion migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-08 source-promotion migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-08 source-promotion migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_source_candidates'
       AND c.conname = 'intake_source_candidates_p1_07_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_source_candidates_p1_07_identity_unique is required before P1-08 source-promotion migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p1_06_queue_status_check'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_status_check is required before P1-08 source-promotion migration';
  END IF;
END $$;

-- P1-08 owner decision: kai.intake_source_candidates.candidate_status is widened
-- from its P1-07 single-value pin ('needs_gk_review' only) to also accept
-- 'promoted', following the accepted P1-07 precedent of widening an earlier
-- package's CHECK-pinned vocabulary through a later package's forward migration
-- (P1-07 did this to the shared kai.upload_lifecycle_audit operation/metadata
-- CHECKs) rather than editing the accepted P1-07 migration file. No other value is
-- added. kai.review_queue_items.queue_status and review_status already include
-- 'resolved' in the accepted P1-06 vocabulary, so this package widens no
-- review_queue_items CHECK constraint.
ALTER TABLE kai.intake_source_candidates
  DROP CONSTRAINT IF EXISTS intake_source_candidates_p1_07_candidate_status_check,
  ADD CONSTRAINT intake_source_candidates_p1_07_candidate_status_check
    CHECK (candidate_status IN ('needs_gk_review', 'promoted'));

-- P1-08 owner decision: two new unique constraints on kai.intake_source_candidates,
-- added here for the same reason P1-07 added
-- intake_sensitivity_profiles_p1_07_candidate_lineage_unique to kai.intake_sensitivity_profiles
-- from its own forward migration - a composite foreign key from a P1-08 table
-- tying its columns to the SAME candidate row's tenant/lineage tuple requires a
-- unique constraint on that exact column set, and intake_source_candidate_id alone
-- (the table's primary key) is not a matching set for either FK below. Both are
-- trivially unique because intake_source_candidate_id is already the primary key.
ALTER TABLE kai.intake_source_candidates
  ADD CONSTRAINT intake_source_candidates_p1_08_identity_unique
    UNIQUE (intake_source_candidate_id, organization_id);

ALTER TABLE kai.intake_source_candidates
  ADD CONSTRAINT intake_source_candidates_p1_08_promotion_lineage_unique
    UNIQUE (intake_source_candidate_id, organization_id, intake_sensitivity_profile_id, profile_canonical_sha256);

-- Same reasoning applied to kai.review_queue_items: review_queue_item_id is already
-- the primary key, so this additional two-column unique constraint is trivially
-- unique and exists only to be the exact matching target of the composite foreign
-- key added below on kai.intake_promotion_decisions. Added through this forward
-- migration only; the accepted P1-06 migration file is not edited.
ALTER TABLE kai.review_queue_items
  ADD CONSTRAINT review_queue_items_p1_08_identity_unique
    UNIQUE (review_queue_item_id, organization_id);

-- P1-08 foundation table: one human-authorized promotion decision per P1-07 source
-- candidate. reviewed_source_type is the explicit, human-established
-- classification this decision itself establishes - never inferred from a
-- filename, MIME type, field name, sample value, AI output, or external lookup -
-- and is pinned to a fixed, non-'unknown' vocabulary because no currently
-- authorized upstream producer contract emits an explicit source-type
-- classification (the same absence P1-07 found and disclosed for its own
-- proposed_source_type). decision_status starts at 'decided' and this package's
-- own compound creation transitions it to 'promoted' in the same transaction,
-- binding source_id/source_version_id, once every promotion validator has passed;
-- it never observably rests at any other value from this package's own writes.
CREATE TABLE IF NOT EXISTS kai.intake_promotion_decisions (
  intake_promotion_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_source_candidate_id uuid NOT NULL,
  review_queue_item_id uuid NOT NULL,

  reviewed_source_type text NOT NULL,
  decision_status text NOT NULL DEFAULT 'decided',

  source_id uuid,
  source_version_id uuid,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,

  CONSTRAINT intake_promotion_decisions_p1_08_identity_unique
    UNIQUE (organization_id, intake_source_candidate_id),
  CONSTRAINT intake_promotion_decisions_p1_08_candidate_fk
    FOREIGN KEY (intake_source_candidate_id, organization_id)
    REFERENCES kai.intake_source_candidates (intake_source_candidate_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_promotion_decisions_p1_08_review_queue_item_fk
    FOREIGN KEY (review_queue_item_id, organization_id)
    REFERENCES kai.review_queue_items (review_queue_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_promotion_decisions_p1_08_reviewed_source_type_check
    CHECK (reviewed_source_type IN (
      'organization_primary_record',
      'organization_secondary_record',
      'third_party_provided_record',
      'public_record'
    )),
  CONSTRAINT intake_promotion_decisions_p1_08_decision_status_check
    CHECK (decision_status IN ('decided', 'promoted')),
  CONSTRAINT intake_promotion_decisions_p1_08_promoted_binding_check
    CHECK (
      (decision_status = 'decided' AND source_id IS NULL AND source_version_id IS NULL AND promoted_at IS NULL)
      OR
      (decision_status = 'promoted' AND source_id IS NOT NULL AND source_version_id IS NOT NULL AND promoted_at IS NOT NULL)
    ),
  CONSTRAINT intake_promotion_decisions_p1_08_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_intake_promotion_decisions_p1_08_tenant_candidate
  ON kai.intake_promotion_decisions (organization_id, intake_source_candidate_id);

-- P1-08 foundation table: one deterministic source identity per organization,
-- keyed by source_code - a sha256 hex digest computed only from immutable,
-- already-committed lineage facts (organization_id, intake_sensitivity_profile_id,
-- profile_canonical_sha256, reviewed_source_type). Never derived from a filename,
-- MIME type, sample value, AI output, or external lookup.
CREATE TABLE IF NOT EXISTS kai.sources (
  source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_code text NOT NULL,
  reviewed_source_type text NOT NULL,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sources_p1_08_identity_unique
    UNIQUE (organization_id, source_code),
  CONSTRAINT sources_p1_08_id_org_unique
    UNIQUE (source_id, organization_id),
  CONSTRAINT sources_p1_08_source_code_check
    CHECK (source_code ~ '^[a-f0-9]{64}$'),
  CONSTRAINT sources_p1_08_reviewed_source_type_check
    CHECK (reviewed_source_type IN (
      'organization_primary_record',
      'organization_secondary_record',
      'third_party_provided_record',
      'public_record'
    )),
  CONSTRAINT sources_p1_08_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

-- P1-08 foundation table: one source_version per promoted P1-07 candidate
-- (organization_id + intake_source_candidate_id is this package's idempotency
-- identity), with a tenant-safe composite lineage foreign key back to the exact
-- committed candidate row it was promoted from, and at most one current version
-- per source (partial unique index below). This package promotes exactly one
-- candidate into exactly one source_version; it does not implement merging
-- multiple candidates into one source's version history.
CREATE TABLE IF NOT EXISTS kai.source_versions (
  source_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  intake_source_candidate_id uuid NOT NULL,
  intake_sensitivity_profile_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT source_versions_p1_08_candidate_identity_unique
    UNIQUE (organization_id, intake_source_candidate_id),
  CONSTRAINT source_versions_p1_08_id_org_unique
    UNIQUE (source_version_id, organization_id),
  CONSTRAINT source_versions_p1_08_source_fk
    FOREIGN KEY (source_id, organization_id)
    REFERENCES kai.sources (source_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_versions_p1_08_candidate_lineage_fk
    FOREIGN KEY (intake_source_candidate_id, organization_id, intake_sensitivity_profile_id, profile_canonical_sha256)
    REFERENCES kai.intake_source_candidates (intake_source_candidate_id, organization_id, intake_sensitivity_profile_id, profile_canonical_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT source_versions_p1_08_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_source_versions_p1_08_current_per_source
  ON kai.source_versions (source_id)
  WHERE is_current = true;

ALTER TABLE kai.intake_promotion_decisions
  ADD CONSTRAINT intake_promotion_decisions_p1_08_source_fk
    FOREIGN KEY (source_id, organization_id)
    REFERENCES kai.sources (source_id, organization_id)
    ON DELETE RESTRICT;

ALTER TABLE kai.intake_promotion_decisions
  ADD CONSTRAINT intake_promotion_decisions_p1_08_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT;

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
      'source_promotion_decision_persisted'
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
    );

COMMIT;
