BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.generation_runs') IS NULL THEN
    RAISE EXCEPTION 'kai.generation_runs is required before P14-01 generation-run engagement-binding migration';
  END IF;
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before P14-01 generation-run engagement-binding migration';
  END IF;
END $$;

-- P14-01 scope (Grant Response Packet foundation, step 1 of N): bind NEW
-- generation runs to the authoritative kai.engagements project/use-case
-- container so a later package can resolve packet membership by engagement
-- rather than by heuristic (latest/newest/preferred) selection. This
-- migration adds exactly one new, additive, nullable lineage column plus its
-- tenant-safe composite foreign key. It does not touch
-- kai.generated_content_drafts (which already obtains engagement lineage
-- transitively through its existing kai.generation_runs FK), does not touch
-- kai.engagements, and does not tighten engagement_id to NOT NULL - a
-- historical generation_runs row with engagement_id = NULL is valid,
-- permanent, legacy state, not an error condition. Non-null engagement_id on
-- every NEW row is enforced at the service/write-contract layer
-- (Backend/kai/services/kaiGeneratedContentService.js), not by a database
-- constraint, so already-closed per-draft workflows (review, export-review,
-- export candidate/finalization, Markdown/CSV/PDF/DOCX, manifest history)
-- remain valid for legacy unbound rows.
ALTER TABLE kai.generation_runs
  ADD COLUMN IF NOT EXISTS engagement_id uuid;

-- Composite FK, following this repository's established engagement-binding
-- convention (e.g. kai_sprint2_a1_1_impact_outcome_context.sql): an
-- engagement can never be attached to an organization other than the one
-- that owns it. A NULL engagement_id (the legacy/historical case) is exempt
-- from FK enforcement under Postgres MATCH SIMPLE (the default), so no
-- backfill is required for this constraint to validate cleanly against
-- existing rows.
ALTER TABLE kai.generation_runs
  DROP CONSTRAINT IF EXISTS generation_runs_p14_01_engagement_fk,
  ADD CONSTRAINT generation_runs_p14_01_engagement_fk
    FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id)
    ON DELETE RESTRICT;

COMMIT;
