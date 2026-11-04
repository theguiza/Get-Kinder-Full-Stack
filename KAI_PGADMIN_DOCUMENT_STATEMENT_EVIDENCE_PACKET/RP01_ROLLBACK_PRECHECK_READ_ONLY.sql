-- KAI document-statement evidence: ROLLBACK PRECHECK (read-only).
-- One SELECT. Counts only; no row contents. Changes nothing.
-- R01 status: NOT_APPLIED | SAFE_TO_ROLL_BACK | UNSAFE_ROLLBACK_REFUSES
WITH applied AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = to_regclass('kai.source_locators')
       AND conname = 'source_locators_p2_01_locator_type_check'
       AND pg_catalog.pg_get_constraintdef(oid) LIKE '%document_text_span%'
  ) AS yes
),
counts AS (
  SELECT (SELECT count(*) FROM kai.evidence_items
           WHERE evidence_type = 'source_document_statement' OR data_class = 'source_document_excerpt') AS evidence,
         (SELECT count(*) FROM kai.source_locators WHERE locator_type = 'document_text_span') AS locators
)
SELECT 'R01' AS check_id,
       'document-statement evidence rollback safety' AS description,
       CASE
         WHEN NOT applied.yes THEN 'NOT_APPLIED'
         WHEN counts.evidence = 0 AND counts.locators = 0 THEN 'SAFE_TO_ROLL_BACK'
         ELSE 'UNSAFE_ROLLBACK_REFUSES'
       END AS status,
       format('document evidence items: %s; document_text_span locators: %s', counts.evidence, counts.locators) AS observed
  FROM applied, counts;
