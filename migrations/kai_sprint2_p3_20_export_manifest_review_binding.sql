BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.export_manifests') IS NULL THEN
    RAISE EXCEPTION 'kai.export_manifests is required before P3-20 export-manifest-review-binding migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_manifests_p3_19_candidate_fk'
  ) THEN
    RAISE EXCEPTION 'kai.export_manifests_p3_19_candidate_fk is required before P3-20 export-manifest-review-binding migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_manifests_p3_19_replay_convergence_unique'
  ) THEN
    RAISE EXCEPTION 'kai.export_manifests_p3_19_replay_convergence_unique is required before P3-20 export-manifest-review-binding migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P3-20 export-manifest-review-binding migration';
  END IF;
  IF to_regclass('kai.export_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.export_candidates is required before P3-20 export-manifest-review-binding migration';
  END IF;
  IF to_regclass('kai.ux_review_queue_items_p3_05_export_review_identity') IS NULL THEN
    RAISE EXCEPTION 'kai.ux_review_queue_items_p3_05_export_review_identity is required before P3-20 export-manifest-review-binding migration';
  END IF;
END $$;

-- P3-20 owner decision (controlled by the accepted
-- FUNCTIONAL_DEPENDENCY_PROOF: SELECTED_MODEL = DIRECT_MANIFEST_REVIEW_BINDING):
-- persist the exact originating export_review_queue_item_id on every P3-19
-- export manifest row. The proof established that P3-18's eligibility path
-- rejects any exportReviewQueueItemId whose target_object_id does not equal
-- the manifest's candidate's generated_content_draft_id
-- (isExportReviewQueueContractRow), and that P3-05's own
-- ux_review_queue_items_p3_05_export_review_identity unique index guarantees
-- at most one export_review row can ever exist for that draft - so exactly
-- one exportReviewQueueItemId is ever valid for a given manifest's candidate.
-- This migration persists that already-proven functional dependency; it does
-- not change what is eligible, and it deliberately does NOT add
-- UNIQUE(export_review_queue_item_id) or any latest/current/active column -
-- one review item legitimately backs multiple historical manifests (across
-- multiple export candidates for the same draft, and across P3-17
-- grant/revoke/re-grant cycles for the same candidate), and this migration
-- preserves that cardinality exactly.

-- kai.review_queue_items has no existing (review_queue_item_id,
-- organization_id) unique constraint (its primary key is
-- review_queue_item_id alone) - add the same tenant-safe identity pattern
-- already used by every other FK target table in this schema
-- (export_candidates_p3_16_id_org_unique,
-- human_authority_decisions_p3_17_id_org_unique, etc.) so a composite FK can
-- bind to it without ever crossing tenants.
ALTER TABLE kai.review_queue_items
  ADD CONSTRAINT review_queue_items_p3_20_id_org_unique
    UNIQUE (review_queue_item_id, organization_id);

-- Add nullable first: a NOT NULL column cannot be added to a populated table
-- in one step. The deterministic backfill below is proven, not assumed,
-- before this column is ever tightened to NOT NULL.
ALTER TABLE kai.export_manifests
  ADD COLUMN IF NOT EXISTS export_review_queue_item_id uuid;

-- Deterministic backfill for any manifest row that predates this column.
-- For each such row, the exact-one-per-draft P3-05 export_review queue item
-- for that manifest's own candidate's own generated_content_draft_id is the
-- only relational path available (P3-19's export_manifests deliberately
-- carries no generated_content_draft_id of its own - see
-- no_requested_audience_or_draft_id_column in the P3-19 verifier - so the
-- draft identity here is reached via export_candidates). If any existing
-- manifest resolves to zero or more than one candidate export_review row,
-- this migration fails closed rather than guessing - per owner instruction,
-- an ambiguous or missing backfill target is a STOP condition, not a
-- best-effort selection.
CREATE TEMP TABLE p3_20_legacy_manifest_backfill (
  export_manifest_id uuid PRIMARY KEY,
  matched_review_queue_item_id uuid NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  legacy_row RECORD;
  matched_review_queue_item_id uuid;
  matched_count integer;
BEGIN
  -- Resolve every legacy row's exact backfill target first, into a plain
  -- temp table, before touching kai.export_manifests itself with DDL/DML -
  -- an open cursor over that table would otherwise conflict with the
  -- ALTER TABLE ... DISABLE/ENABLE TRIGGER statements below.
  FOR legacy_row IN
    SELECT m.export_manifest_id, m.organization_id, c.generated_content_draft_id
      FROM kai.export_manifests m
      JOIN kai.export_candidates c
        ON c.export_candidate_id = m.export_candidate_id
       AND c.organization_id = m.organization_id
     WHERE m.export_review_queue_item_id IS NULL
  LOOP
    SELECT r.review_queue_item_id, COUNT(*) OVER ()
      INTO matched_review_queue_item_id, matched_count
      FROM kai.review_queue_items r
     WHERE r.organization_id = legacy_row.organization_id
       AND r.queue_type = 'export_review'
       AND r.target_object_type = 'generated_content_draft'
       AND r.target_object_id = legacy_row.generated_content_draft_id;

    IF matched_count IS NULL OR matched_count = 0 THEN
      RAISE EXCEPTION 'P3-20 export-manifest-review-binding backfill found zero export_review queue items for export_manifest_id % (organization_id %, generated_content_draft_id %) - refusing to guess', legacy_row.export_manifest_id, legacy_row.organization_id, legacy_row.generated_content_draft_id;
    ELSIF matched_count > 1 THEN
      RAISE EXCEPTION 'P3-20 export-manifest-review-binding backfill found % export_review queue items for export_manifest_id % (organization_id %, generated_content_draft_id %) - refusing to guess', matched_count, legacy_row.export_manifest_id, legacy_row.organization_id, legacy_row.generated_content_draft_id;
    END IF;

    INSERT INTO p3_20_legacy_manifest_backfill (export_manifest_id, matched_review_queue_item_id)
    VALUES (legacy_row.export_manifest_id, matched_review_queue_item_id);
  END LOOP;
END $$;

-- kai.export_manifests is append-only from the application's point of view
-- (trg_p3_19_export_manifests_append_only); this migration-owned backfill is
-- the one authorized, transaction-scoped exception, and the trigger is
-- re-enabled immediately below before this transaction commits, so no
-- ordinary UPDATE/DELETE is ever permitted again.
ALTER TABLE kai.export_manifests DISABLE TRIGGER trg_p3_19_export_manifests_append_only;

UPDATE kai.export_manifests m
   SET export_review_queue_item_id = b.matched_review_queue_item_id
  FROM p3_20_legacy_manifest_backfill b
 WHERE b.export_manifest_id = m.export_manifest_id;

ALTER TABLE kai.export_manifests ENABLE TRIGGER trg_p3_19_export_manifests_append_only;

-- The backfill above (if it ran at all) is now proven deterministic for
-- every existing row - safe to enforce NOT NULL.
ALTER TABLE kai.export_manifests
  ALTER COLUMN export_review_queue_item_id SET NOT NULL;

-- Tenant-safe existence binding only: this FK proves the referenced review
-- item exists and belongs to the same organization as the manifest. It
-- cannot itself express "target_object_type = 'generated_content_draft' AND
-- target_object_id = this candidate's draft" (review_queue_items is
-- deliberately polymorphic across queue_types with no FK on its own
-- target_object_id - see P1-06's migration notes), so that exact
-- correspondence remains the application layer's responsibility, proven by
-- the accepted FUNCTIONAL_DEPENDENCY_PROOF to already be enforced,
-- transactionally, by evaluateFinalExportEligibilityInTransaction before
-- this row is ever written.
ALTER TABLE kai.export_manifests
  ADD CONSTRAINT export_manifests_p3_20_review_queue_item_fk
    FOREIGN KEY (export_review_queue_item_id, organization_id)
    REFERENCES kai.review_queue_items (review_queue_item_id, organization_id)
    ON DELETE RESTRICT;

-- Read-path support only (no latest/current/active selection semantics):
-- an ordinary non-unique index for "all manifests originating from this
-- review item", still returning every historical row.
CREATE INDEX IF NOT EXISTS ix_export_manifests_p3_20_review_queue_item
  ON kai.export_manifests (organization_id, export_review_queue_item_id);

COMMIT;
