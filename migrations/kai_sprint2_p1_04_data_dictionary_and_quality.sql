BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.intake_files') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_files is required before P1-04 data-dictionary/quality migration';
  END IF;
  IF to_regclass('kai.intake_file_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_file_profiles is required before P1-04 data-dictionary/quality migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P1-04 data-dictionary/quality migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P1-04 data-dictionary/quality migration';
  END IF;
END $$;

-- Backward-compatible extension of the existing frozen P1-02 substrate: a composite
-- parent key that lets P1-04 bind immutable dictionary lineage to the exact stored
-- profile identity and its already-immutable canonical hash. No existing constraint
-- on kai.intake_file_profiles is altered or dropped.
ALTER TABLE kai.intake_file_profiles
  ADD CONSTRAINT intake_file_profiles_p1_04_lineage_unique
  UNIQUE (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256);

CREATE TABLE IF NOT EXISTS kai.data_dictionaries (
  data_dictionary_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  profile_canonical_sha256 text NOT NULL,
  dictionary_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_dictionaries_p1_04_bundle_identity_unique
    UNIQUE (organization_id, file_profile_id),
  CONSTRAINT data_dictionaries_p1_04_lineage_unique
    UNIQUE (data_dictionary_id, organization_id, intake_file_id, file_profile_id),
  CONSTRAINT data_dictionaries_p1_04_child_fk_unique
    UNIQUE (data_dictionary_id, organization_id, file_profile_id),
  CONSTRAINT data_dictionaries_p1_04_file_fk
    FOREIGN KEY (organization_id, intake_file_id)
    REFERENCES kai.intake_files (organization_id, intake_file_id)
    ON DELETE RESTRICT,
  CONSTRAINT data_dictionaries_p1_04_profile_lineage_fk
    FOREIGN KEY (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, profile_canonical_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT data_dictionaries_p1_04_status_check
    CHECK (dictionary_status = 'draft'),
  CONSTRAINT data_dictionaries_p1_04_canonical_sha_check
    CHECK (profile_canonical_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS ix_data_dictionaries_p1_04_tenant_file
  ON kai.data_dictionaries (organization_id, intake_file_id);

CREATE TABLE IF NOT EXISTS kai.data_dictionary_fields (
  data_dictionary_field_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_dictionary_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  profile_field_key text NOT NULL,
  field_label_safe text NOT NULL,
  data_type text NOT NULL,
  business_meaning text NOT NULL DEFAULT 'unknown',
  entity_level text NOT NULL DEFAULT 'unknown',
  quality_notes_safe text,
  mapping_confidence numeric(3,2) NOT NULL DEFAULT 1.00,
  review_status text NOT NULL DEFAULT 'needs_gk_review',
  sensitivity text NOT NULL DEFAULT 'unknown',
  allowed_use text NOT NULL DEFAULT 'internal',
  consent_status text NOT NULL DEFAULT 'unknown',
  consent_scope text NOT NULL DEFAULT 'none',
  llm_use_allowed boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  human_review_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_dictionary_fields_p1_04_identity_unique
    UNIQUE (data_dictionary_id, profile_field_key),
  CONSTRAINT data_dictionary_fields_p1_04_lineage_unique
    UNIQUE (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key),
  CONSTRAINT data_dictionary_fields_p1_04_dictionary_fk
    FOREIGN KEY (data_dictionary_id, organization_id, file_profile_id)
    REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id, file_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT data_dictionary_fields_p1_04_field_key_check
    CHECK (length(profile_field_key) BETWEEN 1 AND 128 AND profile_field_key = lower(btrim(profile_field_key)) AND profile_field_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT data_dictionary_fields_p1_04_label_safe_check
    CHECK (
      length(field_label_safe) BETWEEN 1 AND 200
      AND field_label_safe !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    ),
  CONSTRAINT data_dictionary_fields_p1_04_data_type_check
    CHECK (length(data_type) BETWEEN 1 AND 64 AND data_type = lower(btrim(data_type)) AND data_type ~ '^[a-z0-9_]+$'),
  CONSTRAINT data_dictionary_fields_p1_04_business_meaning_check
    CHECK (
      business_meaning = 'unknown'
      OR (
        length(business_meaning) BETWEEN 1 AND 200
        AND business_meaning !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
      )
    ),
  CONSTRAINT data_dictionary_fields_p1_04_entity_level_check
    CHECK (
      entity_level = 'unknown'
      OR (length(entity_level) BETWEEN 1 AND 64 AND entity_level = lower(btrim(entity_level)) AND entity_level ~ '^[a-z0-9_]+$')
    ),
  CONSTRAINT data_dictionary_fields_p1_04_quality_notes_safe_check
    CHECK (
      quality_notes_safe IS NULL
      OR (
        length(quality_notes_safe) BETWEEN 1 AND 500
        AND quality_notes_safe !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
      )
    ),
  CONSTRAINT data_dictionary_fields_p1_04_mapping_confidence_check
    CHECK (mapping_confidence >= 0 AND mapping_confidence <= 1),
  CONSTRAINT data_dictionary_fields_p1_04_review_status_check
    CHECK (review_status = 'needs_gk_review'),
  CONSTRAINT data_dictionary_fields_p1_04_sensitivity_check
    CHECK (sensitivity = 'unknown'),
  CONSTRAINT data_dictionary_fields_p1_04_allowed_use_check
    CHECK (allowed_use = 'internal'),
  CONSTRAINT data_dictionary_fields_p1_04_consent_status_check
    CHECK (consent_status = 'unknown'),
  CONSTRAINT data_dictionary_fields_p1_04_consent_scope_check
    CHECK (consent_scope = 'none'),
  CONSTRAINT data_dictionary_fields_p1_04_llm_use_check
    CHECK (llm_use_allowed = false),
  CONSTRAINT data_dictionary_fields_p1_04_public_use_check
    CHECK (public_use_allowed = false),
  CONSTRAINT data_dictionary_fields_p1_04_funder_use_check
    CHECK (funder_use_allowed = false),
  CONSTRAINT data_dictionary_fields_p1_04_human_review_check
    CHECK (human_review_required = true)
);

CREATE INDEX IF NOT EXISTS ix_data_dictionary_fields_p1_04_dictionary
  ON kai.data_dictionary_fields (data_dictionary_id);

CREATE TABLE IF NOT EXISTS kai.data_dictionary_mappings (
  data_dictionary_mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_dictionary_field_id uuid NOT NULL,
  data_dictionary_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  profile_field_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_dictionary_mappings_p1_04_field_unique
    UNIQUE (data_dictionary_field_id),
  CONSTRAINT data_dictionary_mappings_p1_04_field_key_check
    CHECK (length(profile_field_key) BETWEEN 1 AND 128 AND profile_field_key = lower(btrim(profile_field_key)) AND profile_field_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT data_dictionary_mappings_p1_04_field_fk
    FOREIGN KEY (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key)
    REFERENCES kai.data_dictionary_fields (data_dictionary_field_id, data_dictionary_id, organization_id, file_profile_id, profile_field_key)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_data_dictionary_mappings_p1_04_dictionary
  ON kai.data_dictionary_mappings (data_dictionary_id);

CREATE TABLE IF NOT EXISTS kai.data_quality_findings (
  data_quality_finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_dictionary_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  profile_field_key text NOT NULL DEFAULT 'file_level',
  finding_type text NOT NULL,
  finding_status text NOT NULL DEFAULT 'open',
  finding_detail_safe text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT data_quality_findings_p1_04_identity_unique
    UNIQUE (data_dictionary_id, finding_type, profile_field_key),
  CONSTRAINT data_quality_findings_p1_04_dictionary_fk
    FOREIGN KEY (data_dictionary_id, organization_id, file_profile_id)
    REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id, file_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT data_quality_findings_p1_04_type_check
    CHECK (finding_type IN (
      'missingness',
      'duplicate_rows',
      'type_inconsistency',
      'invalid_date',
      'formula_like_content',
      'safe_profiler_warning'
    )),
  CONSTRAINT data_quality_findings_p1_04_status_check
    CHECK (finding_status = 'open'),
  CONSTRAINT data_quality_findings_p1_04_field_key_check
    CHECK (length(profile_field_key) BETWEEN 1 AND 128 AND profile_field_key = lower(btrim(profile_field_key)) AND profile_field_key ~ '^[a-z0-9_]+$'),
  CONSTRAINT data_quality_findings_p1_04_detail_safe_check
    CHECK (
      length(finding_detail_safe) BETWEEN 1 AND 500
      AND finding_detail_safe !~* '(https?://|/Users/|/private/|/var/|/etc/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])'
    )
);

CREATE INDEX IF NOT EXISTS ix_data_quality_findings_p1_04_dictionary
  ON kai.data_quality_findings (data_dictionary_id);

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
      'data_dictionary_draft_persisted'
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
    );

COMMIT;
