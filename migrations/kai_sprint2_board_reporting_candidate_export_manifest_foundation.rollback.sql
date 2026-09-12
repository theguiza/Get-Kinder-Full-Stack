BEGIN;

-- Fail closed: this manifest identity is append-only and immutable, so
-- dropping the table while any manifest row exists would silently destroy
-- persisted Board export-manifest identity history. Mirrors the BR-04
-- rollback discipline (fail closed while occupied), not the earlier
-- P3-19/P14-08A precedent (which drop unconditionally).
DO $$
BEGIN
  IF to_regclass('kai.board_reporting_candidate_export_manifests') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM kai.board_reporting_candidate_export_manifests) THEN
      RAISE EXCEPTION 'board-reporting-candidate-export-manifest-foundation rollback refused: persisted manifest rows exist';
    END IF;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_brcem_append_only ON kai.board_reporting_candidate_export_manifests;
DROP TABLE IF EXISTS kai.board_reporting_candidate_export_manifests;
DROP FUNCTION IF EXISTS kai.brcem_reject_manifest_mutation();

COMMIT;
