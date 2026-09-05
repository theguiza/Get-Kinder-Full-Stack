BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.engagement_requirement_sets') IS NULL THEN
    RAISE EXCEPTION 'kai.engagement_requirement_sets is required before Package 2A engagement-requirement-set authority migration';
  END IF;
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before Package 2A engagement-requirement-set authority migration';
  END IF;
  IF to_regclass('kai.requirement_sets') IS NULL THEN
    RAISE EXCEPTION 'kai.requirement_sets is required before Package 2A engagement-requirement-set authority migration';
  END IF;
END $$;

-- Package 2A owner decision: extend only kai.engagement_requirement_sets so
-- applicability can be represented as reviewed human authority, current
-- effective applicability, append-only replacement lineage, and the exact
-- engagement target context approved at review time. Existing creator fields
-- remain the provenance for row creation; reviewed_* fields are the
-- applicability authority.
ALTER TABLE kai.engagement_requirement_sets
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by_role text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS applicability_effective_state text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS supersedes_engagement_requirement_set_id uuid,
  ADD COLUMN IF NOT EXISTS target_context_identity jsonb;

ALTER TABLE kai.engagement_requirement_sets
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_b1_1_identity_unique,
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_id_org_engagement_set_unique,
  ADD CONSTRAINT engagement_requirement_sets_package_2a_id_org_engagement_set_unique
    UNIQUE (engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id),
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_supersedes_fk,
  ADD CONSTRAINT engagement_requirement_sets_package_2a_supersedes_fk
    FOREIGN KEY (supersedes_engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id)
    REFERENCES kai.engagement_requirement_sets (engagement_requirement_set_id, organization_id, engagement_id, requirement_set_id)
    ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_not_self_superseding,
  ADD CONSTRAINT engagement_requirement_sets_package_2a_not_self_superseding
    CHECK (supersedes_engagement_requirement_set_id IS DISTINCT FROM engagement_requirement_set_id),
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_reviewed_authority_check,
  ADD CONSTRAINT engagement_requirement_sets_package_2a_reviewed_authority_check
    CHECK (
      (
        reviewed_by IS NULL
        AND reviewed_by_role IS NULL
        AND reviewed_at IS NULL
      )
      OR (
        reviewed_by IS NOT NULL
        AND reviewed_by_role IN ('gk_admin', 'gk_operator', 'gk_reviewer', 'client_admin')
        AND reviewed_at IS NOT NULL
      )
    ),
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_effective_state_check,
  ADD CONSTRAINT engagement_requirement_sets_package_2a_effective_state_check
    CHECK (applicability_effective_state IN ('pending_review', 'applicable', 'not_applicable', 'retired')),
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_reviewed_effective_consistency_check,
  ADD CONSTRAINT engagement_requirement_sets_package_2a_reviewed_effective_consistency_check
    CHECK (
      applicability_effective_state = 'pending_review'
      OR (
        applicability_status = 'confirmed'
        AND reviewed_by IS NOT NULL
        AND reviewed_by_role IS NOT NULL
        AND reviewed_at IS NOT NULL
        AND target_context_identity IS NOT NULL
      )
    ),
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_approved_target_check,
  ADD CONSTRAINT engagement_requirement_sets_package_2a_approved_target_check
    CHECK (
      target_context_identity IS NULL
      OR (
        jsonb_typeof(target_context_identity) = 'object'
        AND target_context_identity ? 'target_funder_id'
        AND target_context_identity ? 'target_framework'
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS ux_engagement_requirement_sets_package_2a_current_identity
  ON kai.engagement_requirement_sets (organization_id, engagement_id, requirement_set_id)
  WHERE supersedes_engagement_requirement_set_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_engagement_requirement_sets_package_2a_single_successor
  ON kai.engagement_requirement_sets (supersedes_engagement_requirement_set_id)
  WHERE supersedes_engagement_requirement_set_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_engagement_requirement_sets_package_2a_current_lookup
  ON kai.engagement_requirement_sets (organization_id, engagement_id, applicability_effective_state)
  WHERE supersedes_engagement_requirement_set_id IS NULL;

CREATE OR REPLACE FUNCTION kai.package_2a_reject_engagement_requirement_set_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Package 2A engagement-requirement-set authority history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_package_2a_engagement_requirement_sets_append_only
  ON kai.engagement_requirement_sets;

CREATE TRIGGER trg_package_2a_engagement_requirement_sets_append_only
  BEFORE UPDATE OR DELETE ON kai.engagement_requirement_sets
  FOR EACH ROW EXECUTE FUNCTION kai.package_2a_reject_engagement_requirement_set_mutation();

COMMIT;
