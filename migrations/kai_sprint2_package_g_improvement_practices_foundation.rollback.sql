BEGIN;

DROP TRIGGER IF EXISTS trg_improvement_practices_touch_updated_at ON kai.improvement_practices;
DROP FUNCTION IF EXISTS kai.touch_improvement_practices_updated_at();
DROP INDEX IF EXISTS kai.ix_improvement_practices_g_tenant_gap;
DROP INDEX IF EXISTS kai.ix_improvement_practices_g_tenant_status;
DROP INDEX IF EXISTS kai.ix_improvement_practices_g_tenant_engagement;
DROP TABLE IF EXISTS kai.improvement_practices;

COMMIT;
