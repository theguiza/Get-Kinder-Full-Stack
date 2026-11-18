BEGIN;

-- KAI measurement calculation completion (owner-authorized 2026-11-18).
-- Additive and re-runnable: every existing row of every touched table stays
-- valid, and every existing branch of each widened CHECK is kept.
--
--   * kai.source_derived_measurements
--       - tabular_rate admits a rate in distinct identifiers
--         (kai_tabular_conditional_distinct_key_rate_v1), whose components are
--         identifier counts, not record counts (rate_counts_check branch);
--       - tabular_count and tabular_rate admit the basis
--         kai_tabular_verified_bytes_v1: a whole-day Project period applied by
--         recalculating from the verified uploaded file (exact partial
--         months), in addition to the committed-profile basis;
--       - cross_source_reach admits a primary worksheet, so a linked-reach
--         measurement may use a worksheet of a workbook on either side.
--   * kai.source_derived_measurement_sources records the worksheet of each
--     contributing source; a reference may be another worksheet of the same
--     source version (never the measurement's own worksheet).
--   * kai.cross_source_reconciliation_jobs gains a job kind: the existing
--     cross_source_reach jobs (now optionally with worksheets), and
--     tabular_exact_period jobs for one source version, which may carry the
--     person's validated interpretation.

DO $$
BEGIN
  IF to_regclass('kai.cross_source_reconciliation_jobs') IS NULL
    OR to_regclass('kai.source_derived_measurement_sources') IS NULL THEN
    RAISE EXCEPTION 'the cross-source reach and reconciliation job migrations are required before the measurement calculation completion migration';
  END IF;
END $$;

ALTER TABLE kai.source_derived_measurements
  DROP CONSTRAINT source_derived_measurements_method_family_check,
  ADD CONSTRAINT source_derived_measurements_method_family_check
    CHECK (
      (measurement_family = 'paired_outcome_change' AND calculation_method = 'p1_xlsx_paired_baseline_followup_numeric_change_v1'
        AND basis_version = 'kai_xlsx_paired_outcome_basis_v1' AND worksheet_key IS NOT NULL)
      OR (measurement_family = 'tabular_count'
        AND calculation_method IN ('kai_tabular_conditional_record_count_v1', 'kai_tabular_conditional_distinct_key_count_v1')
        AND basis_version IN ('kai_tabular_measurement_basis_v1', 'kai_tabular_verified_bytes_v1'))
      OR (measurement_family = 'tabular_rate'
        AND calculation_method IN ('kai_tabular_conditional_record_rate_v1', 'kai_tabular_conditional_distinct_key_rate_v1')
        AND basis_version IN ('kai_tabular_measurement_basis_v1', 'kai_tabular_verified_bytes_v1'))
      OR (measurement_family = 'cross_source_reach' AND calculation_method = 'kai_cross_source_linked_reach_v1'
        AND basis_version = 'kai_cross_source_reconciliation_v1')
    ),
  DROP CONSTRAINT source_derived_measurements_rate_counts_check,
  ADD CONSTRAINT source_derived_measurements_rate_counts_check
    CHECK (
      measurement_family <> 'tabular_rate'
      OR (
        calculation_method IS DISTINCT FROM 'kai_tabular_conditional_distinct_key_rate_v1'
        AND (component_counts->>'population_record_count')::bigint = denominator
        AND (component_counts->>'numerator_record_count')::bigint = numerator
        AND (component_counts->>'other_population_record_count')::bigint = denominator - numerator
      )
      OR (
        calculation_method = 'kai_tabular_conditional_distinct_key_rate_v1'
        AND definition->'unit'->>'kind' = 'distinct_key'
        AND (component_counts->>'population_distinct_key_count')::bigint = denominator
        AND (component_counts->>'numerator_distinct_key_count')::bigint = numerator
        AND (component_counts->>'other_population_distinct_key_count')::bigint = denominator - numerator
        AND numerator <= (component_counts->>'numerator_record_count')::bigint
        AND denominator <= (component_counts->>'population_record_count')::bigint
      )
    );

-- Contributing sources: the worksheet of each version a cross-source
-- measurement combines.
ALTER TABLE kai.source_derived_measurement_sources
  ADD COLUMN IF NOT EXISTS worksheet_key text,
  DROP CONSTRAINT IF EXISTS source_derived_measurement_sources_worksheet_key_check,
  ADD CONSTRAINT source_derived_measurement_sources_worksheet_key_check
    CHECK (worksheet_key IS NULL OR worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$'),
  DROP CONSTRAINT IF EXISTS source_derived_measurement_sources_version_unique;
CREATE UNIQUE INDEX IF NOT EXISTS source_derived_measurement_sources_version_worksheet_unique
  ON kai.source_derived_measurement_sources (source_derived_measurement_id, source_version_id, (COALESCE(worksheet_key, '')));

-- The primary row is the measurement's own version, profile and worksheet; a
-- reference row is another version, or another worksheet of the same one.
CREATE OR REPLACE FUNCTION kai.source_derived_measurement_source_admitted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  measurement record;
BEGIN
  SELECT measurement_family, source_version_id, profile_canonical_sha256, worksheet_key
    INTO measurement
    FROM kai.source_derived_measurements
   WHERE source_derived_measurement_id = NEW.source_derived_measurement_id
     AND organization_id = NEW.organization_id;
  IF NOT FOUND OR measurement.measurement_family <> 'cross_source_reach' THEN
    RAISE EXCEPTION 'a contributing source is recorded only for a cross-source measurement'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.source_role = 'primary' THEN
    IF NEW.source_version_id <> measurement.source_version_id
      OR NEW.profile_canonical_sha256 <> measurement.profile_canonical_sha256
      OR NEW.worksheet_key IS DISTINCT FROM measurement.worksheet_key THEN
      RAISE EXCEPTION 'the primary contributing source is the measurement''s own version, profile and worksheet'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.source_version_id = measurement.source_version_id
    AND (NEW.worksheet_key IS NULL OR NEW.worksheet_key IS NOT DISTINCT FROM measurement.worksheet_key) THEN
    RAISE EXCEPTION 'a reference contributing source is another version, or another worksheet of the same version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Calculation jobs: a kind, worksheets and, for an exact-period tabular
-- calculation of one version, the person's validated interpretation.
ALTER TABLE kai.cross_source_reconciliation_jobs
  ADD COLUMN IF NOT EXISTS job_kind text NOT NULL DEFAULT 'cross_source_reach',
  ADD COLUMN IF NOT EXISTS primary_worksheet_key text,
  ADD COLUMN IF NOT EXISTS reference_worksheet_key text,
  ADD COLUMN IF NOT EXISTS interpretation jsonb,
  ALTER COLUMN reference_source_version_id DROP NOT NULL,
  ALTER COLUMN reference_profile_canonical_sha256 DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS cross_source_reconciliation_jobs_distinct_versions_check,
  DROP CONSTRAINT IF EXISTS cross_source_reconciliation_jobs_profile_sha_check,
  DROP CONSTRAINT IF EXISTS cross_source_reconciliation_jobs_kind_check,
  DROP CONSTRAINT IF EXISTS cross_source_reconciliation_jobs_worksheet_check,
  DROP CONSTRAINT IF EXISTS cross_source_reconciliation_jobs_interpretation_check,
  ADD CONSTRAINT cross_source_reconciliation_jobs_kind_check
    CHECK (
      (job_kind = 'cross_source_reach'
        AND reference_source_version_id IS NOT NULL AND reference_profile_canonical_sha256 IS NOT NULL AND interpretation IS NULL
        AND (primary_source_version_id <> reference_source_version_id
          OR (primary_worksheet_key IS NOT NULL AND reference_worksheet_key IS NOT NULL AND primary_worksheet_key <> reference_worksheet_key)))
      OR (job_kind = 'tabular_exact_period'
        AND reference_source_version_id IS NULL AND reference_profile_canonical_sha256 IS NULL AND reference_worksheet_key IS NULL)
    ),
  ADD CONSTRAINT cross_source_reconciliation_jobs_profile_sha_check
    CHECK (primary_profile_canonical_sha256 ~ '^[a-f0-9]{64}$'
      AND (reference_profile_canonical_sha256 IS NULL OR reference_profile_canonical_sha256 ~ '^[a-f0-9]{64}$')),
  ADD CONSTRAINT cross_source_reconciliation_jobs_worksheet_check
    CHECK ((primary_worksheet_key IS NULL OR primary_worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$')
      AND (reference_worksheet_key IS NULL OR reference_worksheet_key ~ '^sheet_[1-9][0-9]{0,3}$')),
  ADD CONSTRAINT cross_source_reconciliation_jobs_interpretation_check
    CHECK (interpretation IS NULL OR jsonb_typeof(interpretation) = 'object');

COMMIT;
