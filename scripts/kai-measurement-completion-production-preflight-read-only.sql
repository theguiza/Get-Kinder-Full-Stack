-- Exact measurement completion preflight; source revision ed37dddd167a5ce4543ca6ed841be090060b1242.
-- Catalogs only: no application rows, dynamic SQL, DDL or temporary objects.
-- Pins are reproducible from committed migrations on disposable PostgreSQL 16.
-- Unsupported majors STOP: do not interpret rendering differences as missing migrations.
-- F5 the COMPLETE file from a clean transaction. Preserve the final result grid.
-- AFTER inspecting/exporting that grid, execute ROLLBACK; SEPARATELY.
-- On any error, execute ROLLBACK; separately before retrying the complete file.
-- No production catalog evidence has yet been supplied: NOT_CONFIRMED.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog, kai, public;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH targets(name, capability) AS (
  VALUES ('source_derived_measurements', 'calculation'),
         ('source_derived_measurement_sources', 'calculation'),
         ('cross_source_reconciliation_jobs', 'calculation'),
         ('measurement_targets', 'targets')
), objects AS (
  SELECT t.name, 'table' AS kind, t.name AS identity,
    jsonb_build_array(c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
      c.relispartition, c.relreplident, c.reloptions,
      (SELECT count(*) FROM pg_inherits h WHERE h.inhrelid = c.oid OR h.inhparent = c.oid),
      (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid),
      (SELECT count(*) FROM pg_rewrite w WHERE w.ev_class = c.oid))::text AS definition
  FROM targets t JOIN pg_class c ON c.oid = to_regclass('kai.' || t.name)
  UNION ALL
  SELECT t.name, 'column', a.attname,
    jsonb_build_array(a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
      pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated,
      a.attcollation::regcollation::text)::text
  FROM targets t JOIN pg_attribute a ON a.attrelid = to_regclass('kai.' || t.name)
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT t.name, 'constraint', c.conname,
    jsonb_build_array(c.conname, c.contype, pg_get_constraintdef(c.oid), c.convalidated,
      c.condeferrable, c.condeferred, c.connoinherit,
      CASE WHEN c.contype = 'f' THEN c.confrelid::regclass::text END,
      (SELECT string_agg(p.oid::regprocedure::text, ',' ORDER BY p.oid::regprocedure::text COLLATE "C")
       FROM pg_depend dep JOIN pg_proc p ON p.oid = dep.refobjid
       WHERE dep.classid = 'pg_constraint'::regclass AND dep.objid = c.oid
         AND dep.refclassid = 'pg_proc'::regclass),
      (SELECT string_agg(jsonb_build_array(tr.tgrelid::regclass::text, tr.tgfoid::regprocedure::text,
          tr.tgtype, tr.tgenabled, tr.tgdeferrable, tr.tginitdeferred)::text, E'\n'
          ORDER BY tr.tgrelid::regclass::text COLLATE "C", tr.tgfoid::regprocedure::text COLLATE "C")
       FROM pg_trigger tr WHERE tr.tgconstraint = c.oid AND tr.tgisinternal))::text
  FROM targets t JOIN pg_constraint c ON c.conrelid = to_regclass('kai.' || t.name)
  UNION ALL
  SELECT t.name, 'index', c.relname,
    jsonb_build_array(c.relname, pg_get_indexdef(c.oid), i.indisvalid, i.indisready,
      i.indislive, i.indisunique, i.indimmediate, c.reloptions)::text
  FROM targets t JOIN pg_index i ON i.indrelid = to_regclass('kai.' || t.name)
  JOIN pg_class c ON c.oid = i.indexrelid
  UNION ALL
  SELECT t.name, 'trigger', tr.tgname,
    jsonb_build_array(tr.tgname, pg_get_triggerdef(tr.oid), tr.tgenabled,
      tr.tgfoid::regprocedure::text, tr.tgdeferrable, tr.tginitdeferred)::text
  FROM targets t JOIN pg_trigger tr ON tr.tgrelid = to_regclass('kai.' || t.name)
  WHERE NOT tr.tgisinternal
), facts AS (
  SELECT t.name || '.' || k.kind AS check_id,
    CASE WHEN to_regclass('kai.' || t.name) IS NULL THEN 'ABSENT'
         ELSE coalesce(md5(string_agg(o.definition, E'\n' ORDER BY o.identity COLLATE "C")), 'EMPTY') END AS signature
  FROM targets t CROSS JOIN (VALUES ('table'), ('column'), ('constraint'), ('index'), ('trigger')) k(kind)
  LEFT JOIN objects o ON o.name = t.name AND o.kind = k.kind
  GROUP BY t.name, k.kind
  UNION ALL
  SELECT 'function.' || v.name,
    coalesce(md5(pg_get_functiondef(p.oid) || jsonb_build_array(p.provolatile, p.prosecdef,
      p.proisstrict, p.proleakproof, p.proparallel, p.proconfig)::text), 'ABSENT')
  FROM (VALUES ('source_derived_measurement_source_admitted()'),
               ('source_derived_measurement_append_only()'),
               ('gate_a_p0_jsonb_metadata_only(jsonb)')) v(name)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure('kai.' || v.name)
  UNION ALL
  -- Guard IF NOT EXISTS against a reserved index name bound to another table.
  SELECT 'namespace.' || v.capability,
    coalesce(md5(string_agg(jsonb_build_array(c.relname, c.relkind,
      i.indrelid::regclass::text)::text, E'\n' ORDER BY c.relname COLLATE "C") FILTER (WHERE c.oid IS NOT NULL)), 'ABSENT')
  FROM (VALUES ('calculation', 'source_derived_measurement_sources_version_worksheet_unique'),
               ('targets', 'measurement_targets_pkey'),
               ('targets', 'measurement_targets_id_org_unique'),
               ('targets', 'measurement_targets_identity_root_unique'),
               ('targets', 'measurement_targets_single_successor_unique'),
               ('targets', 'ix_measurement_targets_identity')) v(capability, name)
  LEFT JOIN pg_class c ON c.relnamespace = to_regnamespace('kai') AND c.relname = v.name
  LEFT JOIN pg_index i ON i.indexrelid = c.oid
  GROUP BY v.capability
  UNION ALL
  SELECT 'type.measurement_targets',
    coalesce(md5(string_agg(jsonb_build_array(y.typname, y.typtype, y.typrelid::regclass::text)::text, E'\n'
      ORDER BY y.typname COLLATE "C")), 'ABSENT')
  FROM pg_type y WHERE y.typnamespace = to_regnamespace('kai')
    AND y.typname IN ('measurement_targets', '_measurement_targets')
), pins(check_id, pre_signature, post_signature, capability) AS (
  VALUES
-- BEGIN GENERATED PINS
    ('cross_source_reconciliation_jobs.column', '290521ad923bf4eee9f4139577341926', '619285957aad9d54d4bc7d5609d4b0a8', 'calculation'),
    ('cross_source_reconciliation_jobs.constraint', 'a3306714a4465c6a974d8623bd68b2ad', '03a92bd2495f88c95f3cad8b95cfd346', 'calculation'),
    ('cross_source_reconciliation_jobs.index', '8c3191b307567581852b80e9f002d8cf', '8c3191b307567581852b80e9f002d8cf', 'calculation'),
    ('cross_source_reconciliation_jobs.table', '090c1d0c464674ce48dac41eb7697c7a', '090c1d0c464674ce48dac41eb7697c7a', 'calculation'),
    ('cross_source_reconciliation_jobs.trigger', 'EMPTY', 'EMPTY', 'calculation'),
    ('function.gate_a_p0_jsonb_metadata_only(jsonb)', '23aa61b014feed8e38486cae014078e7', '23aa61b014feed8e38486cae014078e7', 'calculation'),
    ('function.source_derived_measurement_append_only()', '280e770348d8e059ac3b74e5001b4c3b', '280e770348d8e059ac3b74e5001b4c3b', 'shared'),
    ('function.source_derived_measurement_source_admitted()', 'ae5f729177d3d764bb8bc413a84bf592', '8839b1a9c8e73b07d48bb6ae4cdb83b3', 'calculation'),
    ('measurement_targets.column', 'ABSENT', 'a2ef86cd324a566fab601c71713aa53d', 'targets'),
    ('measurement_targets.constraint', 'ABSENT', 'cfa172e001ffcd0058155232937dfac1', 'targets'),
    ('measurement_targets.index', 'ABSENT', '02ac62eda2384a81bc6c6a8fa312e1ee', 'targets'),
    ('measurement_targets.table', 'ABSENT', '090c1d0c464674ce48dac41eb7697c7a', 'targets'),
    ('measurement_targets.trigger', 'ABSENT', '01e1be33ad5aa9442b1c5fc9400b1a86', 'targets'),
    ('namespace.calculation', 'ABSENT', 'e3a4c89299c8c92a67ccf46bc088b7ca', 'calculation'),
    ('namespace.targets', 'ABSENT', '32f832b6ea840da80ae49e500979137a', 'targets'),
    ('source_derived_measurement_sources.column', 'df8e7d4fa37d8ad9d2db0dea8e8efbb7', '5c792069b18b8198878035146ab402ba', 'calculation'),
    ('source_derived_measurement_sources.constraint', '97e1d423fe536d83df441d52a6776b3f', 'f353f0a283498b318aee82813a6dee72', 'calculation'),
    ('source_derived_measurement_sources.index', '80896faf6eee166f5fbc2dc2184f3cb3', 'e8bea896abd3befc66d07fa6f807887c', 'calculation'),
    ('source_derived_measurement_sources.table', '090c1d0c464674ce48dac41eb7697c7a', '090c1d0c464674ce48dac41eb7697c7a', 'calculation'),
    ('source_derived_measurement_sources.trigger', '8db8977cadf62171ea0dae5e1be79211', '8db8977cadf62171ea0dae5e1be79211', 'calculation'),
    ('source_derived_measurements.column', 'd1b21bf656f781afc95f9d2d4034a3b7', 'd1b21bf656f781afc95f9d2d4034a3b7', 'calculation'),
    ('source_derived_measurements.constraint', '3120652f8ee12ccd2ef2263004c909ac', '03d4d4a2971d8c8c0e642d5ba803d87d', 'calculation'),
    ('source_derived_measurements.index', 'daee8c76099b2dade317cd59a020f539', 'daee8c76099b2dade317cd59a020f539', 'calculation'),
    ('source_derived_measurements.table', '090c1d0c464674ce48dac41eb7697c7a', '090c1d0c464674ce48dac41eb7697c7a', 'calculation'),
    ('source_derived_measurements.trigger', '256837dc1dce349ef1e28cc83ad21f81', '256837dc1dce349ef1e28cc83ad21f81', 'calculation'),
    ('type.measurement_targets', 'ABSENT', '036d340669cec74ca34a1b52ca4f92c5', 'targets')
-- END GENERATED PINS
), checks AS (
  SELECT p.*, coalesce(f.signature, 'ABSENT') AS observed,
         coalesce(f.signature, 'ABSENT') = p.pre_signature AS pre_ok,
         coalesce(f.signature, 'ABSENT') = p.post_signature AS post_ok
  FROM pins p LEFT JOIN facts f USING (check_id)
), environment AS (
  SELECT current_setting('server_version_num')::integer / 10000 AS server_major,
    current_setting('transaction_read_only') = 'on' AS read_only
), decisions AS (
  SELECT 'calculation' AS capability,
    CASE WHEN NOT (SELECT server_major = 16 AND read_only FROM environment) THEN 'STOP_INCOMPATIBLE'
         WHEN bool_and(post_ok) THEN 'ALREADY_APPLIED'
         WHEN bool_and(pre_ok) THEN 'REQUIRED' ELSE 'STOP_INCOMPATIBLE' END AS status
  FROM checks WHERE capability IN ('calculation', 'shared')
  UNION ALL
  SELECT 'targets',
    CASE WHEN NOT (SELECT server_major = 16 AND read_only FROM environment) THEN 'STOP_INCOMPATIBLE'
         -- Target FK/append-only prerequisites: exact derived table in either known state.
         WHEN NOT (SELECT bool_and(pre_ok OR post_ok) FROM checks
                    WHERE check_id LIKE 'source_derived_measurements.%' OR capability = 'shared') THEN 'STOP_INCOMPATIBLE'
         WHEN bool_and(post_ok) THEN 'ALREADY_APPLIED'
         WHEN bool_and(pre_ok) THEN 'REQUIRED' ELSE 'STOP_INCOMPATIBLE' END
  FROM checks WHERE capability = 'targets'
), results AS (
  SELECT 10 AS seq, 'CHECK' AS row_kind, capability, check_id,
    CASE WHEN pre_ok AND post_ok THEN 'MATCH_BOTH' WHEN post_ok THEN 'MATCH_COMPLETED'
         WHEN pre_ok THEN 'MATCH_PREREQUISITE' ELSE 'MISMATCH' END AS status,
    pre_signature AS expected_prerequisite, post_signature AS expected_completed, observed,
    'Exact catalog signature; definitions in companion catalog evidence JSON.' AS detail
  FROM checks
  UNION ALL
  SELECT 20, 'ENVIRONMENT', 'shared', 'postgresql_major',
    CASE WHEN server_major = 16 AND read_only THEN 'PASS' ELSE 'STOP_INCOMPATIBLE' END,
    '16; read_only=on', '16; read_only=on', server_major::text || '; read_only=' || read_only::text,
    'PG16 rendering validated. Other majors require a disposable-major rehearsal; never replay on a hash mismatch.'
  FROM environment
  UNION ALL
  SELECT 30, 'MIGRATION', capability, capability, status, 'REQUIRED', 'ALREADY_APPLIED', status,
    CASE capability WHEN 'calculation' THEN 'Order 1: calculation completion; requires committed derived + cross-source reach + jobs schema.'
         ELSE 'Order 2: numerical targets; requires derived identity unique key, gen_random_uuid and preserved append-only function.' END
  FROM decisions
  UNION ALL
  SELECT 99, 'OVERALL', 'both', 'OVERALL',
    CASE WHEN bool_or(status = 'STOP_INCOMPATIBLE') THEN 'STOP_INCOMPATIBLE'
         WHEN bool_and(status = 'ALREADY_APPLIED') THEN 'SCHEMA_COMPATIBLE' ELSE 'SCHEMA_DELTA_REQUIRED' END,
    'NOT_CONFIRMED until owner executes', 'SCHEMA_COMPATIBLE', string_agg(capability || '=' || status, '; ' ORDER BY capability),
    'Return ALL rows. Assess preflight before any migration. Preserve grid, then separately execute ROLLBACK;.'
  FROM decisions
)
SELECT seq, row_kind, capability, check_id, status, expected_prerequisite, expected_completed, observed, detail
FROM results ORDER BY seq, capability, check_id;
