BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.organizations') IS NULL THEN
    RAISE EXCEPTION 'kai.organizations is required before the Package G improvement-practices-foundation migration';
  END IF;
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before the Package G improvement-practices-foundation migration';
  END IF;
  IF to_regclass('kai.gap_log_items') IS NULL THEN
    RAISE EXCEPTION 'kai.gap_log_items is required before the Package G improvement-practices-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'gap_log_items'
       AND c.conname = 'gap_log_items_p2_04_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.gap_log_items_p2_04_id_org_unique is required before the Package G improvement-practices-foundation migration';
  END IF;
END $$;

-- Package G owner decision (Improvement Plan / Improvement Practices):
-- one new, additive, MUTABLE relation - kai.improvement_practices. Unlike
-- the append-only decision/snapshot ledgers elsewhere in this schema, a
-- practice's status/cadence/next_due_date/responsible actor are ordinary,
-- in-place UPDATE targets (mirroring kai.impact_outcome_contexts' plain
-- mutable shape, not the P2-12/P3-16 supersession-ledger pattern) - a
-- recommended/active/paused/completed practice is the same row throughout
-- its lifecycle, not a new row per transition.
--
-- Tenant scoping: organization_id is the tenant key (every write and read is
-- organization-scoped). engagement_id is optional (NULL means an
-- organization-level practice, not tied to any single Project/Engagement)
-- and, when present, is bound through the composite (engagement_id,
-- organization_id) -> kai.engagements foreign key, exactly like
-- kai.impact_outcome_contexts, so an engagement can never be attached to an
-- organization other than the one that owns it.
--
-- Origin linkage (deliberately bounded): a practice may optionally relate to
-- the ONE gap-like object type this schema already has a real, addressable,
-- tenant-safe identity for - kai.gap_log_items - via the same composite FK
-- convention (gap_log_item_id, organization_id) -> kai.gap_log_items
-- (gap_log_item_id, organization_id). kai.client_followup_items and
-- kai.coverage_review_decisions are distinct, incompatible shapes (their own
-- PK types and natural keys); a single polymorphic origin FK across all of
-- them is NOT built here - that is explicitly deferred, not fabricated. A
-- human-created practice with no gap origin simply leaves gap_log_item_id
-- NULL.
--
-- responsible_actor_user_id is a bare, unconstrained uuid, matching this
-- schema's existing convention for actor-identity columns (decided_by,
-- confirmed_by, created_by, etc. - none of which carry a foreign key to a
-- users table anywhere in this codebase); the identity system this column
-- names is owned outside kai and outside this migration.
CREATE TABLE IF NOT EXISTS kai.improvement_practices (
  improvement_practice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,
  gap_log_item_id uuid,

  title text NOT NULL,
  rationale text NOT NULL,
  status text NOT NULL DEFAULT 'recommended',
  cadence text NOT NULL,
  next_due_date date,
  responsible_actor_user_id uuid,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT improvement_practices_g_id_org_unique
    UNIQUE (improvement_practice_id, organization_id),
  CONSTRAINT improvement_practices_g_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES kai.organizations (organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT improvement_practices_g_engagement_fk
    FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT improvement_practices_g_gap_log_item_fk
    FOREIGN KEY (gap_log_item_id, organization_id)
    REFERENCES kai.gap_log_items (gap_log_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT improvement_practices_g_title_check
    CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  CONSTRAINT improvement_practices_g_rationale_check
    CHECK (btrim(rationale) <> '' AND char_length(rationale) <= 1000),
  CONSTRAINT improvement_practices_g_status_check
    CHECK (status IN ('recommended', 'active', 'paused', 'completed')),
  CONSTRAINT improvement_practices_g_cadence_check
    CHECK (cadence IN ('one_time', 'every_session', 'weekly', 'monthly', 'quarterly', 'annually', 'ongoing')),
  CONSTRAINT improvement_practices_g_created_by_type_check
    CHECK (created_by_type IN ('human', 'system'))
);

CREATE INDEX IF NOT EXISTS ix_improvement_practices_g_tenant_engagement
  ON kai.improvement_practices (organization_id, engagement_id);

CREATE INDEX IF NOT EXISTS ix_improvement_practices_g_tenant_status
  ON kai.improvement_practices (organization_id, status);

CREATE INDEX IF NOT EXISTS ix_improvement_practices_g_tenant_gap
  ON kai.improvement_practices (organization_id, gap_log_item_id)
  WHERE gap_log_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION kai.touch_improvement_practices_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_improvement_practices_touch_updated_at ON kai.improvement_practices;
CREATE TRIGGER trg_improvement_practices_touch_updated_at
BEFORE UPDATE ON kai.improvement_practices
FOR EACH ROW
EXECUTE FUNCTION kai.touch_improvement_practices_updated_at();

COMMIT;
