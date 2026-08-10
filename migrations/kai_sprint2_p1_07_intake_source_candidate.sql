BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.intake_file_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_file_profiles is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.data_dictionaries') IS NULL THEN
    RAISE EXCEPTION 'kai.data_dictionaries is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.intake_sensitivity_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P1-07 intake-source-candidate migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'intake_file_profiles'
       AND c.conname = 'intake_file_profiles_p1_04_lineage_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_file_profiles_p1_04_lineage_unique is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'data_dictionaries'
       AND c.conname = 'data_dictionaries_p1_04_lineage_unique'
  ) THEN
    RAISE EXCEPTION 'kai.data_dictionaries_p1_04_lineage_unique is required before P1-07 intake-source-candidate migration';
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
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles_p1_05_identity_unique is required before P1-07 intake-source-candidate migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p1_06_queue_type_check'
  ) THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_type_check is required before P1-07 intake-source-candidate migration';
  END IF;
END $$;

-- P1-07 owner decision: kai.intake_sensitivity_profiles carries no unique constraint
-- that spans its own primary key together with the tenant/lineage tuple it belongs
-- to (only intake_sensitivity_profiles_p1_05_identity_unique on
-- (organization_id, file_profile_id, data_dictionary_id), which does not include the
-- id). A composite foreign key from kai.intake_source_candidates that ties its
-- intake_sensitivity_profile_id to the SAME row's organization_id/file_profile_id/
-- data_dictionary_id (rather than merely to any two independently-existing tuples)
-- requires a unique constraint on that exact 4-column set. Adding it here, in P1-07's
-- own forward migration, follows the accepted P1-06 precedent of extending an
-- earlier package's table (kai.upload_lifecycle_audit) from a later package's
-- migration without editing the earlier package's migration file. The new column
-- order is trivially unique because intake_sensitivity_profile_id is already the
-- table's primary key.
ALTER TABLE kai.intake_sensitivity_profiles
  ADD CONSTRAINT intake_sensitivity_profiles_p1_07_candidate_lineage_unique
  UNIQUE (intake_sensitivity_profile_id, organization_id, file_profile_id, data_dictionary_id);

-- P1-07 foundation table: one metadata-only, review-gated source-candidate stub per
-- committed P1-05 sensitivity/allowed-use profile. No source or source_version is
-- created here, and no column in this table can express a promoted, approved,
-- finalized, or export-ready state - candidate_status is pinned to
-- 'needs_gk_review' for this foundation package, exactly like P1-05 pinned its own
-- fail-closed columns. No currently authorized producer contract emits an explicit
-- source-type classification (fresh inspection of the repository found none), so
-- proposed_source_type is pinned to the existing repository-authorized 'unknown'
-- representation rather than fabricated to satisfy a non-null column; a later,
-- separately authorized package may loosen this pin once a real producer contract
-- exists.
CREATE TABLE IF NOT EXISTS kai.intake_source_candidates (
  intake_source_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  data_dictionary_id uuid NOT NULL,
  intake_sensitivity_profile_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL,

  proposed_source_type text NOT NULL DEFAULT 'unknown',
  candidate_status text NOT NULL DEFAULT 'needs_gk_review',

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intake_source_candidates_p1_07_identity_unique
    UNIQUE (organization_id, intake_sensitivity_profile_id),
  CONSTRAINT intake_source_candidates_p1_07_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_p1_07_profile_lineage_fk
    FOREIGN KEY (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_p1_07_dictionary_lineage_fk
    FOREIGN KEY (data_dictionary_id, organization_id, intake_file_id, file_profile_id)
    REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id, intake_file_id, file_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_p1_07_sensitivity_lineage_fk
    FOREIGN KEY (intake_sensitivity_profile_id, organization_id, file_profile_id, data_dictionary_id)
    REFERENCES kai.intake_sensitivity_profiles (intake_sensitivity_profile_id, organization_id, file_profile_id, data_dictionary_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_p1_07_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT intake_source_candidates_p1_07_proposed_source_type_check
    CHECK (proposed_source_type = 'unknown'),
  CONSTRAINT intake_source_candidates_p1_07_candidate_status_check
    CHECK (candidate_status = 'needs_gk_review'),
  CONSTRAINT intake_source_candidates_p1_07_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_intake_source_candidates_p1_07_tenant_file
  ON kai.intake_source_candidates (organization_id, intake_file_id);

CREATE INDEX IF NOT EXISTS ix_intake_source_candidates_p1_07_sensitivity_profile
  ON kai.intake_source_candidates (intake_sensitivity_profile_id);

-- P1-07 idempotency identity for the 'source_candidate_review' queue_type only: a
-- partial unique index, not a table-wide constraint, so every other queue_type
-- already sharing kai.review_queue_items keeps its own legitimate cardinality
-- unmodified. This mirrors the P1-06 precedent exactly
-- (ux_review_queue_items_p1_06_sensitivity_review_identity) and is added through
-- this forward migration only; the accepted P1-06 migration is not edited.
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_queue_items_p1_07_source_candidate_review_identity
  ON kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id)
  WHERE queue_type = 'source_candidate_review';

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
      'intake_source_candidate_persisted'
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
    );

COMMIT;
