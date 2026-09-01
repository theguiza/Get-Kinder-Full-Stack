BEGIN;

DROP INDEX IF EXISTS kai.ix_impact_evaluation_results_a1_3_evaluation;
DROP TABLE IF EXISTS kai.impact_evaluation_results;

DROP INDEX IF EXISTS kai.ix_impact_evaluations_a1_3_tenant_context;
DROP TABLE IF EXISTS kai.impact_evaluations;

ALTER TABLE IF EXISTS kai.impact_evaluation_criteria
  DROP CONSTRAINT IF EXISTS impact_evaluation_criteria_a1_3_id_framework_version_unique;

COMMIT;
