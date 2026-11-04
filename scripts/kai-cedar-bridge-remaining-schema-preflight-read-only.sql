-- Cedar Bridge remaining schema preflight. Catalogs only; no application rows.
-- Execute the complete file in the owner's existing pgAdmin Query Tool.
-- Pins are from the actual migrations on disposable PostgreSQL 16.
-- Exact catalog drift (including extra indexes) stops for review, never repair.
-- Keep the status SELECT last so pgAdmin displays its result grid.
-- After reviewing the grid, execute COMMIT separately to close this read-only
-- transaction. Do not append COMMIT to this script: it returns no result rows.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, kai, public;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH targets(name) AS (
  VALUES ('source_derived_measurement_sources'), ('cross_source_reconciliation_jobs')
), objects AS (
  SELECT t.name, 'table' AS kind, c.relkind::text AS identity,
         jsonb_build_array(c.relkind, c.relrowsecurity, c.relforcerowsecurity)::text AS definition
    FROM targets t JOIN pg_class c ON c.oid = to_regclass('kai.' || t.name)
  UNION ALL
  SELECT t.name, 'column', a.attname,
         jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                           pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated)::text
    FROM targets t JOIN pg_attribute a ON a.attrelid = to_regclass('kai.' || t.name)
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT t.name, 'constraint', c.conname,
         jsonb_build_array(c.conname, c.contype, pg_get_constraintdef(c.oid), c.convalidated, c.condeferrable)::text
    FROM targets t JOIN pg_constraint c ON c.conrelid = to_regclass('kai.' || t.name)
  UNION ALL
  SELECT t.name, 'index', c.relname,
         jsonb_build_array(c.relname, pg_get_indexdef(c.oid), i.indisvalid, i.indisready, i.indislive)::text
    FROM targets t JOIN pg_index i ON i.indrelid = to_regclass('kai.' || t.name)
    JOIN pg_class c ON c.oid = i.indexrelid
  UNION ALL
  SELECT t.name, 'trigger', tr.tgname,
         jsonb_build_array(tr.tgname, pg_get_triggerdef(tr.oid), tr.tgenabled)::text
    FROM targets t JOIN pg_trigger tr ON tr.tgrelid = to_regclass('kai.' || t.name)
   WHERE NOT tr.tgisinternal
), facts AS (
  SELECT t.name, coalesce(md5(string_agg(o.definition, E'\n' ORDER BY o.kind, o.identity)), 'ABSENT') AS signature
    FROM targets t LEFT JOIN objects o USING (name) GROUP BY t.name
  UNION ALL
  SELECT c.conname, md5(jsonb_build_array(pg_get_constraintdef(c.oid), c.convalidated, c.condeferrable)::text)
    FROM pg_constraint c
   WHERE (c.conrelid = to_regclass('kai.source_derived_measurements') AND c.conname IN
           ('source_derived_measurements_method_family_check', 'source_derived_measurements_arithmetic_check'))
      OR (c.conrelid = to_regclass('kai.evidence_items') AND c.conname IN
           ('evidence_items_p2_01_evidence_type_check', 'evidence_items_p2_01_data_class_check', 'evidence_items_p2_01m_type_class_pairing_check'))
      OR (c.conrelid = to_regclass('kai.source_locators') AND c.conname IN
           ('source_locators_p2_01_locator_type_check', 'source_locators_p2_01_coordinates_check'))
  UNION ALL
  SELECT p.proname, md5(jsonb_build_array(p.prosrc, l.lanname, p.prorettype::regtype::text,
                                         p.provolatile, p.prosecdef, p.proconfig)::text)
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid IN (to_regprocedure('kai.source_derived_measurement_source_admitted()'),
                   to_regprocedure('kai.source_derived_measurement_append_only()'),
                   to_regprocedure('kai.gate_a_p0_jsonb_metadata_only(jsonb)'))
), pins(name, pre_signature, post_signature, capability) AS (
  VALUES
    ('source_derived_measurements_method_family_check', 'afd8fe93f13ae92229da74fe46b90858', 'fef8ba84fb253dd2a058488e3a6de7b8', 'reach'),
    ('source_derived_measurements_arithmetic_check', 'dc3d5be3467dd75aeb375ab1909d5174', '9c7d96417506956fe1956ec8fd15e71e', 'reach'),
    ('source_derived_measurement_sources', 'ABSENT', 'a2f27e0d622864951c4dff01160bd12d', 'reach'),
    ('source_derived_measurement_source_admitted', 'ABSENT', 'd65af988fef903daeee24155473a2e4b', 'reach'),
    ('cross_source_reconciliation_jobs', 'ABSENT', 'bb8e3956b3d27e5d602919659d5be84e', 'jobs'),
    ('source_derived_measurement_append_only', 'c647906395830f10fd59bb7dc12e78df', 'c647906395830f10fd59bb7dc12e78df', 'prerequisite'),
    ('gate_a_p0_jsonb_metadata_only', 'dcd67b0b8fa1ddcd8d93adf60ec4bd99', 'dcd67b0b8fa1ddcd8d93adf60ec4bd99', 'prerequisite'),
    ('evidence_items_p2_01_evidence_type_check', '1dde0d12d64601b043680cf4a813668f', '1dde0d12d64601b043680cf4a813668f', 'document'),
    ('evidence_items_p2_01_data_class_check', 'ef75f982302aef92a950377dbf9f695c', 'ef75f982302aef92a950377dbf9f695c', 'document'),
    ('evidence_items_p2_01m_type_class_pairing_check', '42931b83ed49eb4be0b01ba24d3266d8', '42931b83ed49eb4be0b01ba24d3266d8', 'document'),
    ('source_locators_p2_01_locator_type_check', '6986e44eb2ff191527cb3f04206ec7f1', '6986e44eb2ff191527cb3f04206ec7f1', 'document'),
    ('source_locators_p2_01_coordinates_check', '4b8b905a0d6368350959f9aaa42d8a3a', '4b8b905a0d6368350959f9aaa42d8a3a', 'document')
), states AS (
  SELECT p.capability,
         bool_and(coalesce(f.signature, 'ABSENT') = p.pre_signature) AS all_pre,
         bool_and(coalesce(f.signature, 'ABSENT') = p.post_signature) AS all_post,
         string_agg(p.name || '=' || coalesce(f.signature, 'ABSENT'), '; ' ORDER BY p.name) AS observed
    FROM pins p LEFT JOIN facts f USING (name) GROUP BY p.capability
), decision AS (
  SELECT capability,
         CASE WHEN all_post THEN 'ALREADY_APPLIED' WHEN all_pre THEN 'REQUIRED'
              ELSE 'STOP_INCOMPATIBLE' END AS status, observed
    FROM states
), result AS (
  SELECT capability,
         CASE WHEN EXISTS (SELECT 1 FROM decision WHERE capability IN ('document', 'prerequisite') AND status <> 'ALREADY_APPLIED')
                    OR EXISTS (SELECT 1 FROM decision WHERE status = 'STOP_INCOMPATIBLE')
                    OR ((SELECT status FROM decision WHERE capability = 'jobs') = 'ALREADY_APPLIED'
                        AND (SELECT status FROM decision WHERE capability = 'reach') <> 'ALREADY_APPLIED')
              THEN 'STOP_INCOMPATIBLE' ELSE status END AS status, observed
    FROM decision
)
SELECT capability, status, observed FROM result
UNION ALL
SELECT 'OVERALL', CASE WHEN bool_or(status = 'STOP_INCOMPATIBLE') THEN 'STOP_INCOMPATIBLE'
                       WHEN bool_or(status = 'REQUIRED') THEN 'REQUIRED' ELSE 'ALREADY_APPLIED' END,
       'Apply only REQUIRED: reach, then jobs. Retain the committed derived/document migrations. Run all existing verifiers.'
  FROM result
ORDER BY capability;
