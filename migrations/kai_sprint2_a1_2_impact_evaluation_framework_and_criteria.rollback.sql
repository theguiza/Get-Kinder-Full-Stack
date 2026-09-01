BEGIN;

DROP INDEX IF EXISTS kai.ix_impact_evaluation_criteria_a1_2_framework_version;
DROP TABLE IF EXISTS kai.impact_evaluation_criteria;

DROP INDEX IF EXISTS kai.ux_impact_evaluation_framework_versions_a1_2_active_per_code;
DROP TABLE IF EXISTS kai.impact_evaluation_framework_versions;

COMMIT;
