BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P14-10 review-queue target_object_type schema-repair migration';
  END IF;
END $$;

-- P14-10 scope (bounded schema-drift repair only): a proven, USER_CONFIRMED
-- production snapshot showed kai.review_queue_items simultaneously carrying
-- an obsolete, pre-P1-06 review_queue_items_target_object_type_check fixed
-- allowlist alongside the canonical P1-06 table contract. That stale
-- allowlist does not include 'generated_content_draft', so it makes it
-- impossible to ever persist the P3-01/P3-04 generated_content_review queue
-- item this repository's generated-content persistence transaction
-- (Backend/kai/dictionary/postgresGeneratedContentRepository.js
-- persistCompleteSet) already relies on - reproduced locally as a real
-- PostgreSQL 23514 check_violation on exactly that constraint name. The
-- canonical repository schema (migrations/kai_sprint2_p1_06_review_queue.sql)
-- has never required that narrower allowlist: target-specific authority is
-- enforced separately by queue_type-scoped contracts (for example
-- review_queue_items_p3_04_generated_content_review_contract_check, left
-- completely untouched below), while the generic target_object_type
-- validation is only ever the simple length bound. No application code,
-- Anthropic/generation, P2-06/funder-authority, citation, VAL-GEN, frontend,
-- packet-composition, or export behavior is touched by this migration.
ALTER TABLE kai.review_queue_items
  DROP CONSTRAINT IF EXISTS review_queue_items_target_object_type_check;

-- Converge onto the exact canonical P1-06 generic contract. If a
-- differently-defined constraint of the canonical name already exists (an
-- unrecognized shape neither the stale legacy allowlist nor the canonical
-- bound), fail closed rather than silently replacing it - this migration
-- repairs the one proven, named drift only.
DO $$
DECLARE
  existing_def text;
  canonical_def CONSTANT text := 'CHECK (((length(target_object_type) >= 1) AND (length(target_object_type) <= 128)))';
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO existing_def
    FROM pg_constraint c
   WHERE c.conrelid = 'kai.review_queue_items'::regclass
     AND c.conname = 'review_queue_items_p1_06_target_object_type_check';

  IF existing_def IS NOT NULL THEN
    IF existing_def <> canonical_def THEN
      RAISE EXCEPTION 'kai.review_queue_items_p1_06_target_object_type_check exists with an unexpected definition (%) - refusing to silently replace it', existing_def;
    END IF;
    -- Already canonical (a database that never carried the stale legacy
    -- allowlist, or a second run of this migration): nothing further to do.
  ELSE
    IF EXISTS (
      SELECT 1 FROM kai.review_queue_items
       WHERE length(target_object_type) < 1 OR length(target_object_type) > 128
    ) THEN
      RAISE EXCEPTION 'kai.review_queue_items has target_object_type values outside the canonical 1..128 bound - cannot add review_queue_items_p1_06_target_object_type_check';
    END IF;
    ALTER TABLE kai.review_queue_items
      ADD CONSTRAINT review_queue_items_p1_06_target_object_type_check
      CHECK (length(target_object_type) BETWEEN 1 AND 128);
  END IF;
END $$;

COMMIT;
