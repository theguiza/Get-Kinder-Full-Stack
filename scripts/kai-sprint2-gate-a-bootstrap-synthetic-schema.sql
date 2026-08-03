BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS kai;

CREATE TABLE kai.intake_files (
  intake_file_id uuid PRIMARY KEY,
  intake_batch_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  original_filename text NOT NULL,
  safe_filename text NOT NULL,
  checksum text NOT NULL,
  hash_algorithm text NOT NULL DEFAULT 'sha256',
  force_new_version boolean NOT NULL DEFAULT false,
  processing_status text NOT NULL DEFAULT 'quarantined',
  parse_status text NOT NULL DEFAULT 'quarantined',
  file_policy_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
