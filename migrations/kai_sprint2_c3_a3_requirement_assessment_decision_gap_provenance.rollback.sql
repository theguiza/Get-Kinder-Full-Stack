BEGIN;

DROP TRIGGER IF EXISTS trg_c3_a3_gap_links_append_only ON kai.ra_gap_links;
DROP FUNCTION IF EXISTS kai.c3_a3_reject_gap_link_mutation();

DROP TRIGGER IF EXISTS trg_c3_a3_gap_links_verify_snapshot ON kai.ra_gap_links;
DROP FUNCTION IF EXISTS kai.c3_a3_verify_gap_link_snapshot_matches_source();

DROP INDEX IF EXISTS kai.ix_ra_gap_links_c3_a3_gap;
DROP INDEX IF EXISTS kai.ix_ra_gap_links_c3_a3_assessment;
DROP TABLE IF EXISTS kai.ra_gap_links;

DROP INDEX IF EXISTS kai.ix_ra_claim_review_decision_links_c3_a3_decision;
DROP INDEX IF EXISTS kai.ix_ra_claim_review_decision_links_c3_a3_assessment;
DROP TABLE IF EXISTS kai.ra_claim_review_decision_links;

DROP INDEX IF EXISTS kai.ix_ra_evidence_review_decision_links_c3_a3_decision;
DROP INDEX IF EXISTS kai.ix_ra_evidence_review_decision_links_c3_a3_assessment;
DROP TABLE IF EXISTS kai.ra_evidence_review_decision_links;

COMMIT;
