BEGIN;

-- Rollback draft for kai_sprint2_p1_downstream_recovery_state.sql.
--
-- Drops only the additive P1 downstream recovery-state table and its index;
-- no earlier-package table, column, constraint, or audit row is altered.
-- Dropping it discards attempt budgets, exhausted/operator-attention
-- markers, and active claims, so it must only follow the application
-- rollback (no running code may still reference the table) and must not be
-- run against shared or production data without separate authorization.

DROP INDEX IF EXISTS kai.ix_intake_p1_downstream_attempts_tenant_file;
DROP TABLE IF EXISTS kai.intake_p1_downstream_attempts;

COMMIT;
