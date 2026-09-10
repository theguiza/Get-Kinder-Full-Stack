BEGIN;

DROP TRIGGER IF EXISTS trg_p14_07b1_grppehad_append_only ON kai.grant_response_packet_human_authority_decisions;
DROP INDEX IF EXISTS kai.ux_grppehad_p14_07b1_single_successor;
DROP INDEX IF EXISTS kai.ux_grppehad_p14_07b1_root_per_lineage;
DROP TABLE IF EXISTS kai.grant_response_packet_human_authority_decisions;
DROP FUNCTION IF EXISTS kai.p14_07b1_reject_authority_mutation();

COMMIT;
