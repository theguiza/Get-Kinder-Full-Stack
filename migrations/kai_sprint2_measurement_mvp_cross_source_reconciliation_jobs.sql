BEGIN;

-- KAI Measurement MVP: queued cross-source reconciliation. Additive only: one
-- new table. No existing table, column, constraint, vocabulary or row is
-- altered.
--
-- An HTTP request no longer reads source bytes. It authorizes the person,
-- checks the mapping against both committed profiles, and records one job
-- here; the existing in-process P1 worker scheduling (immediate dispatch and
-- the per-minute sweep) claims it, reads both versions' bytes through the P1
-- exact-version reader, revalidates currentness, profile binding and allowed
-- use, and commits the measurements in kai.source_derived_measurements. The
-- claim, lease, bounded attempt budget and safe error token follow
-- kai.intake_p1_downstream_attempts. The job holds identities, the two
-- profile SHAs the request was checked against, the validated mapping (field
-- and value keys only), counters and the measurements it committed: never a cell value, identifier, file
-- content, storage location or error message.
--
-- Release order: apply after kai_sprint2_measurement_mvp_cross_source_reach
-- and before any application version that queues reconciliation jobs.

DO $$
BEGIN
  IF to_regclass('kai.source_derived_measurement_sources') IS NULL THEN
    RAISE EXCEPTION 'the cross-source reach migration is required before the cross-source reconciliation job migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.cross_source_reconciliation_jobs (
  reconciliation_job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  primary_source_version_id uuid NOT NULL,
  reference_source_version_id uuid NOT NULL,
  primary_profile_canonical_sha256 text NOT NULL,
  reference_profile_canonical_sha256 text NOT NULL,
  request_fingerprint text NOT NULL,
  mapping jsonb NOT NULL,
  job_state text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  claim_token uuid,
  claim_expires_at timestamptz,
  last_attempt_at timestamptz,
  next_eligible_at timestamptz,
  last_error_code text,
  measurement_ids uuid[],
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT cross_source_reconciliation_jobs_id_org_unique
    UNIQUE (reconciliation_job_id, organization_id),
  -- One job per (organization, exact request): a repeated request, or a
  -- retry of the same request, reads the same job.
  CONSTRAINT cross_source_reconciliation_jobs_request_unique
    UNIQUE (organization_id, request_fingerprint),
  CONSTRAINT cross_source_reconciliation_jobs_primary_version_fk
    FOREIGN KEY (primary_source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT cross_source_reconciliation_jobs_reference_version_fk
    FOREIGN KEY (reference_source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT cross_source_reconciliation_jobs_distinct_versions_check
    CHECK (primary_source_version_id <> reference_source_version_id),
  CONSTRAINT cross_source_reconciliation_jobs_profile_sha_check
    CHECK (primary_profile_canonical_sha256 ~ '^[a-f0-9]{64}$' AND reference_profile_canonical_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT cross_source_reconciliation_jobs_fingerprint_check
    CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT cross_source_reconciliation_jobs_mapping_check
    CHECK (jsonb_typeof(mapping) = 'object' AND kai.gate_a_p0_jsonb_metadata_only(mapping)),
  CONSTRAINT cross_source_reconciliation_jobs_state_check
    CHECK (job_state IN ('queued', 'in_progress', 'retry_scheduled', 'succeeded', 'failed', 'exhausted')),
  CONSTRAINT cross_source_reconciliation_jobs_attempt_count_check
    CHECK (attempt_count BETWEEN 0 AND 3),
  CONSTRAINT cross_source_reconciliation_jobs_error_code_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT cross_source_reconciliation_jobs_measurement_ids_check
    CHECK (measurement_ids IS NULL OR cardinality(measurement_ids) BETWEEN 1 AND 64),
  CONSTRAINT cross_source_reconciliation_jobs_state_fact_consistency_check
    CHECK (
      (job_state = 'queued'
        AND claim_token IS NULL AND claim_expires_at IS NULL AND next_eligible_at IS NULL
        AND last_error_code IS NULL AND measurement_ids IS NULL AND completed_at IS NULL
        AND attempt_count = 0)
      OR (job_state = 'in_progress'
        AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL AND last_attempt_at IS NOT NULL
        AND next_eligible_at IS NULL AND measurement_ids IS NULL AND completed_at IS NULL
        AND attempt_count BETWEEN 1 AND 3)
      OR (job_state = 'retry_scheduled'
        AND claim_token IS NULL AND claim_expires_at IS NULL AND last_attempt_at IS NOT NULL
        AND next_eligible_at IS NOT NULL AND last_error_code IS NOT NULL AND measurement_ids IS NULL
        AND completed_at IS NULL AND attempt_count BETWEEN 1 AND 2)
      OR (job_state = 'succeeded'
        AND claim_token IS NULL AND claim_expires_at IS NULL AND next_eligible_at IS NULL
        AND last_error_code IS NULL AND measurement_ids IS NOT NULL AND completed_at IS NOT NULL
        AND attempt_count BETWEEN 1 AND 3)
      OR (job_state IN ('failed', 'exhausted')
        AND claim_token IS NULL AND claim_expires_at IS NULL AND next_eligible_at IS NULL
        AND last_error_code IS NOT NULL AND measurement_ids IS NULL AND completed_at IS NOT NULL
        AND attempt_count BETWEEN 1 AND 3
        AND (job_state = 'failed' OR attempt_count = 3))
    )
);

-- Serves the sweep's due-job selection and the organization's job list.
CREATE INDEX IF NOT EXISTS ix_cross_source_reconciliation_jobs_due
  ON kai.cross_source_reconciliation_jobs (job_state, next_eligible_at, claim_expires_at);
CREATE INDEX IF NOT EXISTS ix_cross_source_reconciliation_jobs_tenant_created
  ON kai.cross_source_reconciliation_jobs (organization_id, created_at DESC);

COMMIT;
