BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'generation_runs' AND column_name = 'engagement_id'
  ) AND EXISTS (
    SELECT 1 FROM kai.generation_runs WHERE engagement_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'P14-01 rollback refuses to drop kai.generation_runs.engagement_id while non-null engagement bindings exist; resolve or explicitly authorize data loss before rollback';
  END IF;
END $$;

ALTER TABLE kai.generation_runs
  DROP CONSTRAINT IF EXISTS generation_runs_p14_01_engagement_fk;

ALTER TABLE kai.generation_runs
  DROP COLUMN IF EXISTS engagement_id;

COMMIT;
