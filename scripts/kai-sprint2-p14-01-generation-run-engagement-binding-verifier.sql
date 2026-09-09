DROP TABLE IF EXISTS p14_01_results;
CREATE TEMP TABLE p14_01_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_01_results
SELECT 'generation_runs_engagement_id_column_exists_and_nullable',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'generation_runs'
                 AND column_name = 'engagement_id' AND data_type = 'uuid' AND is_nullable = 'YES'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.generation_runs.engagement_id exists, is uuid, and remains nullable for legacy compatibility';

INSERT INTO p14_01_results
SELECT 'generation_runs_engagement_fk_is_tenant_safe_composite',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conname = 'generation_runs_p14_01_engagement_fk'
                 AND c.conrelid = 'kai.generation_runs'::regclass
                 AND c.contype = 'f'
                 AND c.confrelid = 'kai.engagements'::regclass
                 AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (engagement_id, organization_id)%'
                 AND pg_get_constraintdef(c.oid) LIKE '%REFERENCES kai.engagements(engagement_id, organization_id)%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'generation_runs_p14_01_engagement_fk is a composite (engagement_id, organization_id) FK into kai.engagements, preventing cross-tenant attachment';

INSERT INTO p14_01_results
SELECT 'generated_content_drafts_not_directly_altered',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'generated_content_drafts'
                 AND column_name = 'engagement_id'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.generated_content_drafts is not directly altered: engagement lineage remains transitive through generation_run_id';

INSERT INTO p14_01_results
SELECT 'kai_engagements_not_altered',
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM pg_constraint c
               WHERE c.conrelid = 'kai.engagements'::regclass AND c.conname LIKE 'p14_01%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.engagements itself carries no P14-01-owned constraint (never mutated by this migration)';

SELECT * FROM p14_01_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_01_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-01 generation-run engagement-binding verifier failed';
  END IF;
END $$;
