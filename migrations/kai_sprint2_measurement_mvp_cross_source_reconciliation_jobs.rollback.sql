BEGIN;

-- Rollback draft for kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs.sql.
--
-- Drops only the additive reconciliation job table and its indexes. Measurements
-- a job committed stay in kai.source_derived_measurements. Dropping the table
-- discards queued, running, failed and exhausted job state, so it must only
-- follow the application rollback (no running code may still reference the
-- table) and must not be run against shared or production data without
-- separate authorization. It is refused while any job is queued, running or
-- scheduled for retry.

DO $$
BEGIN
  IF to_regclass('kai.cross_source_reconciliation_jobs') IS NOT NULL
    AND EXISTS (SELECT 1 FROM kai.cross_source_reconciliation_jobs WHERE job_state IN ('queued', 'in_progress', 'retry_scheduled')) THEN
    RAISE EXCEPTION 'cross-source reconciliation jobs are still pending; roll the application back and let them settle first';
  END IF;
END $$;

DROP INDEX IF EXISTS kai.ix_cross_source_reconciliation_jobs_tenant_created;
DROP INDEX IF EXISTS kai.ix_cross_source_reconciliation_jobs_due;
DROP TABLE IF EXISTS kai.cross_source_reconciliation_jobs;

COMMIT;
