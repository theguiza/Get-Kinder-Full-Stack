BEGIN;

DROP TRIGGER IF EXISTS trg_p14_08a_grppem_append_only ON kai.grant_response_packet_export_manifests;
DROP TABLE IF EXISTS kai.grant_response_packet_export_manifests;
DROP FUNCTION IF EXISTS kai.p14_08a_reject_manifest_mutation();

COMMIT;
