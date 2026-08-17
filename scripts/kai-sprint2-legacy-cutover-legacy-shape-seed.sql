-- Test-only fixture: recreates the legacy production shape of the KAI
-- legacy-generation object graph, as proven by the four real, read-only
-- production catalog captures supplied by the repository owner on 2026-08-17.
--
-- Never applied to production - production already has these tables. This file
-- exists only to stand up the same shape inside the ephemeral, ownerless
-- PostgreSQL instance that
-- scripts/kai-sprint2-legacy-cutover-local-postgres.js creates and destroys
-- itself, so the collision-and-cutover regression can be proven for real.
--
-- Evidence provenance (owner-supplied production captures, 2026-08-17):
--   capture 1 - full catalog for data_dictionaries, intake_file_profiles,
--               intake_files, intake_promotion_decisions,
--               intake_sensitivity_profiles, intake_source_candidates,
--               review_queue_items, source_versions, sources
--   capture 2 - the production run of the first-pass preflight (4 FAILs)
--   capture 3 - full catalog for intake_parser_runs, data_dictionary_fields,
--               source_locators, evidence_items, plus the incoming FK edges
--               claim_evidence_links -> evidence_items,
--               funder_requirements -> source_locators,
--               funders -> source_locators
--   capture 4 - full catalog for data_dictionary_mappings and
--               data_quality_findings
--
-- Fidelity statement (honest bounds of this fixture):
--   * Column names, nullability, defaults, primary keys, unique constraints,
--     CHECK constraints, indexes and foreign keys are reproduced from the
--     captures for every one of the thirteen legacy-generation tables.
--   * USER-DEFINED enum types are created here with the value sets the captures
--     actually expose (defaults and CHECK bodies). The captures do not enumerate
--     full enum vocabularies, so these enums are deliberately narrower than
--     production's. This is a known, disclosed bound - not a claim of
--     byte-for-byte equality.
--   * Base tables the captures reference but do not describe (kai.organizations,
--     kai.engagements, kai.users, kai.intake_batches, kai.audit_events,
--     kai.retention_rules, kai.model_outputs, kai.prompt_runs) are created here
--     as minimal synthetic referents carrying only the keys the captured foreign
--     keys need.
--   * kai.claim_evidence_links, kai.funder_requirements and kai.funders are
--     created only as the minimum needed to carry the three captured incoming FK
--     edges, because the captures describe those edges but not those tables'
--     own full shapes.

BEGIN;

-- ==========================================================================
-- 0. Enum types referenced by the captured legacy shapes.
-- ==========================================================================
CREATE TYPE kai.object_type_enum AS ENUM ('other');
CREATE TYPE kai.processing_status_enum AS ENUM (
  'received', 'quarantined', 'parsed', 'schema_validated', 'extracted', 'needs_gk_review'
);
CREATE TYPE kai.parse_status_enum AS ENUM ('received', 'quarantined', 'parsed', 'failed');
CREATE TYPE kai.job_status_enum AS ENUM ('queued', 'running', 'succeeded', 'failed');
CREATE TYPE kai.review_status_enum AS ENUM (
  'proposed', 'needs_gk_review', 'approved_internal', 'approved_funder',
  'approved_public', 'export_ready', 'exported', 'rejected'
);
CREATE TYPE kai.created_by_type_enum AS ENUM ('human', 'system', 'import', 'code');
CREATE TYPE kai.sensitivity_level_enum AS ENUM ('unknown', 'low', 'medium', 'high');
CREATE TYPE kai.small_cell_risk_enum AS ENUM ('unknown', 'none', 'possible', 'likely');
CREATE TYPE kai.audience_allowed_enum AS ENUM ('internal', 'funder', 'public');
CREATE TYPE kai.consent_status_enum AS ENUM ('unknown', 'obtained', 'not_obtained');
CREATE TYPE kai.consent_scope_enum AS ENUM ('none', 'internal', 'funder', 'public');
CREATE TYPE kai.source_type_enum AS ENUM ('other', 'spreadsheet', 'document');
CREATE TYPE kai.source_owner_type_enum AS ENUM ('client', 'gk', 'third_party');
CREATE TYPE kai.intake_method_enum AS ENUM ('manual_upload', 'api', 'other');
CREATE TYPE kai.locator_type_enum AS ENUM ('other', 'column', 'page', 'row');
CREATE TYPE kai.evidence_status_enum AS ENUM ('partially_evidenced', 'evidenced', 'unevidenced');
CREATE TYPE kai.dashboard_visibility_enum AS ENUM ('internal_only', 'funder', 'public');
CREATE TYPE kai.retention_class_enum AS ENUM ('operational', 'outcome', 'legal');
CREATE TYPE kai.deletion_action_enum AS ENUM ('none', 'retain_metadata_only', 'delete');
CREATE TYPE kai.anonymization_action_enum AS ENUM ('none', 'pseudonymize', 'aggregate');
CREATE TYPE kai.legal_hold_status_enum AS ENUM ('none', 'active');
CREATE TYPE kai.classification_review_status_enum AS ENUM ('proposed', 'confirmed');
CREATE TYPE kai.classification_source_enum AS ENUM ('imported', 'rule_assigned', 'human');
-- Production evidence supplied on 2026-08-17 proves review_queue_items.priority
-- starts as kai.priority_enum, default 'medium', with these labels and no
-- 'normal'. The cutover itself reconciles that shared-schema compatibility
-- problem; the fixture must not pre-normalize it.
CREATE TYPE kai.priority_enum AS ENUM (
  'mandatory',
  'immediate_fix',
  'high',
  'medium',
  'low',
  'backlog',
  'not_applicable',
  'unknown'
);
CREATE TYPE kai.gap_type_enum AS ENUM ('data_quality', 'coverage', 'consent');

CREATE OR REPLACE FUNCTION kai.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ==========================================================================
-- 1. Minimal synthetic referents for base tables the captured FKs point at.
--    These predate tracked migrations in production; the captures reference
--    them without describing them, so only the referenced keys are modelled.
-- ==========================================================================
CREATE TABLE kai.organizations (
  organization_id uuid PRIMARY KEY,
  organization_name text NOT NULL DEFAULT 'synthetic'
);

CREATE TABLE kai.users (
  user_id uuid PRIMARY KEY,
  email text
);

CREATE TABLE kai.engagements (
  engagement_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES kai.organizations (organization_id),
  CONSTRAINT ux_engagements_engagement_org UNIQUE (engagement_id, organization_id)
);

CREATE TABLE kai.intake_batches (
  intake_batch_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES kai.organizations (organization_id),
  CONSTRAINT ux_intake_batches_batch_org UNIQUE (intake_batch_id, organization_id)
);

CREATE TABLE kai.retention_rules (retention_rule_id uuid PRIMARY KEY);
CREATE TABLE kai.model_outputs (model_output_id uuid PRIMARY KEY);
CREATE TABLE kai.prompt_runs (prompt_run_id uuid PRIMARY KEY);

-- kai.audit_events is a base table this repository's migrations never create
-- (like kai.intake_files, it predates tracked migrations); the real P1 required-
-- audit machinery (createProductionMetadataOnlyAudit ->
-- insertRequiredSuccessfulAuditEvent) writes to it. Synthetic mirror only,
-- identical to the one already used by
-- scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql.
CREATE TABLE kai.audit_events (
  audit_event_id    bigserial PRIMARY KEY,
  organization_id   uuid,
  actor_user_id     uuid,
  actor_type        text NOT NULL,
  action            text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type       kai.object_type_enum NOT NULL,
  reason_code       text,
  reason_text       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Production carries ux_intake_files_file_org on (intake_file_id,
-- organization_id) (capture 1). The Gate A migration only creates the reverse
-- column order, and the captured legacy composite FKs
-- (fk_intake_parser_runs_file_org and friends) reference this exact order.
CREATE UNIQUE INDEX ux_intake_files_file_org
  ON kai.intake_files (intake_file_id, organization_id);

-- ==========================================================================
-- 2. Legacy generation, capture 3: kai.intake_parser_runs.
--    Proven legacy: primary key intake_parser_run_id (canonical P1-02 uses
--    parser_run_id), job_status + parse_status instead of parser_status, no
--    checksum column at all, and output_profile_id pointing at the legacy
--    intake_file_profiles primary key intake_file_profile_id.
-- ==========================================================================
CREATE TABLE kai.intake_file_profiles (
  intake_file_profile_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intake_file_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  engagement_id uuid,
  row_count integer,
  column_count integer,
  sheet_count integer,
  cell_count bigint,
  detected_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_values_redacted jsonb NOT NULL DEFAULT '[]'::jsonb,
  detected_file_kind text,
  detected_date_range jsonb,
  detected_entity_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  processing_status kai.processing_status_enum NOT NULL DEFAULT 'parsed',
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  profile_summary text,
  profile_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT intake_file_profiles_pkey PRIMARY KEY (intake_file_profile_id),
  CONSTRAINT intake_file_profiles_cell_count_check CHECK (cell_count IS NULL OR cell_count >= 0),
  CONSTRAINT intake_file_profiles_column_count_check CHECK (column_count IS NULL OR column_count >= 0),
  CONSTRAINT intake_file_profiles_row_count_check CHECK (row_count IS NULL OR row_count >= 0),
  CONSTRAINT intake_file_profiles_sheet_count_check CHECK (sheet_count IS NULL OR sheet_count >= 0),
  CONSTRAINT intake_file_profiles_detected_columns_check CHECK (jsonb_typeof(detected_columns) = 'array'),
  CONSTRAINT intake_file_profiles_detected_entity_types_check CHECK (jsonb_typeof(detected_entity_types) = 'array'),
  CONSTRAINT intake_file_profiles_sample_values_redacted_check CHECK (jsonb_typeof(sample_values_redacted) = 'array'),
  CONSTRAINT intake_file_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT intake_file_profiles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT intake_file_profiles_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT intake_file_profiles_intake_file_id_fkey FOREIGN KEY (intake_file_id) REFERENCES kai.intake_files (intake_file_id) ON DELETE CASCADE,
  CONSTRAINT intake_file_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT fk_intake_file_profiles_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT fk_intake_file_profiles_file_org FOREIGN KEY (intake_file_id, organization_id) REFERENCES kai.intake_files (intake_file_id, organization_id)
);
CREATE INDEX idx_intake_file_profiles_file ON kai.intake_file_profiles (intake_file_id);
CREATE INDEX idx_intake_file_profiles_org_status ON kai.intake_file_profiles (organization_id, processing_status, review_status);

CREATE TABLE kai.intake_parser_runs (
  intake_parser_run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intake_file_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  engagement_id uuid,
  job_id uuid,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  job_status kai.job_status_enum NOT NULL DEFAULT 'queued',
  parse_status kai.parse_status_enum NOT NULL DEFAULT 'received',
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  requires_manual_review boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message_safe text,
  output_profile_id uuid,
  parser_input_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  parser_output_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT intake_parser_runs_pkey PRIMARY KEY (intake_parser_run_id),
  CONSTRAINT intake_parser_runs_error_message_safe_check CHECK (error_message_safe IS NULL OR length(error_message_safe) <= 4000),
  CONSTRAINT intake_parser_runs_max_retries_check CHECK (max_retries >= 0),
  CONSTRAINT intake_parser_runs_parser_name_check CHECK (parser_name <> ''),
  CONSTRAINT intake_parser_runs_parser_version_check CHECK (parser_version <> ''),
  CONSTRAINT intake_parser_runs_retry_count_check CHECK (retry_count >= 0),
  CONSTRAINT intake_parser_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT intake_parser_runs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT intake_parser_runs_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT intake_parser_runs_intake_file_id_fkey FOREIGN KEY (intake_file_id) REFERENCES kai.intake_files (intake_file_id) ON DELETE CASCADE,
  CONSTRAINT intake_parser_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT fk_intake_parser_runs_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT fk_intake_parser_runs_file_org FOREIGN KEY (intake_file_id, organization_id) REFERENCES kai.intake_files (intake_file_id, organization_id),
  CONSTRAINT fk_intake_parser_runs_output_profile FOREIGN KEY (output_profile_id) REFERENCES kai.intake_file_profiles (intake_file_profile_id) ON DELETE SET NULL
);
CREATE INDEX idx_intake_parser_runs_file ON kai.intake_parser_runs (intake_file_id);
CREATE INDEX idx_intake_parser_runs_org ON kai.intake_parser_runs (organization_id, engagement_id);
CREATE INDEX idx_intake_parser_runs_status ON kai.intake_parser_runs (job_status, parse_status, requires_manual_review);

-- ==========================================================================
-- 3. Legacy generation, capture 1: kai.sources / kai.source_versions.
--    Note on capture fidelity: capture 1 lists no `parse_status` column for
--    kai.sources, yet its captured index idx_sources_engagement_status is
--    defined over (organization_id, processing_status, parse_status,
--    review_status). Those two capture rows contradict each other. This fixture
--    keeps the captured index definition, which forces the column to exist, and
--    the contradiction is reported as NOT_CONFIRMED rather than silently
--    resolved in either direction.
-- ==========================================================================
CREATE TABLE kai.sources (
  source_id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  source_code text,
  source_family_id uuid,
  current_source_version_id uuid,
  display_name text NOT NULL,
  original_filename_or_source_name text,
  source_type kai.source_type_enum NOT NULL,
  intake_method kai.intake_method_enum NOT NULL DEFAULT 'manual_upload',
  source_owner_type kai.source_owner_type_enum NOT NULL DEFAULT 'client',
  source_owner_name text,
  permission_use_scope kai.audience_allowed_enum[] NOT NULL DEFAULT ARRAY['internal'::kai.audience_allowed_enum],
  processing_status kai.processing_status_enum NOT NULL DEFAULT 'received',
  parse_status kai.parse_status_enum NOT NULL DEFAULT 'received',
  raw_file_retained boolean NOT NULL DEFAULT false,
  raw_storage_pointer text,
  external_locator_pointer text,
  hash_algorithm text NOT NULL DEFAULT 'sha256',
  checksum text,
  source_date_range_start date,
  source_date_range_end date,
  data_class smallint NOT NULL DEFAULT 2,
  data_class_basis text,
  sensitivity_level kai.sensitivity_level_enum NOT NULL DEFAULT 'unknown',
  consent_required boolean NOT NULL DEFAULT false,
  consent_status kai.consent_status_enum NOT NULL DEFAULT 'unknown',
  consent_scope kai.consent_scope_enum[] NOT NULL DEFAULT ARRAY['none'::kai.consent_scope_enum],
  small_cell_risk kai.small_cell_risk_enum NOT NULL DEFAULT 'unknown',
  external_use_allowed boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  llm_processing_allowed boolean NOT NULL DEFAULT false,
  llm_processing_constraints text[] NOT NULL DEFAULT ARRAY['approved_provider_only'::text, 'no_vendor_retention'::text],
  export_allowed boolean NOT NULL DEFAULT false,
  export_constraints text[] NOT NULL DEFAULT ARRAY[]::text[],
  dashboard_visibility kai.dashboard_visibility_enum NOT NULL DEFAULT 'internal_only',
  classification_review_status kai.classification_review_status_enum NOT NULL DEFAULT 'proposed',
  classification_version text NOT NULL DEFAULT 'class.v0.1',
  derived_from uuid[] NOT NULL DEFAULT '{}'::uuid[],
  classification_source kai.classification_source_enum NOT NULL DEFAULT 'imported',
  classified_by uuid,
  reidentification_risk_note text,
  retention_class kai.retention_class_enum NOT NULL DEFAULT 'operational',
  retention_until date,
  delete_or_return_action kai.deletion_action_enum NOT NULL DEFAULT 'retain_metadata_only',
  anonymization_action kai.anonymization_action_enum NOT NULL DEFAULT 'none',
  legal_hold_status kai.legal_hold_status_enum NOT NULL DEFAULT 'none',
  deletion_action kai.deletion_action_enum NOT NULL DEFAULT 'none',
  deleted_at timestamptz,
  deletion_evidence_id uuid,
  retention_rule_id uuid,
  version integer NOT NULL DEFAULT 1,
  version_label text,
  supersedes_id uuid,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  is_current boolean NOT NULL DEFAULT true,
  frozen_at timestamptz,
  changelog_note text,
  review_status kai.review_status_enum NOT NULL DEFAULT 'proposed',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_decision_id uuid,
  reviewer_note text,
  approval_audience kai.audience_allowed_enum[] NOT NULL DEFAULT ARRAY['internal'::kai.audience_allowed_enum],
  legacy_review_status_label text,
  legacy_review_status_source text,
  legacy_module_status_label text,
  import_status_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'import',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  last_audit_event_id uuid,
  CONSTRAINT sources_pkey PRIMARY KEY (source_id),
  CONSTRAINT sources_approval_requires_human_chk CHECK (
    (review_status <> ALL (ARRAY['approved_internal'::kai.review_status_enum, 'approved_funder'::kai.review_status_enum,
                                 'approved_public'::kai.review_status_enum, 'export_ready'::kai.review_status_enum,
                                 'exported'::kai.review_status_enum]))
    OR reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
  ),
  CONSTRAINT sources_data_class_check CHECK (data_class >= 0 AND data_class <= 8),
  CONSTRAINT sources_date_range_chk CHECK (source_date_range_end IS NULL OR source_date_range_start IS NULL OR source_date_range_end >= source_date_range_start),
  CONSTRAINT sources_display_name_check CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT sources_raw_pointer_chk CHECK (raw_file_retained OR raw_storage_pointer IS NULL),
  CONSTRAINT sources_version_check CHECK (version > 0),
  CONSTRAINT sources_classified_by_fkey FOREIGN KEY (classified_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT sources_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT sources_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT sources_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE CASCADE,
  CONSTRAINT sources_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT sources_retention_rule_id_fkey FOREIGN KEY (retention_rule_id) REFERENCES kai.retention_rules (retention_rule_id) ON DELETE SET NULL
);
CREATE INDEX idx_sources_checksum ON kai.sources (checksum);
CREATE INDEX idx_sources_engagement_status ON kai.sources (organization_id, processing_status, parse_status, review_status);
CREATE INDEX idx_sources_org_class ON kai.sources (organization_id, data_class, sensitivity_level);
CREATE UNIQUE INDEX ux_sources_source_org ON kai.sources (source_id, organization_id);

CREATE TABLE kai.source_versions (
  source_version_id uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL,
  version_number integer NOT NULL,
  version_label text,
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by_user_id uuid,
  original_filename_or_source_name text,
  hash_algorithm text NOT NULL DEFAULT 'sha256',
  checksum text NOT NULL,
  raw_file_retained boolean NOT NULL DEFAULT false,
  raw_storage_pointer text,
  extracted_text_pointer text,
  extracted_table_pointer text,
  parser_version text,
  parse_status kai.parse_status_enum NOT NULL DEFAULT 'received',
  parse_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_source_version_id uuid,
  is_current boolean NOT NULL DEFAULT true,
  data_class smallint NOT NULL DEFAULT 2,
  sensitivity_level kai.sensitivity_level_enum NOT NULL DEFAULT 'unknown',
  retention_class kai.retention_class_enum NOT NULL DEFAULT 'operational',
  retention_until date,
  delete_or_return_action kai.deletion_action_enum NOT NULL DEFAULT 'retain_metadata_only',
  anonymization_action kai.anonymization_action_enum NOT NULL DEFAULT 'none',
  legal_hold_status kai.legal_hold_status_enum NOT NULL DEFAULT 'none',
  deletion_action kai.deletion_action_enum NOT NULL DEFAULT 'none',
  deleted_at timestamptz,
  deletion_evidence_id uuid,
  retention_rule_id uuid,
  review_status kai.review_status_enum NOT NULL DEFAULT 'proposed',
  reviewed_by uuid,
  reviewed_at timestamptz,
  legacy_review_status_label text,
  legacy_module_status_label text,
  import_status_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'import',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  last_audit_event_id uuid,
  CONSTRAINT source_versions_pkey PRIMARY KEY (source_version_id),
  CONSTRAINT source_versions_approval_requires_human_chk CHECK (
    (review_status <> ALL (ARRAY['approved_internal'::kai.review_status_enum, 'approved_funder'::kai.review_status_enum,
                                 'approved_public'::kai.review_status_enum, 'export_ready'::kai.review_status_enum,
                                 'exported'::kai.review_status_enum]))
    OR reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
  ),
  CONSTRAINT source_versions_checksum_check CHECK (length(btrim(checksum)) > 0),
  CONSTRAINT source_versions_data_class_check CHECK (data_class >= 0 AND data_class <= 8),
  CONSTRAINT source_versions_raw_pointer_chk CHECK (raw_file_retained OR raw_storage_pointer IS NULL),
  CONSTRAINT source_versions_version_number_check CHECK (version_number > 0),
  CONSTRAINT source_versions_source_id_checksum_key UNIQUE (source_id, checksum),
  CONSTRAINT source_versions_source_id_version_number_key UNIQUE (source_id, version_number),
  CONSTRAINT source_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT source_versions_received_by_user_id_fkey FOREIGN KEY (received_by_user_id) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT source_versions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT source_versions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT source_versions_retention_rule_id_fkey FOREIGN KEY (retention_rule_id) REFERENCES kai.retention_rules (retention_rule_id) ON DELETE SET NULL,
  CONSTRAINT source_versions_source_id_fkey FOREIGN KEY (source_id) REFERENCES kai.sources (source_id) ON DELETE CASCADE,
  CONSTRAINT source_versions_supersedes_source_version_id_fkey FOREIGN KEY (supersedes_source_version_id) REFERENCES kai.source_versions (source_version_id) ON DELETE SET NULL
);
CREATE INDEX idx_source_versions_checksum ON kai.source_versions (checksum);
CREATE INDEX idx_source_versions_parse_status ON kai.source_versions (parse_status);
CREATE INDEX idx_source_versions_source_current ON kai.source_versions (source_id, is_current);
CREATE UNIQUE INDEX ux_source_versions_one_current ON kai.source_versions (source_id) WHERE is_current;

-- ==========================================================================
-- 4. Legacy generation, capture 1 + capture 3 + capture 4: the data-dictionary
--    cluster. data_dictionary_fields, data_dictionary_mappings and
--    data_quality_findings are all proven legacy here: the canonical P1-04
--    shapes require file_profile_id + profile_field_key + data_dictionary_id
--    columns that none of these production tables carries.
-- ==========================================================================
CREATE TABLE kai.data_dictionaries (
  data_dictionary_id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  intake_file_id uuid,
  source_id uuid,
  processing_status kai.processing_status_enum NOT NULL DEFAULT 'needs_gk_review',
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  dictionary_name text,
  dictionary_summary text,
  dictionary_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'human',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  last_audit_event_id uuid,
  CONSTRAINT data_dictionaries_pkey PRIMARY KEY (data_dictionary_id),
  CONSTRAINT data_dictionaries_dictionary_name_check CHECK (dictionary_name IS NULL OR dictionary_name <> ''),
  CONSTRAINT data_dictionaries_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT data_dictionaries_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionaries_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionaries_intake_file_id_fkey FOREIGN KEY (intake_file_id) REFERENCES kai.intake_files (intake_file_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionaries_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT data_dictionaries_source_id_fkey FOREIGN KEY (source_id) REFERENCES kai.sources (source_id) ON DELETE SET NULL,
  CONSTRAINT fk_data_dictionaries_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT fk_data_dictionaries_source_org FOREIGN KEY (source_id, organization_id) REFERENCES kai.sources (source_id, organization_id)
);
CREATE INDEX idx_data_dictionaries_intake_file ON kai.data_dictionaries (intake_file_id);
CREATE INDEX idx_data_dictionaries_org_review ON kai.data_dictionaries (organization_id, processing_status, review_status);
CREATE INDEX idx_data_dictionaries_source ON kai.data_dictionaries (source_id);
CREATE UNIQUE INDEX ux_data_dictionaries_dictionary_org ON kai.data_dictionaries (data_dictionary_id, organization_id);

CREATE TABLE kai.data_dictionary_fields (
  data_dictionary_field_id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_dictionary_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  engagement_id uuid,
  intake_file_id uuid,
  source_id uuid,
  field_name text NOT NULL,
  display_label text,
  business_meaning text,
  entity_level text NOT NULL DEFAULT 'unknown',
  data_type_detected text,
  data_type_confirmed text,
  sensitivity_level kai.sensitivity_level_enum NOT NULL DEFAULT 'unknown',
  small_cell_risk kai.small_cell_risk_enum NOT NULL DEFAULT 'unknown',
  allowed_use kai.audience_allowed_enum[] NOT NULL DEFAULT ARRAY['internal'::kai.audience_allowed_enum],
  consent_status kai.consent_status_enum NOT NULL DEFAULT 'unknown',
  consent_scope kai.consent_scope_enum[] NOT NULL DEFAULT ARRAY['none'::kai.consent_scope_enum],
  quality_status text NOT NULL DEFAULT 'unknown',
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  mapping_confidence text NOT NULL DEFAULT 'unknown',
  field_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT data_dictionary_fields_pkey PRIMARY KEY (data_dictionary_field_id),
  CONSTRAINT data_dictionary_fields_allowed_use_check CHECK (array_length(allowed_use, 1) IS NOT NULL),
  CONSTRAINT data_dictionary_fields_consent_scope_check CHECK (array_length(consent_scope, 1) IS NOT NULL),
  CONSTRAINT data_dictionary_fields_entity_level_check CHECK (entity_level = ANY (ARRAY['person','household','contact','event','program','outcome','finance','story','organization','source','unknown','other'])),
  CONSTRAINT data_dictionary_fields_field_name_check CHECK (field_name <> ''),
  CONSTRAINT data_dictionary_fields_mapping_confidence_check CHECK (mapping_confidence = ANY (ARRAY['high','medium','low','unknown'])),
  CONSTRAINT data_dictionary_fields_quality_status_check CHECK (quality_status = ANY (ARRAY['unknown','usable','needs_review','blocked','not_applicable'])),
  CONSTRAINT data_dictionary_fields_data_dictionary_id_field_name_key UNIQUE (data_dictionary_id, field_name),
  CONSTRAINT data_dictionary_fields_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionary_fields_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionary_fields_data_dictionary_id_fkey FOREIGN KEY (data_dictionary_id) REFERENCES kai.data_dictionaries (data_dictionary_id) ON DELETE CASCADE,
  CONSTRAINT data_dictionary_fields_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionary_fields_intake_file_id_fkey FOREIGN KEY (intake_file_id) REFERENCES kai.intake_files (intake_file_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionary_fields_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT data_dictionary_fields_source_id_fkey FOREIGN KEY (source_id) REFERENCES kai.sources (source_id) ON DELETE SET NULL,
  CONSTRAINT fk_data_dictionary_fields_dictionary_org FOREIGN KEY (data_dictionary_id, organization_id) REFERENCES kai.data_dictionaries (data_dictionary_id, organization_id),
  CONSTRAINT fk_data_dictionary_fields_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT fk_data_dictionary_fields_source_org FOREIGN KEY (source_id, organization_id) REFERENCES kai.sources (source_id, organization_id)
);
CREATE INDEX idx_data_dictionary_fields_dictionary ON kai.data_dictionary_fields (data_dictionary_id);
CREATE INDEX idx_data_dictionary_fields_entity ON kai.data_dictionary_fields (organization_id, entity_level, quality_status);
CREATE INDEX idx_data_dictionary_fields_org_review ON kai.data_dictionary_fields (organization_id, review_status, sensitivity_level);
CREATE UNIQUE INDEX ux_data_dictionary_fields_field_org ON kai.data_dictionary_fields (data_dictionary_field_id, organization_id);

CREATE TABLE kai.data_dictionary_mappings (
  data_dictionary_mapping_id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_dictionary_field_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  engagement_id uuid,
  mapped_object_type text NOT NULL,
  mapped_object_id uuid,
  mapped_concept_code text,
  mapping_confidence text NOT NULL DEFAULT 'unknown',
  classification_source kai.classification_source_enum NOT NULL DEFAULT 'rule_assigned',
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  basis_note text,
  mapping_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT data_dictionary_mappings_pkey PRIMARY KEY (data_dictionary_mapping_id),
  CONSTRAINT data_dictionary_mappings_check CHECK (mapped_concept_code IS NOT NULL OR mapped_object_id IS NOT NULL OR mapped_object_type = 'other'),
  CONSTRAINT data_dictionary_mappings_mapped_object_type_check CHECK (mapped_object_type = ANY (ARRAY['program','outcome','indicator','funder_requirement','source','evidence_item','claim','coverage_finding','other'])),
  CONSTRAINT data_dictionary_mappings_mapping_confidence_check CHECK (mapping_confidence = ANY (ARRAY['high','medium','low','unknown'])),
  CONSTRAINT data_dictionary_mappings_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionary_mappings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionary_mappings_data_dictionary_field_id_fkey FOREIGN KEY (data_dictionary_field_id) REFERENCES kai.data_dictionary_fields (data_dictionary_field_id) ON DELETE CASCADE,
  CONSTRAINT data_dictionary_mappings_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT data_dictionary_mappings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT fk_data_dictionary_mappings_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT fk_data_dictionary_mappings_field_org FOREIGN KEY (data_dictionary_field_id, organization_id) REFERENCES kai.data_dictionary_fields (data_dictionary_field_id, organization_id)
);
CREATE INDEX idx_data_dictionary_mappings_field ON kai.data_dictionary_mappings (data_dictionary_field_id);
CREATE INDEX idx_data_dictionary_mappings_object ON kai.data_dictionary_mappings (mapped_object_type, mapped_object_id);
CREATE INDEX idx_data_dictionary_mappings_org_review ON kai.data_dictionary_mappings (organization_id, review_status, mapping_confidence);

CREATE TABLE kai.data_quality_findings (
  data_quality_finding_id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  intake_file_id uuid,
  source_id uuid,
  data_dictionary_field_id uuid,
  finding_type text NOT NULL,
  gap_type kai.gap_type_enum NOT NULL DEFAULT 'data_quality',
  priority kai.priority_enum NOT NULL DEFAULT 'medium',
  sensitivity_level kai.sensitivity_level_enum NOT NULL DEFAULT 'unknown',
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  finding_summary text NOT NULL,
  impact_on_use text,
  recommended_fix text,
  finding_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT data_quality_findings_pkey PRIMARY KEY (data_quality_finding_id),
  CONSTRAINT data_quality_findings_finding_summary_check CHECK (finding_summary <> ''),
  CONSTRAINT data_quality_findings_finding_summary_check1 CHECK (length(finding_summary) <= 4000),
  CONSTRAINT data_quality_findings_finding_type_check CHECK (finding_type = ANY (ARRAY['missingness','duplicate_records','unclear_denominator','mixed_entity_level','invalid_date','conflicting_values','small_cell_risk','unknown_definition','consent_gap','sensitivity_risk','other'])),
  CONSTRAINT data_quality_findings_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT data_quality_findings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT data_quality_findings_data_dictionary_field_id_fkey FOREIGN KEY (data_dictionary_field_id) REFERENCES kai.data_dictionary_fields (data_dictionary_field_id) ON DELETE SET NULL,
  CONSTRAINT data_quality_findings_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT data_quality_findings_intake_file_id_fkey FOREIGN KEY (intake_file_id) REFERENCES kai.intake_files (intake_file_id) ON DELETE SET NULL,
  CONSTRAINT data_quality_findings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT data_quality_findings_source_id_fkey FOREIGN KEY (source_id) REFERENCES kai.sources (source_id) ON DELETE SET NULL,
  CONSTRAINT fk_data_quality_findings_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT fk_data_quality_findings_source_org FOREIGN KEY (source_id, organization_id) REFERENCES kai.sources (source_id, organization_id)
);
CREATE INDEX idx_data_quality_findings_field ON kai.data_quality_findings (data_dictionary_field_id);
CREATE INDEX idx_data_quality_findings_file ON kai.data_quality_findings (intake_file_id);
CREATE INDEX idx_data_quality_findings_org_review ON kai.data_quality_findings (organization_id, review_status, priority);

-- ==========================================================================
-- 5. Legacy generation, capture 1: intake_sensitivity_profiles,
--    intake_source_candidates, intake_promotion_decisions.
-- ==========================================================================
CREATE TABLE kai.intake_sensitivity_profiles (
  intake_sensitivity_profile_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intake_file_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  engagement_id uuid,
  sensitivity_level kai.sensitivity_level_enum NOT NULL DEFAULT 'unknown',
  small_cell_risk kai.small_cell_risk_enum NOT NULL DEFAULT 'unknown',
  pii_detected boolean NOT NULL DEFAULT false,
  minor_data_possible boolean NOT NULL DEFAULT false,
  health_or_housing_data_possible boolean NOT NULL DEFAULT false,
  justice_or_immigration_data_possible boolean NOT NULL DEFAULT false,
  story_or_testimonial_possible boolean NOT NULL DEFAULT false,
  indigenous_or_ocap_possible boolean NOT NULL DEFAULT false,
  small_cell_risk_possible boolean NOT NULL DEFAULT false,
  consent_required boolean NOT NULL DEFAULT true,
  consent_status kai.consent_status_enum NOT NULL DEFAULT 'unknown',
  consent_scope kai.consent_scope_enum[] NOT NULL DEFAULT ARRAY['none'::kai.consent_scope_enum],
  llm_processing_allowed boolean NOT NULL DEFAULT false,
  external_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  product_learning_allowed boolean NOT NULL DEFAULT false,
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  basis_note text,
  sensitivity_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT intake_sensitivity_profiles_pkey PRIMARY KEY (intake_sensitivity_profile_id),
  CONSTRAINT intake_sensitivity_profiles_consent_scope_check CHECK (array_length(consent_scope, 1) IS NOT NULL),
  CONSTRAINT intake_sensitivity_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT intake_sensitivity_profiles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT intake_sensitivity_profiles_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT intake_sensitivity_profiles_intake_file_id_fkey FOREIGN KEY (intake_file_id) REFERENCES kai.intake_files (intake_file_id) ON DELETE CASCADE,
  CONSTRAINT intake_sensitivity_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT fk_intake_sensitivity_profiles_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT fk_intake_sensitivity_profiles_file_org FOREIGN KEY (intake_file_id, organization_id) REFERENCES kai.intake_files (intake_file_id, organization_id)
);
CREATE INDEX idx_intake_sensitivity_profiles_file ON kai.intake_sensitivity_profiles (intake_file_id);
CREATE INDEX idx_intake_sensitivity_profiles_gates ON kai.intake_sensitivity_profiles (organization_id, llm_processing_allowed, external_use_allowed, funder_use_allowed, public_use_allowed, product_learning_allowed);
CREATE INDEX idx_intake_sensitivity_profiles_org_review ON kai.intake_sensitivity_profiles (organization_id, sensitivity_level, review_status);

CREATE TABLE kai.intake_source_candidates (
  intake_source_candidate_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intake_file_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  engagement_id uuid,
  proposed_source_code text,
  proposed_display_name text,
  proposed_source_type kai.source_type_enum,
  proposed_owner_type kai.source_owner_type_enum NOT NULL DEFAULT 'client',
  proposed_data_class smallint,
  proposed_sensitivity_level kai.sensitivity_level_enum NOT NULL DEFAULT 'unknown',
  proposed_permission_scope kai.audience_allowed_enum[] NOT NULL DEFAULT ARRAY['internal'::kai.audience_allowed_enum],
  processing_status kai.processing_status_enum NOT NULL DEFAULT 'needs_gk_review',
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  created_source_id uuid,
  created_source_version_id uuid,
  candidate_summary text,
  candidate_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'human',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  last_audit_event_id uuid,
  CONSTRAINT intake_source_candidates_pkey PRIMARY KEY (intake_source_candidate_id),
  CONSTRAINT intake_source_candidates_proposed_data_class_check CHECK (proposed_data_class IS NULL OR proposed_data_class >= 0 AND proposed_data_class <= 8),
  CONSTRAINT intake_source_candidates_proposed_permission_scope_check CHECK (array_length(proposed_permission_scope, 1) IS NOT NULL),
  CONSTRAINT intake_source_candidates_proposed_source_code_check CHECK (proposed_source_code IS NULL OR proposed_source_code <> ''),
  CONSTRAINT intake_source_candidates_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT intake_source_candidates_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT intake_source_candidates_created_source_id_fkey FOREIGN KEY (created_source_id) REFERENCES kai.sources (source_id) ON DELETE SET NULL,
  CONSTRAINT intake_source_candidates_created_source_version_id_fkey FOREIGN KEY (created_source_version_id) REFERENCES kai.source_versions (source_version_id) ON DELETE SET NULL,
  CONSTRAINT intake_source_candidates_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT intake_source_candidates_intake_file_id_fkey FOREIGN KEY (intake_file_id) REFERENCES kai.intake_files (intake_file_id) ON DELETE CASCADE,
  CONSTRAINT intake_source_candidates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT fk_intake_source_candidates_created_source_org FOREIGN KEY (created_source_id, organization_id) REFERENCES kai.sources (source_id, organization_id),
  CONSTRAINT fk_intake_source_candidates_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT fk_intake_source_candidates_file_org FOREIGN KEY (intake_file_id, organization_id) REFERENCES kai.intake_files (intake_file_id, organization_id)
);
CREATE INDEX idx_intake_source_candidates_file ON kai.intake_source_candidates (intake_file_id);
CREATE INDEX idx_intake_source_candidates_org_review ON kai.intake_source_candidates (organization_id, processing_status, review_status);
CREATE UNIQUE INDEX ux_intake_source_candidates_candidate_org ON kai.intake_source_candidates (intake_source_candidate_id, organization_id);
CREATE UNIQUE INDEX ux_intake_source_candidates_source_code ON kai.intake_source_candidates (organization_id, proposed_source_code) WHERE (proposed_source_code IS NOT NULL);

CREATE TABLE kai.intake_promotion_decisions (
  intake_promotion_decision_id uuid NOT NULL DEFAULT gen_random_uuid(),
  intake_source_candidate_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  engagement_id uuid,
  decision_status text NOT NULL,
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  decision_by uuid NOT NULL,
  decision_by_type kai.created_by_type_enum NOT NULL DEFAULT 'human',
  decision_note text,
  created_source_id uuid,
  created_source_version_id uuid,
  decision_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_promotion_decisions_pkey PRIMARY KEY (intake_promotion_decision_id),
  CONSTRAINT intake_promotion_decisions_decision_note_check CHECK (decision_note IS NULL OR length(decision_note) <= 4000),
  CONSTRAINT intake_promotion_decisions_decision_status_check CHECK (decision_status = ANY (ARRAY['approved_for_source_creation','rejected','needs_more_information','promoted'])),
  CONSTRAINT intake_promotion_decisions_decision_by_fkey FOREIGN KEY (decision_by) REFERENCES kai.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT intake_promotion_decisions_created_source_id_fkey FOREIGN KEY (created_source_id) REFERENCES kai.sources (source_id) ON DELETE SET NULL,
  CONSTRAINT intake_promotion_decisions_created_source_version_id_fkey FOREIGN KEY (created_source_version_id) REFERENCES kai.source_versions (source_version_id) ON DELETE SET NULL,
  CONSTRAINT intake_promotion_decisions_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT intake_promotion_decisions_intake_source_candidate_id_fkey FOREIGN KEY (intake_source_candidate_id) REFERENCES kai.intake_source_candidates (intake_source_candidate_id) ON DELETE CASCADE,
  CONSTRAINT intake_promotion_decisions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT fk_intake_promotion_decisions_candidate_org FOREIGN KEY (intake_source_candidate_id, organization_id) REFERENCES kai.intake_source_candidates (intake_source_candidate_id, organization_id),
  CONSTRAINT fk_intake_promotion_decisions_created_source_org FOREIGN KEY (created_source_id, organization_id) REFERENCES kai.sources (source_id, organization_id),
  CONSTRAINT fk_intake_promotion_decisions_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id)
);
CREATE INDEX idx_intake_promotion_decisions_candidate ON kai.intake_promotion_decisions (intake_source_candidate_id);
CREATE INDEX idx_intake_promotion_decisions_org_status ON kai.intake_promotion_decisions (organization_id, decision_status, review_status);

-- ==========================================================================
-- 6. Legacy generation, capture 3: kai.source_locators / kai.evidence_items.
--    Proven legacy: source_locators' primary key is locator_id (canonical P2-01
--    uses source_locator_id) with locator_path/verbatim_snippet coordinates
--    instead of a coordinates jsonb + locator_fingerprint; evidence_items
--    carries evidence_code/evidence_statement/evidence_value/prompt_run_id
--    instead of the canonical statement + statement_fingerprint +
--    support_strength, and its FKs point at the legacy source_versions and
--    legacy source_locators primary keys.
-- ==========================================================================
CREATE TABLE kai.source_locators (
  locator_id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  locator_type kai.locator_type_enum NOT NULL,
  locator_path text NOT NULL,
  locator_label text,
  verbatim_snippet text,
  normalized_value text,
  hash_of_snippet text,
  page_number integer,
  table_name text,
  row_key text,
  column_key text,
  locator_status kai.processing_status_enum NOT NULL DEFAULT 'schema_validated',
  data_class smallint NOT NULL DEFAULT 2,
  sensitivity_level kai.sensitivity_level_enum NOT NULL DEFAULT 'unknown',
  external_use_allowed boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  retention_class kai.retention_class_enum NOT NULL DEFAULT 'operational',
  retention_until date,
  deletion_action kai.deletion_action_enum NOT NULL DEFAULT 'none',
  deleted_at timestamptz,
  review_status kai.review_status_enum NOT NULL DEFAULT 'proposed',
  reviewed_by uuid,
  reviewed_at timestamptz,
  legacy_review_status_label text,
  import_status_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'code',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  last_audit_event_id uuid,
  CONSTRAINT source_locators_pkey PRIMARY KEY (locator_id),
  CONSTRAINT source_locators_data_class_check CHECK (data_class >= 0 AND data_class <= 8),
  CONSTRAINT source_locators_locator_path_check CHECK (length(btrim(locator_path)) > 0),
  CONSTRAINT source_locators_page_number_check CHECK (page_number IS NULL OR page_number > 0),
  CONSTRAINT source_locators_snippet_hash_chk CHECK (verbatim_snippet IS NULL OR hash_of_snippet IS NOT NULL),
  CONSTRAINT source_locators_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT source_locators_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT source_locators_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT source_locators_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE CASCADE,
  CONSTRAINT source_locators_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT source_locators_source_id_fkey FOREIGN KEY (source_id) REFERENCES kai.sources (source_id) ON DELETE CASCADE,
  CONSTRAINT source_locators_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES kai.source_versions (source_version_id) ON DELETE CASCADE
);
CREATE INDEX idx_source_locators_hash ON kai.source_locators (hash_of_snippet);
CREATE INDEX idx_source_locators_source_path ON kai.source_locators (source_version_id, locator_type, locator_path);

CREATE TABLE kai.evidence_items (
  evidence_item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  evidence_code text,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_locator_id uuid NOT NULL,
  evidence_type text NOT NULL DEFAULT 'statement',
  evidence_statement text,
  evidence_value jsonb,
  evidence_status kai.evidence_status_enum NOT NULL DEFAULT 'partially_evidenced',
  confidence_note text,
  prompt_run_id uuid,
  model_output_id uuid,
  schema_version text NOT NULL DEFAULT 'evidence_item.v0.1',
  processing_status kai.processing_status_enum NOT NULL DEFAULT 'extracted',
  data_class smallint NOT NULL DEFAULT 2,
  sensitivity_level kai.sensitivity_level_enum NOT NULL DEFAULT 'unknown',
  consent_required boolean NOT NULL DEFAULT false,
  consent_status kai.consent_status_enum NOT NULL DEFAULT 'unknown',
  small_cell_risk kai.small_cell_risk_enum NOT NULL DEFAULT 'unknown',
  external_use_allowed boolean NOT NULL DEFAULT false,
  public_use_allowed boolean NOT NULL DEFAULT false,
  funder_use_allowed boolean NOT NULL DEFAULT false,
  llm_processing_allowed boolean NOT NULL DEFAULT false,
  export_allowed boolean NOT NULL DEFAULT false,
  dashboard_visibility kai.dashboard_visibility_enum NOT NULL DEFAULT 'internal_only',
  retention_class kai.retention_class_enum NOT NULL DEFAULT 'outcome',
  retention_until date,
  deletion_action kai.deletion_action_enum NOT NULL DEFAULT 'none',
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  supersedes_id uuid,
  is_current boolean NOT NULL DEFAULT true,
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_decision_id uuid,
  legacy_review_status_label text,
  legacy_review_status_source text,
  legacy_module_status_label text,
  import_status_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'import',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  last_audit_event_id uuid,
  CONSTRAINT evidence_items_pkey PRIMARY KEY (evidence_item_id),
  CONSTRAINT evidence_items_approval_requires_human_chk CHECK (
    (review_status <> ALL (ARRAY['approved_internal'::kai.review_status_enum, 'approved_funder'::kai.review_status_enum,
                                 'approved_public'::kai.review_status_enum, 'export_ready'::kai.review_status_enum,
                                 'exported'::kai.review_status_enum]))
    OR reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
  ),
  CONSTRAINT evidence_items_content_chk CHECK (evidence_statement IS NOT NULL OR evidence_value IS NOT NULL),
  CONSTRAINT evidence_items_data_class_check CHECK (data_class >= 0 AND data_class <= 8),
  CONSTRAINT evidence_items_version_check CHECK (version > 0),
  CONSTRAINT evidence_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT evidence_items_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT evidence_items_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT evidence_items_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE CASCADE,
  CONSTRAINT evidence_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT evidence_items_model_output_id_fkey FOREIGN KEY (model_output_id) REFERENCES kai.model_outputs (model_output_id) ON DELETE SET NULL,
  CONSTRAINT evidence_items_prompt_run_id_fkey FOREIGN KEY (prompt_run_id) REFERENCES kai.prompt_runs (prompt_run_id) ON DELETE SET NULL,
  CONSTRAINT evidence_items_source_id_fkey FOREIGN KEY (source_id) REFERENCES kai.sources (source_id) ON DELETE RESTRICT,
  CONSTRAINT evidence_items_source_locator_id_fkey FOREIGN KEY (source_locator_id) REFERENCES kai.source_locators (locator_id) ON DELETE RESTRICT,
  CONSTRAINT evidence_items_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES kai.source_versions (source_version_id) ON DELETE RESTRICT,
  CONSTRAINT evidence_items_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES kai.evidence_items (evidence_item_id) ON DELETE SET NULL
);
CREATE INDEX idx_evidence_items_engagement_review ON kai.evidence_items (engagement_id, review_status, evidence_status);
CREATE INDEX idx_evidence_items_source ON kai.evidence_items (source_id, source_version_id, source_locator_id);

-- ==========================================================================
-- 7. Captured incoming dependency edges (capture 3). These three tables are NOT
--    relocated by the cutover: their rows legitimately reference the preserved
--    legacy objects, and no currently-mounted repository caller requires a
--    canonical object at these names right now. Only the minimum needed to
--    carry the captured edges is modelled.
-- ==========================================================================
CREATE TABLE kai.funders (
  funder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES kai.organizations (organization_id),
  source_basis_locator_id uuid,
  CONSTRAINT funders_source_basis_locator_id_fkey
    FOREIGN KEY (source_basis_locator_id) REFERENCES kai.source_locators (locator_id) ON DELETE SET NULL
);

CREATE TABLE kai.funder_requirements (
  funder_requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES kai.organizations (organization_id),
  funder_id uuid NOT NULL REFERENCES kai.funders (funder_id),
  source_locator_id uuid,
  CONSTRAINT funder_requirements_source_locator_id_fkey
    FOREIGN KEY (source_locator_id) REFERENCES kai.source_locators (locator_id) ON DELETE SET NULL
);

CREATE TABLE kai.claim_evidence_links (
  claim_evidence_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES kai.organizations (organization_id),
  evidence_item_id uuid NOT NULL,
  CONSTRAINT claim_evidence_links_evidence_item_id_fkey
    FOREIGN KEY (evidence_item_id) REFERENCES kai.evidence_items (evidence_item_id) ON DELETE RESTRICT
);

-- ==========================================================================
-- 8. Shared/live table: production shape of kai.review_queue_items (capture 1).
--    Unnamed default CHECK constraints, already permitting every literal the
--    canonical P1-06/07/08 code writes. Never relocated by the cutover.
-- ==========================================================================
CREATE TABLE kai.review_queue_items (
  review_queue_item_id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  queue_type text NOT NULL,
  target_object_type text NOT NULL,
  target_object_id uuid NOT NULL,
  priority kai.priority_enum NOT NULL DEFAULT 'medium',
  queue_status text NOT NULL DEFAULT 'open',
  review_status kai.review_status_enum NOT NULL DEFAULT 'needs_gk_review',
  assigned_to uuid,
  due_at timestamptz,
  last_action_at timestamptz,
  blocked_reason text,
  summary text NOT NULL,
  required_action text,
  queue_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_type kai.created_by_type_enum NOT NULL DEFAULT 'system',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT review_queue_items_pkey PRIMARY KEY (review_queue_item_id),
  CONSTRAINT review_queue_items_queue_status_check CHECK (queue_status = ANY (ARRAY['open','in_progress','blocked','waiting_on_client','waiting_on_gk','resolved','cancelled'])),
  CONSTRAINT review_queue_items_queue_type_check CHECK (queue_type = ANY (ARRAY['intake_file_review','source_candidate_review','sensitivity_review','data_dictionary_review','evidence_review','claim_review','client_followup','conflict_resolution','generated_content_review','export_review'])),
  CONSTRAINT review_queue_items_summary_check CHECK (summary <> ''),
  CONSTRAINT review_queue_items_summary_check1 CHECK (length(summary) <= 4000),
  CONSTRAINT review_queue_items_target_object_type_check CHECK (target_object_type = ANY (ARRAY['intake_batch','intake_file','intake_file_profile','intake_sensitivity_profile','intake_source_candidate','data_dictionary','data_dictionary_field','data_quality_finding','source','source_version','evidence_item','claim','conflict_group','client_followup_item','report','report_section','export','generated_content','other'])),
  CONSTRAINT review_queue_items_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT review_queue_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT review_queue_items_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL,
  CONSTRAINT review_queue_items_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT review_queue_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT fk_review_queue_items_engagement_org FOREIGN KEY (engagement_id, organization_id) REFERENCES kai.engagements (engagement_id, organization_id)
);
CREATE INDEX idx_review_queue_items_assigned ON kai.review_queue_items (assigned_to, queue_status);
CREATE INDEX idx_review_queue_items_org_status ON kai.review_queue_items (organization_id, queue_status, priority, review_status);
CREATE INDEX idx_review_queue_items_target ON kai.review_queue_items (target_object_type, target_object_id);

-- ==========================================================================
-- 9. Synthetic legacy rows. Clearly-synthetic identities only - no repository
--    or production evidence ties any specific real UUID to this fixture, so
--    none is claimed here. Sufficient to prove every relationship the cutover
--    must preserve.
-- ==========================================================================
INSERT INTO kai.organizations (organization_id, organization_name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'synthetic primary'),
  ('00000000-0000-4000-8000-000000000002', 'synthetic other');

INSERT INTO kai.users (user_id, email) VALUES
  ('90000000-0000-4000-8000-000000000001', 'synthetic.operator@example.invalid');

INSERT INTO kai.engagements (engagement_id, organization_id) VALUES
  ('e0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');

INSERT INTO kai.intake_batches (intake_batch_id, organization_id) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001');

INSERT INTO kai.retention_rules (retention_rule_id) VALUES ('a0000000-0000-4000-8000-0000000000e1');

-- Legacy parser run -> legacy file profile relationship.
INSERT INTO kai.intake_file_profiles (
  intake_file_profile_id, intake_file_id, organization_id, engagement_id,
  row_count, column_count, detected_columns, processing_status, created_at
) VALUES (
  'a1000000-0000-4000-8000-00000000f001',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  12, 4, '[{"legacy_column": "redacted"}]'::jsonb, 'parsed', '2026-01-15T00:00:00Z'
);

INSERT INTO kai.intake_parser_runs (
  intake_parser_run_id, intake_file_id, organization_id, engagement_id,
  parser_name, parser_version, job_status, parse_status, output_profile_id, created_at
) VALUES (
  'a2000000-0000-4000-8000-00000000f001',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'legacy_parser', '0.9.0', 'succeeded', 'parsed',
  'a1000000-0000-4000-8000-00000000f001', '2026-01-15T00:00:00Z'
);

-- Legacy source / source_version lineage.
INSERT INTO kai.sources (
  source_id, organization_id, engagement_id, display_name, source_type, created_at
) VALUES (
  'b1000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'Legacy synthetic source (pre-Sprint2 generation)', 'other', '2026-01-15T00:00:00Z'
);

INSERT INTO kai.source_versions (
  source_version_id, source_id, version_number, checksum, created_at
) VALUES (
  'b2000000-0000-4000-8000-00000000f001',
  'b1000000-0000-4000-8000-00000000f001',
  1, repeat('a', 64), '2026-01-15T00:00:00Z'
);

UPDATE kai.sources
   SET current_source_version_id = 'b2000000-0000-4000-8000-00000000f001'
 WHERE source_id = 'b1000000-0000-4000-8000-00000000f001';

-- Legacy dictionary -> field -> mapping / finding relationships.
INSERT INTO kai.data_dictionaries (
  data_dictionary_id, organization_id, engagement_id, intake_file_id, source_id,
  dictionary_name, dictionary_metadata, created_by, created_at
) VALUES (
  'c1000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-00000000f001',
  'Legacy synthetic dictionary', '{"legacy": true}'::jsonb,
  '90000000-0000-4000-8000-000000000001', '2026-01-15T00:00:00Z'
);

INSERT INTO kai.data_dictionary_fields (
  data_dictionary_field_id, data_dictionary_id, organization_id, engagement_id,
  intake_file_id, source_id, field_name, created_at
) VALUES (
  'c2000000-0000-4000-8000-00000000f001',
  'c1000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-00000000f001',
  'legacy_field_name', '2026-01-15T00:00:00Z'
);

INSERT INTO kai.data_dictionary_mappings (
  data_dictionary_mapping_id, data_dictionary_field_id, organization_id,
  engagement_id, mapped_object_type, mapped_concept_code, created_at
) VALUES (
  'c3000000-0000-4000-8000-00000000f001',
  'c2000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'other', 'legacy_concept', '2026-01-15T00:00:00Z'
);

INSERT INTO kai.data_quality_findings (
  data_quality_finding_id, organization_id, engagement_id, intake_file_id,
  source_id, data_dictionary_field_id, finding_type, finding_summary, created_at
) VALUES (
  'c4000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-00000000f001',
  'c2000000-0000-4000-8000-00000000f001',
  'missingness', 'Legacy synthetic finding', '2026-01-15T00:00:00Z'
);

-- Legacy sensitivity profile.
INSERT INTO kai.intake_sensitivity_profiles (
  intake_sensitivity_profile_id, intake_file_id, organization_id, engagement_id, created_at
) VALUES (
  'd1000000-0000-4000-8000-00000000f001',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001', '2026-01-15T00:00:00Z'
);

-- Legacy candidate lineage + promotion decision.
INSERT INTO kai.intake_source_candidates (
  intake_source_candidate_id, intake_file_id, organization_id, engagement_id,
  proposed_display_name, proposed_source_type, created_source_id,
  created_source_version_id, created_by, created_by_type, created_at
) VALUES (
  '9f1e0000-0000-4000-8000-00000000c0c0',
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'Legacy synthetic candidate (pre-Sprint2 generation)', 'other',
  'b1000000-0000-4000-8000-00000000f001',
  'b2000000-0000-4000-8000-00000000f001',
  '90000000-0000-4000-8000-000000000001', 'human', '2026-01-15T00:00:00Z'
);

INSERT INTO kai.intake_promotion_decisions (
  intake_promotion_decision_id, intake_source_candidate_id, organization_id,
  engagement_id, decision_status, decision_by, created_source_id,
  created_source_version_id, created_at
) VALUES (
  '9f2e0000-0000-4000-8000-00000000c0c0',
  '9f1e0000-0000-4000-8000-00000000c0c0',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'promoted', '90000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-00000000f001',
  'b2000000-0000-4000-8000-00000000f001', '2026-01-15T00:00:00Z'
);

-- Legacy locator / evidence relationships and their incoming dependents.
INSERT INTO kai.source_locators (
  locator_id, organization_id, engagement_id, source_id, source_version_id,
  locator_type, locator_path, created_at
) VALUES (
  'f1000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-00000000f001',
  'b2000000-0000-4000-8000-00000000f001',
  'other', 'legacy/locator/path', '2026-01-15T00:00:00Z'
);

INSERT INTO kai.evidence_items (
  evidence_item_id, organization_id, engagement_id, source_id, source_version_id,
  source_locator_id, evidence_statement, created_at
) VALUES (
  'f2000000-0000-4000-8000-00000000f001',
  '00000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-00000000f001',
  'b2000000-0000-4000-8000-00000000f001',
  'f1000000-0000-4000-8000-00000000f001',
  'Legacy synthetic evidence statement', '2026-01-15T00:00:00Z'
);

INSERT INTO kai.funders (funder_id, organization_id, source_basis_locator_id) VALUES
  ('f3000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000f001');

INSERT INTO kai.funder_requirements (funder_requirement_id, organization_id, funder_id, source_locator_id) VALUES
  ('f4000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-000000000001',
   'f3000000-0000-4000-8000-00000000f001', 'f1000000-0000-4000-8000-00000000f001');

INSERT INTO kai.claim_evidence_links (claim_evidence_link_id, organization_id, evidence_item_id) VALUES
  ('f5000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-00000000f001');

-- Shared queue rows: one non-legacy-target row (an intake_file target, which
-- this cutover never relocates) plus four rows whose targets ARE
-- legacy-generation objects about to be relocated. The four legacy-target rows
-- are what the section-9 treatment must handle without fabricating any
-- resolution.
INSERT INTO kai.review_queue_items (
  review_queue_item_id, organization_id, engagement_id, queue_type,
  target_object_type, target_object_id, queue_status, summary, required_action, created_at
) VALUES
  ('11110000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'intake_file_review', 'intake_file',
   '20000000-0000-4000-8000-000000000001', 'open', 'Shared intake file review', NULL, '2026-01-15T01:00:00Z'),
  ('11110000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'source_candidate_review', 'intake_source_candidate',
   '9f1e0000-0000-4000-8000-00000000c0c0', 'open', 'Legacy source candidate review', 'Review legacy candidate', '2026-01-15T02:00:00Z'),
  ('11110000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'sensitivity_review', 'intake_sensitivity_profile',
   'd1000000-0000-4000-8000-00000000f001', 'open', 'Legacy sensitivity review', 'Review legacy sensitivity profile', '2026-01-15T03:00:00Z'),
  ('11110000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'data_dictionary_review', 'data_dictionary',
   'c1000000-0000-4000-8000-00000000f001', 'open', 'Legacy dictionary review', NULL, '2026-01-15T04:00:00Z'),
  ('11110000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001', 'evidence_review', 'evidence_item',
   'f2000000-0000-4000-8000-00000000f001', 'open', 'Legacy evidence review', NULL, '2026-01-15T05:00:00Z');

CREATE TRIGGER trg_data_dictionaries_updated_at
  BEFORE UPDATE ON kai.data_dictionaries
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_data_dictionary_fields_updated_at
  BEFORE UPDATE ON kai.data_dictionary_fields
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_data_dictionary_mappings_updated_at
  BEFORE UPDATE ON kai.data_dictionary_mappings
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_data_quality_findings_updated_at
  BEFORE UPDATE ON kai.data_quality_findings
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_evidence_items_updated_at
  BEFORE UPDATE ON kai.evidence_items
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_intake_file_profiles_updated_at
  BEFORE UPDATE ON kai.intake_file_profiles
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_intake_parser_runs_updated_at
  BEFORE UPDATE ON kai.intake_parser_runs
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_intake_sensitivity_profiles_updated_at
  BEFORE UPDATE ON kai.intake_sensitivity_profiles
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_intake_source_candidates_updated_at
  BEFORE UPDATE ON kai.intake_source_candidates
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_source_locators_updated_at
  BEFORE UPDATE ON kai.source_locators
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_source_versions_updated_at
  BEFORE UPDATE ON kai.source_versions
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();
CREATE TRIGGER trg_sources_updated_at
  BEFORE UPDATE ON kai.sources
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();

COMMIT;
