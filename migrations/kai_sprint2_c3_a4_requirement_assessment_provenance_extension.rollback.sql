BEGIN;

DROP TRIGGER IF EXISTS trg_c3_a4_conflict_resolution_links_verify_participation ON kai.ra_conflict_resolution_links;
DROP FUNCTION IF EXISTS kai.c3_a4_verify_conflict_resolution_link_participation();

DROP INDEX IF EXISTS kai.ix_ra_conflict_resolution_links_c3_a4_conflict;
DROP INDEX IF EXISTS kai.ix_ra_conflict_resolution_links_c3_a4_assessment;
DROP TABLE IF EXISTS kai.ra_conflict_resolution_links;

DROP TRIGGER IF EXISTS trg_c3_a4_source_promotion_links_append_only ON kai.ra_source_promotion_links;
DROP FUNCTION IF EXISTS kai.c3_a4_reject_source_promotion_link_mutation();

DROP TRIGGER IF EXISTS trg_c3_a4_source_promotion_links_verify_snapshot ON kai.ra_source_promotion_links;
DROP FUNCTION IF EXISTS kai.c3_a4_verify_source_promotion_link_snapshot();

DROP INDEX IF EXISTS kai.ix_ra_source_promotion_links_c3_a4_evidence;
DROP INDEX IF EXISTS kai.ix_ra_source_promotion_links_c3_a4_assessment;
DROP TABLE IF EXISTS kai.ra_source_promotion_links;

DROP TRIGGER IF EXISTS trg_c3_a4_outcome_context_links_append_only ON kai.ra_outcome_context_links;
DROP FUNCTION IF EXISTS kai.c3_a4_reject_outcome_context_link_mutation();

DROP TRIGGER IF EXISTS trg_c3_a4_outcome_context_links_verify_snapshot ON kai.ra_outcome_context_links;
DROP FUNCTION IF EXISTS kai.c3_a4_verify_outcome_context_link_snapshot();

DROP INDEX IF EXISTS kai.ix_ra_outcome_context_links_c3_a4_context;
DROP INDEX IF EXISTS kai.ix_ra_outcome_context_links_c3_a4_assessment;
DROP TABLE IF EXISTS kai.ra_outcome_context_links;

COMMIT;
