BEGIN;

DROP INDEX IF EXISTS kai.ix_impact_evaluation_result_claim_links_a1_4_claim;
DROP INDEX IF EXISTS kai.ix_impact_evaluation_result_claim_links_a1_4_result;
DROP TABLE IF EXISTS kai.impact_evaluation_result_claim_links;

DROP INDEX IF EXISTS kai.ix_impact_evaluation_result_evidence_links_a1_4_evidence;
DROP INDEX IF EXISTS kai.ix_impact_evaluation_result_evidence_links_a1_4_result;
DROP TABLE IF EXISTS kai.impact_evaluation_result_evidence_links;

ALTER TABLE IF EXISTS kai.impact_evaluation_results
  DROP CONSTRAINT IF EXISTS impact_evaluation_results_a1_4_id_org_unique;

COMMIT;
