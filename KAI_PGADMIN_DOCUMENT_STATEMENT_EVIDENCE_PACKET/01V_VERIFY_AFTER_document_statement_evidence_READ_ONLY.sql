-- KAI document-statement evidence: VERIFY AFTER (read-only).
-- One SELECT. Changes nothing. Run after 01_MIGRATION with Execute script (F5).
-- Every row PASS and OVERALL = PASS is required.
--
-- V01.1-5  each of the five CHECKs is exactly the migration's definition
--          (md5 of pg_get_constraintdef), validated and not deferrable
-- V01.6    the application's own capability probe
--          (DOCUMENT_EVIDENCE_SCHEMA_READY_SQL) reads true, so the
--          application offers document-statement extraction
-- V01.7    the prerequisite Measurement MVP tables still exist
-- V01.8    no document-statement row violates the statement pins
--          (needs_gk_review at creation is not required here: reviewed
--          rows are allowed; the internal-only and false use pins are)
WITH pins (ord, check_id, conname, post_md5) AS (
  VALUES
    (1, 'V01.1', 'evidence_items_p2_01_evidence_type_check',       'aea45899884478a1fbdf6b870103d2f0'),
    (2, 'V01.2', 'evidence_items_p2_01_data_class_check',          'ddb26bb785cf6c4adf30a5e229e4f0f4'),
    (3, 'V01.3', 'evidence_items_p2_01m_type_class_pairing_check', 'fa3cc6ef6bfcc0f8218978fca9051299'),
    (4, 'V01.4', 'source_locators_p2_01_locator_type_check',       '20a79952e407a69bf7d7d46b6cc2bc45'),
    (5, 'V01.5', 'source_locators_p2_01_coordinates_check',        'd5265a33039490287a63225d0c246401')
),
v AS (
  SELECT p.ord, p.check_id, p.conname || ' is the migration''s definition, validated, not deferrable' AS description,
         CASE WHEN count(c.oid) = 1
                AND min(md5(pg_catalog.pg_get_constraintdef(c.oid))) = p.post_md5
                AND bool_and(c.convalidated) AND NOT bool_or(c.condeferrable)
              THEN 'PASS' ELSE 'FAIL' END AS status,
         coalesce(min(md5(pg_catalog.pg_get_constraintdef(c.oid))), 'missing') AS observed
    FROM pins p
    LEFT JOIN pg_catalog.pg_constraint c
      ON c.conname = p.conname AND c.conrelid IN (to_regclass('kai.evidence_items'), to_regclass('kai.source_locators'))
   GROUP BY p.ord, p.check_id, p.conname, p.post_md5
),
probe AS (
  SELECT (
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint con
       WHERE con.conrelid = to_regclass('kai.evidence_items')
         AND con.conname = 'evidence_items_p2_01_evidence_type_check'
         AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%source_document_statement%'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint con
       WHERE con.conrelid = to_regclass('kai.source_locators')
         AND con.conname = 'source_locators_p2_01_locator_type_check'
         AND pg_catalog.pg_get_constraintdef(con.oid) LIKE '%document_text_span%'
    )
  ) AS ready
),
rows AS (
  SELECT ord, check_id, description, status, observed FROM v
  UNION ALL
  SELECT 6, 'V01.6', 'application capability probe (DOCUMENT_EVIDENCE_SCHEMA_READY_SQL) reads true',
         CASE WHEN probe.ready THEN 'PASS' ELSE 'FAIL' END, probe.ready::text FROM probe
  UNION ALL
  SELECT 7, 'V01.7', 'prerequisite Measurement MVP tables exist',
         CASE WHEN to_regclass('kai.source_derived_measurements') IS NOT NULL
                AND to_regclass('kai.source_derived_measurement_sources') IS NOT NULL
                AND to_regclass('kai.cross_source_reconciliation_jobs') IS NOT NULL
              THEN 'PASS' ELSE 'FAIL' END,
         concat_ws(', ', to_regclass('kai.source_derived_measurements')::text, to_regclass('kai.source_derived_measurement_sources')::text,
                   to_regclass('kai.cross_source_reconciliation_jobs')::text)
  UNION ALL
  SELECT 8, 'V01.8', 'document-statement evidence rows keep internal_only and the false public/funder/LLM/product-learning pins (count of violations)',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END, count(*)::text
    FROM kai.evidence_items
   WHERE evidence_type = 'source_document_statement'
     AND NOT (internal_only = true AND public_use_allowed = false AND funder_use_allowed = false
              AND llm_processing_allowed = false AND product_learning_allowed = false)
)
SELECT check_id, description, status, observed
  FROM (
    SELECT ord, check_id, description, status, observed FROM rows
    UNION ALL
    SELECT 99, 'OVERALL', 'every row PASS', CASE WHEN bool_and(status = 'PASS') THEN 'PASS' ELSE 'FAIL' END,
           count(*) FILTER (WHERE status <> 'PASS')::text || ' not PASS'
      FROM rows
  ) result
 ORDER BY ord;
