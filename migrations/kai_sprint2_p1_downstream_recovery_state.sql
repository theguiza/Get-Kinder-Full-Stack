BEGIN;

-- KAI P1 downstream recovery state (latency fix, Package 3).
--
-- Additive only: one new table. No existing table, column, constraint,
-- status vocabulary, or audit operation is altered. It records, per exact
-- committed P1-03 file profile and per downstream stage (P1-04 data
-- dictionary, P1-05 intake sensitivity profile), the bounded automatic
-- attempt budget and the PostgreSQL-owned claim that fences concurrent
-- workers. It stores no file content, profile content, error message, or
-- storage location: only identities, counters, timestamps, and a safe
-- lower-case error token.
--
-- Release order: this migration must be applied before any application
-- version whose P1 worker reads or writes kai.intake_p1_downstream_attempts.

DO $$
BEGIN
  IF to_regclass('kai.intake_file_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_file_profiles is required before the P1 downstream recovery-state migration';
  END IF;
  IF to_regclass('kai.data_dictionaries') IS NULL THEN
    RAISE EXCEPTION 'kai.data_dictionaries is required before the P1 downstream recovery-state migration';
  END IF;
  IF to_regclass('kai.intake_sensitivity_profiles') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_sensitivity_profiles is required before the P1 downstream recovery-state migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kai.intake_p1_downstream_attempts (
  organization_id uuid NOT NULL,
  intake_file_id uuid NOT NULL,
  file_profile_id uuid NOT NULL,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  checksum text NOT NULL,
  stage text NOT NULL,
  recovery_state text NOT NULL,
  attempt_count integer NOT NULL,
  claim_token uuid,
  claim_expires_at timestamptz,
  last_attempt_at timestamptz,
  next_eligible_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intake_p1_downstream_attempts_pkey
    PRIMARY KEY (organization_id, file_profile_id, stage),
  -- Bound to the exact committed profile identity (file, parser, verified
  -- checksum), so state recorded for one profile can never govern another.
  CONSTRAINT intake_p1_downstream_attempts_profile_fk
    FOREIGN KEY (file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
    REFERENCES kai.intake_file_profiles (file_profile_id, organization_id, intake_file_id, parser_name, parser_version, checksum)
    ON DELETE RESTRICT,
  CONSTRAINT intake_p1_downstream_attempts_stage_check
    CHECK (stage IN ('p1_04_data_dictionary', 'p1_05_sensitivity_profile')),
  CONSTRAINT intake_p1_downstream_attempts_state_check
    CHECK (recovery_state IN ('in_progress', 'retry_scheduled', 'succeeded', 'exhausted', 'operator_attention')),
  CONSTRAINT intake_p1_downstream_attempts_attempt_count_check
    CHECK (attempt_count BETWEEN 0 AND 3),
  CONSTRAINT intake_p1_downstream_attempts_checksum_check
    CHECK (checksum ~ '^[a-f0-9]{64}$'),
  CONSTRAINT intake_p1_downstream_attempts_error_code_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT intake_p1_downstream_attempts_state_fact_consistency_check
    CHECK (
      (recovery_state = 'in_progress'
        AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL
        AND last_attempt_at IS NOT NULL AND next_eligible_at IS NULL
        AND attempt_count BETWEEN 1 AND 3)
      OR (recovery_state = 'retry_scheduled'
        AND claim_token IS NULL AND claim_expires_at IS NULL
        AND last_attempt_at IS NOT NULL AND next_eligible_at IS NOT NULL
        AND last_error_code IS NOT NULL AND attempt_count BETWEEN 1 AND 2)
      OR (recovery_state = 'succeeded'
        AND claim_token IS NULL AND claim_expires_at IS NULL
        AND next_eligible_at IS NULL AND last_error_code IS NULL)
      OR (recovery_state = 'exhausted'
        AND claim_token IS NULL AND claim_expires_at IS NULL
        AND next_eligible_at IS NULL AND last_error_code IS NOT NULL
        AND attempt_count = 3)
      OR (recovery_state = 'operator_attention'
        AND claim_token IS NULL AND claim_expires_at IS NULL
        AND next_eligible_at IS NULL AND last_error_code IS NOT NULL
        AND attempt_count BETWEEN 1 AND 3)
    )
);

-- Serves the scheduled sweep's per-file exclusion and the tenant/file
-- operator read.
CREATE INDEX IF NOT EXISTS ix_intake_p1_downstream_attempts_tenant_file
  ON kai.intake_p1_downstream_attempts (organization_id, intake_file_id, checksum);

COMMIT;
