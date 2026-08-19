/*
Read-only structural verifier for the accepted repaired contract of
kai.review_queue_items.review_status:

  type    = text
  NOT NULL
  default = 'needs_gk_review'::text
  vocabulary = {proposed, needs_gk_review, resolved}

This intentionally does not assert anything about any other
kai.review_status_enum-backed column: the shared enum staying enum-typed
elsewhere is expected and correct, only this one column's contract changed.

Detects the exact incompatible drift this repository incident diagnosed: an
enum-backed review_status column (kai.review_status_enum, which lacks a
'resolved' label) reports FAIL here.

GOVERNING_CHECK_VOCABULARY proves the admitted set is EXACTLY
{proposed, needs_gk_review, resolved} - not merely a superset containing
those three strings. It extracts every quoted literal from the governing
CHECK's catalog-rendered definition (pg_get_constraintdef) and compares the
deduplicated, sorted set for equality, so a CHECK equivalent to
review_status IN ('proposed','needs_gk_review','resolved','unexpected_fourth_value')
reports FAIL here rather than PASS.
*/

WITH review_status_column AS (
  SELECT a.attnum, a.attnotnull, ty.typname, tn.nspname AS typnamespace,
         ty.typtype, pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_attribute a
    JOIN pg_class r ON r.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_type ty ON ty.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = ty.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
     AND a.attname = 'review_status' AND NOT a.attisdropped
),
governing_checks AS (
  SELECT c.conname, c.convalidated, pg_get_constraintdef(c.oid) AS constraint_definition, c.oid AS check_oid
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN review_status_column rsc ON true
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
     AND c.contype = 'c'
     AND rsc.attnum = ANY (c.conkey)
),
-- Literal values admitted by each governing CHECK, extracted from the
-- deterministic catalog-rendered expression (pg_get_constraintdef) rather
-- than matched by substring containment, so an admitted set is proven
-- exactly rather than merely shown to contain the three expected strings.
governing_check_literals AS (
  SELECT gc.check_oid,
         array_agg(DISTINCT (m.match)[1] ORDER BY (m.match)[1]) AS literal_set
    FROM governing_checks gc
    CROSS JOIN LATERAL regexp_matches(gc.constraint_definition, '''([^'']*)''', 'g') AS m(match)
   GROUP BY gc.check_oid
),
checks AS (
  SELECT 'COLUMN_TYPE_IS_TEXT' AS check_name, 'kai.review_queue_items.review_status' AS object_name,
         CASE WHEN EXISTS (SELECT 1 FROM review_status_column WHERE typname = 'text' AND typnamespace = 'pg_catalog')
              THEN 'PASS' ELSE 'FAIL' END AS status,
         'review_status must be pg_catalog.text, not an enum type' AS detail
  UNION ALL
  SELECT 'COLUMN_NOT_NULL', 'kai.review_queue_items.review_status',
         CASE WHEN EXISTS (SELECT 1 FROM review_status_column WHERE attnotnull) THEN 'PASS' ELSE 'FAIL' END,
         'review_status must remain NOT NULL'
  UNION ALL
  SELECT 'COLUMN_DEFAULT', 'kai.review_queue_items.review_status',
         CASE WHEN EXISTS (SELECT 1 FROM review_status_column WHERE default_expr = '''needs_gk_review''::text')
              THEN 'PASS' ELSE 'FAIL' END,
         'default must be exactly ''needs_gk_review''::text'
  UNION ALL
  SELECT 'EXACTLY_ONE_GOVERNING_CHECK', 'kai.review_queue_items.review_status',
         CASE WHEN (SELECT count(*) FROM governing_checks) = 1 THEN 'PASS' ELSE 'FAIL' END,
         'exactly one CHECK constraint must govern review_status'
  UNION ALL
  SELECT 'GOVERNING_CHECK_IS_VALIDATED', 'kai.review_queue_items.review_status',
         CASE WHEN EXISTS (SELECT 1 FROM governing_checks WHERE convalidated) THEN 'PASS' ELSE 'FAIL' END,
         'the governing CHECK must be validated, not NOT VALID'
  UNION ALL
  SELECT 'GOVERNING_CHECK_VOCABULARY', 'kai.review_queue_items.review_status',
         CASE WHEN EXISTS (
                SELECT 1 FROM governing_check_literals
                 WHERE literal_set = ARRAY['needs_gk_review', 'proposed', 'resolved']
              ) THEN 'PASS' ELSE 'FAIL' END,
         'the governing CHECK must admit EXACTLY {proposed, needs_gk_review, resolved} and no additional value'
)
SELECT check_name, object_name, status, detail
FROM checks
ORDER BY check_name;
