-- KAI document-statement evidence: PREFLIGHT (read-only).
-- One SELECT. Changes nothing. Run with Execute script (F5) in pgAdmin.
-- Last row OVERALL: REQUIRED | ALREADY_APPLIED | STOP_INCOMPATIBLE.
--
-- A01-A02  server and privileges
-- P01-P03  prerequisites: the three Measurement MVP migrations that precede
--          kai_sprint2_document_statement_evidence in the tested chain
--          (P01 is also the migration's own guard)
-- D01-D05  the five CHECKs the migration replaces: PRE (before), POST
--          (after) or OTHER, by md5 of pg_get_constraintdef, and validated
-- M01      uniform state of D01-D05
WITH defs AS (
  SELECT c.conname, md5(pg_catalog.pg_get_constraintdef(c.oid)) AS def_md5, c.convalidated
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid IN (to_regclass('kai.evidence_items'), to_regclass('kai.source_locators'))
     AND c.conname IN (
       'evidence_items_p2_01_evidence_type_check',
       'evidence_items_p2_01_data_class_check',
       'evidence_items_p2_01m_type_class_pairing_check',
       'source_locators_p2_01_locator_type_check',
       'source_locators_p2_01_coordinates_check')
),
pins (ord, check_id, conname, pre_md5, post_md5) AS (
  VALUES
    (1, 'D01', 'evidence_items_p2_01_evidence_type_check',       '4d7dd56888442bab5e53c22385c935c7', 'aea45899884478a1fbdf6b870103d2f0'),
    (2, 'D02', 'evidence_items_p2_01_data_class_check',          'f313e70db87270d5e6c45b614115fe03', 'ddb26bb785cf6c4adf30a5e229e4f0f4'),
    (3, 'D03', 'evidence_items_p2_01m_type_class_pairing_check', 'e5f45a9ad2b05109c8585d2bb3724e44', 'fa3cc6ef6bfcc0f8218978fca9051299'),
    (4, 'D04', 'source_locators_p2_01_locator_type_check',       'bd2c76628ed9cb4c2cddb1ce0a1bdcc4', '20a79952e407a69bf7d7d46b6cc2bc45'),
    (5, 'D05', 'source_locators_p2_01_coordinates_check',        'd29ebf39f86552deec2e4e9f0a1b74a3', 'd5265a33039490287a63225d0c246401')
),
d AS (
  SELECT p.ord, p.check_id, p.conname,
         CASE
           WHEN count(x.conname) <> 1 THEN 'OTHER'
           WHEN bool_and(x.convalidated) IS NOT TRUE THEN 'OTHER'
           WHEN min(x.def_md5) = p.pre_md5 THEN 'PRE'
           WHEN min(x.def_md5) = p.post_md5 THEN 'POST'
           ELSE 'OTHER'
         END AS state,
         coalesce(min(x.def_md5), 'missing') AS observed
    FROM pins p LEFT JOIN defs x ON x.conname = p.conname
   GROUP BY p.ord, p.check_id, p.conname, p.pre_md5, p.post_md5
),
a AS (
  SELECT 'A01' AS check_id, 'server version (information)' AS description, 'PASS' AS status,
         current_setting('server_version') AS observed
  UNION ALL
  SELECT 'A02', 'connected role owns (or is a member of the owner of) kai.evidence_items and kai.source_locators',
         CASE WHEN to_regclass('kai.evidence_items') IS NOT NULL AND to_regclass('kai.source_locators') IS NOT NULL
                AND (SELECT bool_and(pg_catalog.pg_has_role(current_user, cl.relowner, 'MEMBER'))
                       FROM pg_catalog.pg_class cl WHERE cl.oid IN (to_regclass('kai.evidence_items'), to_regclass('kai.source_locators')))
              THEN 'PASS' ELSE 'FAIL' END,
         current_user
  UNION ALL
  SELECT 'P01', 'kai_sprint2_measurement_mvp_source_derived_measurements applied (derived evidence and locator CHECK values; the migration''s own guard)',
         CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = to_regclass('kai.source_locators')
                             AND conname = 'source_locators_p2_01_locator_type_check'
                             AND pg_catalog.pg_get_constraintdef(oid) LIKE '%source_derived_measurement_fields%')
               AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = to_regclass('kai.evidence_items')
                             AND conname = 'evidence_items_p2_01m_type_class_pairing_check'
                             AND pg_catalog.pg_get_constraintdef(oid) LIKE '%source_derived_measurement%')
               AND to_regclass('kai.source_derived_measurements') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce(to_regclass('kai.source_derived_measurements')::text, 'kai.source_derived_measurements missing')
  UNION ALL
  SELECT 'P02', 'kai_sprint2_measurement_mvp_cross_source_reach applied (kai.source_derived_measurement_sources exists)',
         CASE WHEN to_regclass('kai.source_derived_measurement_sources') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         coalesce(to_regclass('kai.source_derived_measurement_sources')::text, 'missing')
  UNION ALL
  SELECT 'P03', 'kai_sprint2_measurement_mvp_cross_source_reconciliation_jobs applied (kai.cross_source_reconciliation_jobs exists)',
         CASE WHEN to_regclass('kai.cross_source_reconciliation_jobs') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
         coalesce(to_regclass('kai.cross_source_reconciliation_jobs')::text, 'missing')
),
m AS (
  SELECT CASE
           WHEN bool_and(state = 'PRE') THEN 'uniform: REQUIRED'
           WHEN bool_and(state = 'POST') THEN 'uniform: ALREADY_APPLIED'
           ELSE 'mixed or other: ' || string_agg(check_id || '=' || state, ', ' ORDER BY ord)
         END AS observed,
         bool_and(state = 'PRE') AS all_pre,
         bool_and(state = 'POST') AS all_post
    FROM d
),
rows AS (
  SELECT 1 AS grp, check_id, description, status, observed FROM a
  UNION ALL
  SELECT 2, d.check_id, d.conname || ' is the pre-migration (PRE) or post-migration (POST) definition, validated', d.state, d.observed FROM d
  UNION ALL
  SELECT 3, 'M01', 'uniform state of D01-D05', CASE WHEN m.all_pre OR m.all_post THEN 'PASS' ELSE 'FAIL' END, m.observed FROM m
  UNION ALL
  SELECT 4, 'OVERALL', 'REQUIRED: run 01_MIGRATION. ALREADY_APPLIED: skip it. STOP_INCOMPATIBLE: run nothing.',
         CASE
           WHEN (SELECT bool_and(status = 'PASS') FROM a) AND m.all_pre THEN 'REQUIRED'
           WHEN (SELECT bool_and(status = 'PASS') FROM a) AND m.all_post THEN 'ALREADY_APPLIED'
           ELSE 'STOP_INCOMPATIBLE'
         END,
         m.observed
    FROM m
)
SELECT check_id, description, status, observed FROM rows ORDER BY grp, check_id;
