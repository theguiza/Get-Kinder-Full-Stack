BEGIN;

DROP TRIGGER IF EXISTS trg_p3_19_export_manifests_append_only ON kai.export_manifests;
DROP TABLE IF EXISTS kai.export_manifests;
DROP FUNCTION IF EXISTS kai.p3_19_reject_authority_mutation();

COMMIT;
