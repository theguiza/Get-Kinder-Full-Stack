BEGIN;

DROP TRIGGER IF EXISTS trg_p14_03_grppec_members_append_only
  ON kai.grant_response_packet_export_candidate_members;
DROP TABLE IF EXISTS kai.grant_response_packet_export_candidate_members;

DROP TRIGGER IF EXISTS trg_p14_03_grant_response_packet_export_candidates_append_only
  ON kai.grant_response_packet_export_candidates;
DROP TABLE IF EXISTS kai.grant_response_packet_export_candidates;

DROP FUNCTION IF EXISTS kai.p14_03_reject_candidate_mutation();

COMMIT;
