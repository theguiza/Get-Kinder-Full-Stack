BEGIN;

DROP TRIGGER IF EXISTS trg_p3_17_human_authority_decisions_audience_compatibility ON kai.human_authority_decisions;
DROP TRIGGER IF EXISTS trg_p3_17_human_authority_decisions_append_only ON kai.human_authority_decisions;
DROP INDEX IF EXISTS kai.ux_human_authority_decisions_p3_17_single_successor;
DROP INDEX IF EXISTS kai.ux_human_authority_decisions_p3_17_root_per_lineage;
DROP TABLE IF EXISTS kai.human_authority_decisions;
DROP FUNCTION IF EXISTS kai.p3_17_enforce_decision_audience_compatibility();
DROP FUNCTION IF EXISTS kai.p3_17_reject_authority_mutation();

COMMIT;
