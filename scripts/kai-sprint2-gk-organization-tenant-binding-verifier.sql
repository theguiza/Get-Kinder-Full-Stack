DROP TABLE IF EXISTS gk_org_binding_results;
CREATE TEMP TABLE gk_org_binding_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO gk_org_binding_results
SELECT 'table_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'kai' AND table_name = 'gk_organization_bindings'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai.gk_organization_bindings exists';

INSERT INTO gk_org_binding_results
SELECT 'gk_organization_id_column_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'gk_organization_bindings'
                 AND column_name = 'gk_organization_id' AND data_type = 'integer' AND is_nullable = 'NO'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'gk_organization_id is a required integer column';

INSERT INTO gk_org_binding_results
SELECT 'kai_organization_id_column_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'gk_organization_bindings'
                 AND column_name = 'kai_organization_id' AND data_type = 'uuid' AND is_nullable = 'NO'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'kai_organization_id is a required uuid column';

INSERT INTO gk_org_binding_results
SELECT 'gk_organization_id_fk_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint c
                JOIN pg_class rel ON rel.oid = c.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                JOIN pg_class frel ON frel.oid = c.confrelid
                JOIN pg_namespace fnsp ON fnsp.oid = frel.relnamespace
               WHERE c.contype = 'f'
                 AND nsp.nspname = 'kai' AND rel.relname = 'gk_organization_bindings'
                 AND fnsp.nspname = 'public' AND frel.relname = 'organizations'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'gk_organization_id has a foreign key to public.organizations(id)';

INSERT INTO gk_org_binding_results
SELECT 'status_check_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_constraint
               WHERE conname = 'gk_organization_bindings_status_check'
                 AND pg_get_constraintdef(oid) LIKE '%''active''%''inactive''%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'status is constrained to active/inactive';

INSERT INTO gk_org_binding_results
SELECT 'status_default_active',
       CASE WHEN EXISTS (
              SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'kai' AND table_name = 'gk_organization_bindings'
                 AND column_name = 'status' AND column_default LIKE '%active%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'status defaults to active';

INSERT INTO gk_org_binding_results
SELECT 'unique_active_gk_org_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai' AND indexname = 'ux_gk_organization_bindings_active_gk_org'
                 AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE (status = ''active''%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one active binding per Get Kinder organization is schema-enforced';

INSERT INTO gk_org_binding_results
SELECT 'unique_active_kai_org_index_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_indexes
               WHERE schemaname = 'kai' AND indexname = 'ux_gk_organization_bindings_active_kai_org'
                 AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE (status = ''active''%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'at most one active binding per KAI tenant is schema-enforced';

INSERT INTO gk_org_binding_results
SELECT 'updated_at_trigger_present',
       CASE WHEN EXISTS (
              SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_gk_organization_bindings_touch_updated_at'
                 AND tgrelid = 'kai.gk_organization_bindings'::regclass
                 AND NOT tgisinternal
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'updated_at is touched automatically on UPDATE';

INSERT INTO gk_org_binding_results
SELECT 'no_other_kai_relation_introduced',
       CASE WHEN (
              SELECT count(*) FROM information_schema.tables WHERE table_schema = 'kai'
            ) = 1
            THEN 'PASS' ELSE 'FAIL' END,
       'this migration introduces exactly one kai schema relation in an otherwise-empty kai schema';

SELECT * FROM gk_org_binding_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gk_org_binding_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'gk_organization_tenant_binding verifier failed';
  END IF;
END $$;
