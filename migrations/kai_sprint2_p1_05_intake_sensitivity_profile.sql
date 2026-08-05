BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF to_regclass('kai.intake_file_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_file_profiles is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF to_regclass('kai.data_dictionaries') IS NULL THEN
    RAISE EXCEPTION 'kai.data_dictionaries is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-05 intake-sensitivity-profile migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-05 intake-sensitivity-profile migration';
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
    RAISE EXCEPTION 'kai.intake_file_profiles_p1_04_lineage_unique is required before P1-05 intake-sensitivity-profile migration';
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
    RAISE EXCEPTION 'kai.data_dictionaries_p1_04_lineage_unique is required before P1-05 intake-sensitivity-profile migration';
  END IF;
END $$;

-- P1-05 owner decision: one authoritative sensitivity/allowed-use profile row per
-- organization_id + file_profile_id + data_dictionary_id. This is the foundation table
-- and schema/repository/service scaffold only: every dimension below is a fail-closed
-- 'unknown' placeholder. No currently authorized profiler, validator, review service, or
-- producer contract emits a classification, consent, sensitivity, or permission fact, so
-- this package never reads kai.intake_file_profiles.profile (machine-generated profiling
-- metadata, not authoritative classification or consent input) or infers a dimension from
-- raw content, filenames, field names, or absence. No column here executes retention,
-- deletes data, changes storage lifecycle, activates a job, or grants any approval or
-- external-release authority. review_status/review_requirements are not persisted:
-- the only committed fact about review is the fail-closed human_review_required flag.
CREATE TABLE IF NOT EXISTS kai.intake_sensitivity_profiles (
  intake_sensitivity_profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  data_dictionary_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL,

  -- Phase 5 semantic dimensions. Each is its own column and its own 3-state
  -- (or allowed/not_allowed/unknown) CHECK-enforced enum. 'unknown' is a real,
  -- distinct, queryable value: it never collapses into false/absent/clear/safe/
  -- permitted/not-applicable. Every dimension defaults to 'unknown' and is replaced
  -- only when the repository-loaded committed profile lineage states an explicit
  -- safe fact for that exact dimension.
  pii_status text NOT NULL DEFAULT 'unknown',
  minor_data_status text NOT NULL DEFAULT 'unknown',
  health_housing_justice_immigration_status text NOT NULL DEFAULT 'unknown',
  indigenous_governance_status text NOT NULL DEFAULT 'unknown',
  staff_notes_status text NOT NULL DEFAULT 'unknown',
  story_testimonial_status text NOT NULL DEFAULT 'unknown',
  small_cell_risk_status text NOT NULL DEFAULT 'unknown',
  financial_records_status text NOT NULL DEFAULT 'unknown',
  consent_basis_status text NOT NULL DEFAULT 'unknown',
  allowed_use_status text NOT NULL DEFAULT 'unknown',

  -- Enforced fail-closed restrictions for this foundation package: unconditional
  -- pinned values, exactly like P1-04's own per-field CHECK (x = 'fixed_value')
  -- idiom. These are restrictions this package enforces, not approvals or completed
  -- classifications: public/funder/LLM/product-learning use is never permitted here,
  -- and human review is always still required.
  llm_processing_allowed boolean NOT NULL DEFAULT false,
  product_learning_allowed boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  human_review_required boolean NOT NULL DEFAULT true,

  -- Retention posture is a labeled restriction/unresolved-state fact only - never a
  -- retention execution, deletion, lifecycle change, or job activation. Pinned to a
  -- single fail-closed value for this foundation package, exactly analogous to how
  -- P1-04 pinned dictionary_status to 'draft'.
  retention_posture text NOT NULL DEFAULT 'restricted_pending_review',

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT intake_sensitivity_profiles_p1_05_identity_unique
    UNIQUE (organization_id, file_profile_id, data_dictionary_id),
  CONSTRAINT intake_sensitivity_profiles_p1_05_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_sensitivity_profiles_p1_05_profile_lineage_fk
    FOREIGN KEY (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT intake_sensitivity_profiles_p1_05_dictionary_lineage_fk
    FOREIGN KEY (data_dictionary_id, organization_id, intake_file_id, file_profile_id)
    REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id, intake_file_id, file_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT intake_sensitivity_profiles_p1_05_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$'),

  CONSTRAINT intake_sensitivity_profiles_p1_05_pii_status_check
    CHECK (pii_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_minor_data_status_check
    CHECK (minor_data_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_hhji_status_check
    CHECK (health_housing_justice_immigration_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_indig_gov_status_check
    CHECK (indigenous_governance_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_staff_notes_status_check
    CHECK (staff_notes_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_story_testimonial_check
    CHECK (story_testimonial_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_small_cell_risk_status_check
    CHECK (small_cell_risk_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_fin_records_status_check
    CHECK (financial_records_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_consent_basis_status_check
    CHECK (consent_basis_status IN ('unknown', 'present', 'absent')),
  CONSTRAINT intake_sensitivity_profiles_p1_05_allowed_use_status_check
    CHECK (allowed_use_status IN ('unknown', 'allowed', 'not_allowed')),

  CONSTRAINT intake_sensitivity_profiles_p1_05_llm_processing_check
    CHECK (llm_processing_allowed = false),
  CONSTRAINT intake_sensitivity_profiles_p1_05_product_learning_check
    CHECK (product_learning_allowed = false),
  CONSTRAINT intake_sensitivity_profiles_p1_05_public_use_check
    CHECK (public_use_allowed = false),
  CONSTRAINT intake_sensitivity_profiles_p1_05_funder_use_check
    CHECK (funder_use_allowed = false),
  CONSTRAINT intake_sensitivity_profiles_p1_05_human_review_check
    CHECK (human_review_required = true),
  CONSTRAINT intake_sensitivity_profiles_p1_05_retention_posture_check
    CHECK (retention_posture = 'restricted_pending_review')
);

CREATE INDEX IF NOT EXISTS ix_intake_sensitivity_profiles_p1_05_tenant_file
  ON kai.intake_sensitivity_profiles (organization_id, intake_file_id);

CREATE INDEX IF NOT EXISTS ix_intake_sensitivity_profiles_p1_05_dictionary
  ON kai.intake_sensitivity_profiles (data_dictionary_id);

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
      'intake_sensitivity_profile_persisted'
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
    );

COMMIT;
