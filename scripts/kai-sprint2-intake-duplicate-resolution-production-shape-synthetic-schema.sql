BEGIN;

-- Synthetic, production-shaped kai.intake_batches / kai.intake_files for the
-- duplicate-upload resolution real-PostgreSQL proof
-- (scripts/kai-sprint2-intake-duplicate-resolution-local-postgres.js).
--
-- Column list, types, defaults, CHECK constraints, foreign keys, and indexes
-- mirror the 2026-09-16 production schema capture
-- (artifacts/kai-db-reconciliation-2026-09-16/PRODUCTION_KAI_SCHEMA.json),
-- including the three versioning columns (force_new_version,
-- original_intake_file_id, supersedes_intake_file_id) and BOTH partial
-- declared-checksum unique indexes. The Gate A lifecycle columns, CHECKs,
-- trigger, and ux_intake_files_gate_a_org_declared_checksum come from the
-- repository migration the runner applies right after this file
-- (migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql), and gcs_generation
-- from migrations/kai_sprint2_gate_c1_gcs_generation_binding.sql, exactly as
-- they were applied to production.
--
-- Applied after the organization-enablement and Package 4 auth bootstraps
-- (kai.organizations, kai.engagements, kai.audit_events, kai.users,
-- kai.set_updated_at). The only capture items not mirrored are the
-- last_audit_event_id foreign keys: the synthetic kai.audit_events key is a
-- bigserial, and nothing on this path writes last_audit_event_id.
-- This is synthetic local DDL only; it is not a migration.

CREATE TYPE kai.intake_method_enum AS ENUM (
  'manual_upload', 'operator_created', 'google_drive', 'sharepoint', 'sftp_eft',
  'email', 'api', 'database_sync', 'form_intake', 'public_web'
);
CREATE TYPE kai.created_by_type_enum AS ENUM ('ai', 'code', 'human', 'import', 'system', 'admin');
CREATE TYPE kai.processing_status_enum AS ENUM (
  'received', 'quarantined', 'parsing', 'parsed', 'extraction_ready', 'extracted', 'schema_validated',
  'needs_ai_review', 'needs_gk_review', 'failed', 'archived', 'deleted'
);
CREATE TYPE kai.parse_status_enum AS ENUM (
  'received', 'parsing', 'parsed', 'failed', 'quarantined', 'deleted', 'not_required'
);
CREATE TYPE kai.review_status_enum AS ENUM (
  'proposed', 'needs_ai_review', 'needs_gk_review', 'gk_modified', 'gk_rejected', 'client_followup_required',
  'client_confirmed', 'approved_internal', 'approved_funder', 'approved_public', 'blocked_weak_evidence',
  'blocked_missing_consent', 'blocked_sensitive_content', 'blocked_definition_drift',
  'blocked_unresolved_conflict', 'export_ready', 'exported', 'archived', 'deleted'
);
CREATE TYPE kai.legal_hold_status_enum AS ENUM ('none', 'active', 'released', 'pending_review');

CREATE TABLE kai.intake_batches (
  intake_batch_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  engagement_id        uuid,
  batch_code           text NOT NULL,
  intake_method        kai.intake_method_enum NOT NULL DEFAULT 'manual_upload',
  processing_status    kai.processing_status_enum NOT NULL DEFAULT 'received',
  review_status        kai.review_status_enum NOT NULL DEFAULT 'proposed',
  idempotency_key      text,
  source_system_name   text,
  source_system_ref    text,
  notes                text,
  batch_metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  created_by_type      kai.created_by_type_enum NOT NULL DEFAULT 'human',
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid,
  last_audit_event_id  uuid,
  CONSTRAINT intake_batches_pkey PRIMARY KEY (intake_batch_id),
  CONSTRAINT intake_batches_batch_code_check CHECK (batch_code <> ''::text),
  CONSTRAINT fk_intake_batches_engagement_org FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT intake_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT intake_batches_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT intake_batches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT intake_batches_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL
);
CREATE INDEX idx_intake_batches_engagement ON kai.intake_batches USING btree (engagement_id);
CREATE INDEX idx_intake_batches_org_status ON kai.intake_batches USING btree (organization_id, processing_status, review_status);
CREATE UNIQUE INDEX ux_intake_batches_batch_org ON kai.intake_batches USING btree (intake_batch_id, organization_id);
CREATE UNIQUE INDEX ux_intake_batches_org_batch_code ON kai.intake_batches USING btree (organization_id, batch_code);
CREATE UNIQUE INDEX ux_intake_batches_org_idempotency_key ON kai.intake_batches USING btree (organization_id, idempotency_key)
  WHERE (idempotency_key IS NOT NULL);
CREATE TRIGGER trg_intake_batches_updated_at BEFORE UPDATE ON kai.intake_batches
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();

CREATE TABLE kai.intake_files (
  intake_file_id             uuid NOT NULL DEFAULT gen_random_uuid(),
  intake_batch_id            uuid NOT NULL,
  organization_id            uuid NOT NULL,
  engagement_id              uuid,
  original_filename          text NOT NULL,
  safe_filename              text NOT NULL,
  storage_uri                text NOT NULL,
  storage_provider           text NOT NULL DEFAULT 's3_compatible'::text,
  storage_region             text,
  storage_bucket             text,
  storage_object_key         text,
  mime_type                  text,
  file_extension             text,
  file_size_bytes            bigint,
  checksum                   text NOT NULL,
  hash_algorithm             text NOT NULL DEFAULT 'sha256'::text,
  raw_file_retained          boolean NOT NULL DEFAULT true,
  legal_hold_status          kai.legal_hold_status_enum NOT NULL DEFAULT 'none',
  processing_status          kai.processing_status_enum NOT NULL DEFAULT 'quarantined',
  parse_status               kai.parse_status_enum NOT NULL DEFAULT 'quarantined',
  review_status              kai.review_status_enum NOT NULL DEFAULT 'proposed',
  file_policy_status         text NOT NULL DEFAULT 'pending'::text,
  malware_scan_status        text NOT NULL DEFAULT 'not_configured'::text,
  force_new_version          boolean NOT NULL DEFAULT false,
  original_intake_file_id    uuid,
  supersedes_intake_file_id  uuid,
  file_metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid NOT NULL,
  created_by_type            kai.created_by_type_enum NOT NULL DEFAULT 'human',
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid,
  last_audit_event_id        uuid,
  CONSTRAINT intake_files_pkey PRIMARY KEY (intake_file_id),
  CONSTRAINT intake_files_checksum_check CHECK (checksum <> ''::text),
  CONSTRAINT intake_files_file_policy_status_check
    CHECK (file_policy_status = ANY (ARRAY['pending'::text, 'passed'::text, 'blocked'::text, 'failed'::text, 'skipped'::text])),
  CONSTRAINT intake_files_file_size_bytes_check CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  CONSTRAINT intake_files_hash_algorithm_check CHECK (hash_algorithm <> ''::text),
  CONSTRAINT intake_files_malware_scan_status_check
    CHECK (malware_scan_status = ANY (ARRAY['not_configured'::text, 'queued'::text, 'running'::text, 'passed'::text, 'failed'::text, 'skipped'::text])),
  CONSTRAINT intake_files_organization_id_check CHECK (organization_id IS NOT NULL),
  CONSTRAINT intake_files_original_filename_check CHECK (original_filename <> ''::text),
  CONSTRAINT intake_files_safe_filename_check CHECK (safe_filename <> ''::text),
  CONSTRAINT intake_files_storage_provider_check
    CHECK (storage_provider = ANY (ARRAY['s3_compatible'::text, 'cloudflare_r2'::text, 'gcs'::text, 'supabase_storage'::text, 'local_dev'::text, 'other'::text])),
  CONSTRAINT intake_files_storage_uri_check CHECK (storage_uri <> ''::text),
  CONSTRAINT fk_intake_files_batch_org FOREIGN KEY (intake_batch_id, organization_id)
    REFERENCES kai.intake_batches (intake_batch_id, organization_id),
  CONSTRAINT fk_intake_files_engagement_org FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id),
  CONSTRAINT intake_files_created_by_fkey FOREIGN KEY (created_by) REFERENCES kai.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT intake_files_engagement_id_fkey FOREIGN KEY (engagement_id) REFERENCES kai.engagements (engagement_id) ON DELETE SET NULL,
  CONSTRAINT intake_files_intake_batch_id_fkey FOREIGN KEY (intake_batch_id) REFERENCES kai.intake_batches (intake_batch_id) ON DELETE CASCADE,
  CONSTRAINT intake_files_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES kai.organizations (organization_id) ON DELETE RESTRICT,
  CONSTRAINT intake_files_original_intake_file_id_fkey FOREIGN KEY (original_intake_file_id)
    REFERENCES kai.intake_files (intake_file_id) ON DELETE SET NULL,
  CONSTRAINT intake_files_supersedes_intake_file_id_fkey FOREIGN KEY (supersedes_intake_file_id)
    REFERENCES kai.intake_files (intake_file_id) ON DELETE SET NULL,
  CONSTRAINT intake_files_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES kai.users (user_id) ON DELETE SET NULL
);
CREATE INDEX idx_intake_files_batch ON kai.intake_files USING btree (intake_batch_id);
CREATE INDEX idx_intake_files_org_status ON kai.intake_files USING btree (organization_id, processing_status, parse_status, review_status);
CREATE INDEX idx_intake_files_storage_object_key ON kai.intake_files USING btree (storage_object_key);
CREATE UNIQUE INDEX ux_intake_files_file_org ON kai.intake_files USING btree (intake_file_id, organization_id);
-- The second of the two production partial declared-checksum indexes; the
-- Gate A migration creates ux_intake_files_gate_a_org_declared_checksum.
CREATE UNIQUE INDEX ux_intake_files_org_checksum_default ON kai.intake_files USING btree (organization_id, checksum)
  WHERE (force_new_version = false);
CREATE TRIGGER trg_intake_files_updated_at BEFORE UPDATE ON kai.intake_files
  FOR EACH ROW EXECUTE FUNCTION kai.set_updated_at();

COMMIT;
