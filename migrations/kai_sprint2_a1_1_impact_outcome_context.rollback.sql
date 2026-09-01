BEGIN;

DROP TRIGGER IF EXISTS trg_impact_outcome_contexts_touch_updated_at ON kai.impact_outcome_contexts;
DROP FUNCTION IF EXISTS kai.touch_impact_outcome_contexts_updated_at();
DROP INDEX IF EXISTS kai.ix_impact_outcome_contexts_a1_1_tenant_engagement;
DROP INDEX IF EXISTS kai.ux_impact_outcome_contexts_a1_1_org_level_identity;
DROP TABLE IF EXISTS kai.impact_outcome_contexts;

COMMIT;
