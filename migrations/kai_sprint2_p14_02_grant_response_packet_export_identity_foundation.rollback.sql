BEGIN;

DROP TRIGGER IF EXISTS trg_p14_02_grant_response_packet_export_identities_append_only
  ON kai.grant_response_packet_export_identities;
DROP TABLE IF EXISTS kai.grant_response_packet_export_identities;
DROP FUNCTION IF EXISTS kai.p14_02_reject_identity_mutation();

COMMIT;
