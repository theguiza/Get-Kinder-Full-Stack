BEGIN;

-- Rollback of kai_sprint2_measurement_targets: refused while any target exists.
DO $$
BEGIN
  IF to_regclass('kai.measurement_targets') IS NOT NULL AND EXISTS (SELECT 1 FROM kai.measurement_targets) THEN
    RAISE EXCEPTION 'measurement target rollback refused: targets exist';
  END IF;
END $$;

DROP TABLE IF EXISTS kai.measurement_targets;

COMMIT;
