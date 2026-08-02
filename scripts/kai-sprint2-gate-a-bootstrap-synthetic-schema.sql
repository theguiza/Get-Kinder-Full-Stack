CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS kai;

CREATE TABLE kai.organizations (
  organization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE kai.intake_batches (
  intake_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES kai.organizations (organization_id),
  engagement_id uuid,
  batch_code text NOT NULL,
  processing_status text NOT NULL DEFAULT 'received',
  review_status text NOT NULL DEFAULT 'proposed',
  idempotency_key text,
  batch_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kai.intake_files (
  intake_file_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_batch_id uuid NOT NULL REFERENCES kai.intake_batches (intake_batch_id),
  organization_id uuid NOT NULL REFERENCES kai.organizations (organization_id),
  engagement_id uuid,
  original_filename text NOT NULL,
  safe_filename text NOT NULL,
  storage_uri text,
  storage_provider text NOT NULL DEFAULT 'local_dev',
  storage_region text,
  storage_bucket text,
  storage_object_key text,
  mime_type text,
  file_extension text,
  file_size_bytes bigint,
  checksum text,
  hash_algorithm text DEFAULT 'sha256',
  force_new_version boolean NOT NULL DEFAULT false,
  raw_file_retained boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'quarantined',
  parse_status text NOT NULL DEFAULT 'quarantined',
  review_status text NOT NULL DEFAULT 'proposed',
  file_policy_status text NOT NULL DEFAULT 'pending',
  malware_scan_status text NOT NULL DEFAULT 'not_configured',
  file_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_files_file_policy_status_check CHECK (file_policy_status IN ('pending', 'passed', 'blocked', 'failed', 'skipped')),
  CONSTRAINT intake_files_storage_provider_check CHECK (storage_provider IN ('gcs', 'local_dev')),
  CONSTRAINT intake_files_malware_scan_status_check CHECK (malware_scan_status IN ('not_configured', 'queued', 'running', 'passed', 'failed', 'skipped'))
);

CREATE TABLE kai.audit_events (
  audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  actor_user_id uuid,
  actor_type text NOT NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type text NOT NULL,
  reason_code text,
  reason_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);
