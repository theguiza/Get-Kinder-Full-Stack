-- KAI production structural capture pack.
-- Intended for later manual execution in the already-established production
-- pgAdmin workflow only. Do not execute in this reconciliation package.
-- Scope: PostgreSQL catalog metadata for schema "kai" only. No application
-- rows, tenant data, secrets, hosts, connection settings, or unrestricted
-- production data are selected.

\pset format csv
\pset tuples_only off
\pset footer off

SELECT
  'capture_metadata' AS section,
  current_database() AS database_name,
  current_schema() AS current_schema,
  version() AS postgresql_version,
  now() AT TIME ZONE 'UTC' AS captured_at_utc;

SELECT
  'schemas' AS section,
  n.nspname AS schema_name
FROM pg_namespace n
WHERE n.nspname = 'kai'
ORDER BY n.nspname;

SELECT
  'relations' AS section,
  n.nspname AS schema_name,
  c.relname AS relation_name,
  c.relkind AS relation_kind,
  obj_description(c.oid, 'pg_class') AS comment
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'kai'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
ORDER BY c.relkind, c.relname;

SELECT
  'columns' AS section,
  n.nspname AS schema_name,
  c.relname AS relation_name,
  a.attnum AS ordinal_position,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
  a.attnotnull AS not_null,
  a.attidentity AS identity_kind,
  a.attgenerated AS generated_kind,
  pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
  col_description(c.oid, a.attnum) AS comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = 'kai'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum;

SELECT
  'constraints' AS section,
  n.nspname AS schema_name,
  c.relname AS relation_name,
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS constraint_definition,
  con.convalidated AS validated
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'kai'
ORDER BY c.relname, con.contype, con.conname;

SELECT
  'indexes' AS section,
  schemaname AS schema_name,
  tablename AS table_name,
  indexname AS index_name,
  indexdef AS index_definition
FROM pg_indexes
WHERE schemaname = 'kai'
ORDER BY tablename, indexname;

SELECT
  'triggers' AS section,
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid, true) AS trigger_definition,
  t.tgenabled AS enabled_state
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'kai'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

SELECT
  'functions' AS section,
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS result_type,
  l.lanname AS language,
  p.prokind AS routine_kind,
  p.provolatile AS volatility,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'kai'
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

SELECT
  'types' AS section,
  n.nspname AS schema_name,
  t.typname AS type_name,
  t.typtype AS type_kind,
  e.enumlabel AS enum_label,
  e.enumsortorder AS enum_sort_order,
  pg_catalog.format_type(t.typbasetype, t.typtypmod) AS domain_base_type,
  pg_get_expr(t.typdefaultbin, 0) AS domain_default,
  t.typnotnull AS domain_not_null
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
LEFT JOIN pg_enum e ON e.enumtypid = t.oid
WHERE n.nspname = 'kai'
  AND t.typtype IN ('e', 'd', 'c')
ORDER BY t.typname, e.enumsortorder NULLS LAST;

SELECT
  'sequences' AS section,
  sequence_schema,
  sequence_name,
  data_type,
  start_value,
  minimum_value,
  maximum_value,
  increment,
  cycle_option
FROM information_schema.sequences
WHERE sequence_schema = 'kai'
ORDER BY sequence_name;

SELECT
  'views' AS section,
  schemaname AS schema_name,
  viewname AS view_name,
  definition AS view_definition
FROM pg_views
WHERE schemaname = 'kai'
UNION ALL
SELECT
  'materialized_views' AS section,
  schemaname AS schema_name,
  matviewname AS view_name,
  definition AS view_definition
FROM pg_matviews
WHERE schemaname = 'kai'
ORDER BY schema_name, view_name;

SELECT
  'dependencies' AS section,
  dependent_ns.nspname AS dependent_schema,
  dependent.relname AS dependent_object,
  dependent.relkind AS dependent_kind,
  referenced_ns.nspname AS referenced_schema,
  referenced.relname AS referenced_object,
  referenced.relkind AS referenced_kind,
  dep.deptype AS dependency_type
FROM pg_depend dep
JOIN pg_class dependent ON dependent.oid = dep.objid
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent.relnamespace
JOIN pg_class referenced ON referenced.oid = dep.refobjid
JOIN pg_namespace referenced_ns ON referenced_ns.oid = referenced.relnamespace
WHERE dependent_ns.nspname = 'kai'
  AND referenced_ns.nspname = 'kai'
ORDER BY dependent.relname, referenced.relname, dep.deptype;
