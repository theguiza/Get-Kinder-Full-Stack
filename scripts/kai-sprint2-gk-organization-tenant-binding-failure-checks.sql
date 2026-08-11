WITH checks AS (
  SELECT 'NO_NEW_RELATION_BEYOND_BINDING' AS check_name,
         'kai schema' AS object_name,
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.tables
            WHERE table_schema = 'kai'
              AND table_name <> 'gk_organization_bindings'
         ) THEN 'PASS' ELSE 'FAIL' END AS status,
         'this migration adds no relation beyond kai.gk_organization_bindings' AS detail
  UNION ALL
  SELECT 'NO_VIEW_EXPOSES_BINDING', 'kai schema',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM information_schema.views v
             JOIN information_schema.view_column_usage u
               ON u.view_schema = v.table_schema AND u.view_name = v.table_name
            WHERE v.table_schema = 'kai'
              AND u.column_name IN ('gk_organization_id', 'kai_organization_id')
         ) THEN 'PASS' ELSE 'FAIL' END,
         'no database view re-exposes the binding columns'
  UNION ALL
  SELECT 'FK_TARGETS_PUBLIC_ORGANIZATIONS_ID', 'kai.gk_organization_bindings',
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
         ) THEN 'PASS' ELSE 'FAIL' END,
         'the only foreign key this migration adds targets public.organizations(id) - no other table is referenced'
  UNION ALL
  SELECT 'STATUS_CHECK_CONSTRAINT_CLOSED_VOCABULARY', 'kai.gk_organization_bindings',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
            WHERE conname = 'gk_organization_bindings_status_check'
              AND pg_get_constraintdef(oid) = $$CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])))$$
         ) THEN 'PASS' ELSE 'FAIL' END,
         'status accepts exactly the two-value active/inactive vocabulary, nothing else'
  UNION ALL
  SELECT 'BOTH_ACTIVE_UNIQUENESS_INDEXES_ARE_PARTIAL', 'kai.gk_organization_bindings',
         CASE WHEN (
           SELECT count(*) FROM pg_indexes
            WHERE schemaname = 'kai' AND tablename = 'gk_organization_bindings'
              AND indexname IN ('ux_gk_organization_bindings_active_gk_org', 'ux_gk_organization_bindings_active_kai_org')
              AND indexdef LIKE '%WHERE (status = ''active''%'
         ) = 2 THEN 'PASS' ELSE 'FAIL' END,
         'both uniqueness guarantees are scoped to active rows only, so historical/inactive rows are never deleted to satisfy them'
  UNION ALL
  SELECT 'NO_CASCADE_DELETE_FROM_ORGANIZATIONS', 'kai.gk_organization_bindings',
         CASE WHEN NOT EXISTS (
           SELECT 1
             FROM pg_constraint c
             JOIN pg_class rel ON rel.oid = c.conrelid
             JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE c.contype = 'f'
              AND nsp.nspname = 'kai' AND rel.relname = 'gk_organization_bindings'
              AND c.confdeltype = 'c'
         ) THEN 'PASS' ELSE 'FAIL' END,
         'deleting a public.organizations row does not silently cascade-delete binding history'
)
SELECT 'GK_ORGANIZATION_TENANT_BINDING_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, object_name, status, detail
FROM checks
ORDER BY check_name, object_name;
