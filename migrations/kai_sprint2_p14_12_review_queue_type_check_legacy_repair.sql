BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P14-12 review-queue queue_type legacy-constraint repair migration';
  END IF;
END $$;

-- P14-12 scope (bounded schema-drift repair only): a USER_CONFIRMED
-- production snapshot showed kai.review_queue_items simultaneously carrying
-- an obsolete, pre-P1-06 review_queue_items_queue_type_check fixed allowlist
-- alongside the canonical, validated P1-06 review_queue_items_p1_06_queue_type_check
-- contract (already widened by BR-03A to admit board_reporting_candidate_review)
-- and the validated BR-03B Board review lifecycle contract. PostgreSQL CHECK
-- constraints are cumulative (ANDed), so the obsolete allowlist - which does
-- not include board_reporting_candidate_review - blocks every Board
-- candidate review-queue insert even though the newer, named contracts
-- already admit it. This is the same class of proven production drift P14-10
-- repaired for review_queue_items_target_object_type_check: an unnamed-by-the-
-- application, pre-P1-06 CHECK left in place when the canonical P1-06 table
-- contract was introduced onto the pre-existing shared production table
-- (migrations/kai_sprint2_legacy_generation_cutover_20260817.sql section 4
-- only ever adds the canonical P1-06 constraints by name; it never asserts
-- anything about, and never drops, this older constraint). No committed
-- migration in this repository has ever dropped
-- review_queue_items_queue_type_check.
--
-- This migration repairs that one proven, named drift only. It does not
-- widen any vocabulary beyond what review_queue_items_p1_06_queue_type_check
-- (as BR-03A last defined it) already authorizes, does not touch any other
-- constraint, and does not modify data rows.

-- Fail closed unless the canonical, validated P1-06 queue_type contract is
-- present and already admits board_reporting_candidate_review - proving the
-- Board-aware schema prerequisite by inspection of the live predicate, the
-- same discipline BR-03B established for this same constraint.
DO $$
DECLARE
  existing_predicate text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'review_queue_items'
     AND c.conname = 'review_queue_items_p1_06_queue_type_check'
     AND c.convalidated;

  IF existing_predicate IS NULL THEN
    RAISE EXCEPTION 'validated kai.review_queue_items_p1_06_queue_type_check is required before P14-12';
  END IF;

  IF position('''board_reporting_candidate_review''' IN existing_predicate) = 0 THEN
    RAISE EXCEPTION 'kai.review_queue_items_p1_06_queue_type_check does not admit board_reporting_candidate_review; refusing P14-12';
  END IF;
END $$;

-- Fail closed unless the validated BR-03B Board review lifecycle contract is
-- present, detected structurally (predicate shape), not by name, because the
-- BR-03B verifier already established this constraint's catalog name may be
-- truncated by PostgreSQL's 63-byte identifier limit.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'kai.review_queue_items'::regclass
       AND c.contype = 'c'
       AND c.convalidated
       AND pg_get_constraintdef(c.oid) LIKE '%board_reporting_candidate_review%'
       AND pg_get_constraintdef(c.oid) LIKE '%target_object_type = ''board_reporting_candidate''%'
       AND pg_get_constraintdef(c.oid) LIKE '%queue_status = ''open''%'
       AND pg_get_constraintdef(c.oid) LIKE '%queue_status = ''in_progress''%'
       AND pg_get_constraintdef(c.oid) LIKE '%queue_status = ''resolved''%'
       AND pg_get_constraintdef(c.oid) LIKE '%review_status = ''resolved''%'
  ) THEN
    RAISE EXCEPTION 'the validated BR-03B Board review lifecycle contract check is required before P14-12';
  END IF;
END $$;

-- The repair itself: remove ONLY the obsolete legacy allowlist. Safe and a
-- no-op if already absent (a database that never carried it, or a second run
-- of this migration).
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_queue_type_check;

COMMIT;
