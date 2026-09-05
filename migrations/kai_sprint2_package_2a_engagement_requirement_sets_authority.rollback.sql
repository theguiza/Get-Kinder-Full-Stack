BEGIN;

DROP TRIGGER IF EXISTS trg_package_2a_engagement_requirement_sets_append_only
  ON kai.engagement_requirement_sets;

DROP INDEX IF EXISTS kai.ix_engagement_requirement_sets_package_2a_current_lookup;
DROP INDEX IF EXISTS kai.ux_engagement_requirement_sets_package_2a_single_successor;
DROP INDEX IF EXISTS kai.ux_engagement_requirement_sets_package_2a_current_identity;

ALTER TABLE kai.engagement_requirement_sets
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_approved_target_check,
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_reviewed_effective_consistency_check,
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_effective_state_check,
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_reviewed_authority_check,
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_not_self_superseding,
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_supersedes_fk,
  DROP CONSTRAINT IF EXISTS engagement_requirement_sets_package_2a_id_org_engagement_set_unique;

ALTER TABLE kai.engagement_requirement_sets
  ADD CONSTRAINT engagement_requirement_sets_b1_1_identity_unique
    UNIQUE (organization_id, engagement_id, requirement_set_id);

ALTER TABLE kai.engagement_requirement_sets
  DROP COLUMN IF EXISTS target_context_identity,
  DROP COLUMN IF EXISTS supersedes_engagement_requirement_set_id,
  DROP COLUMN IF EXISTS applicability_effective_state,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS reviewed_by_role,
  DROP COLUMN IF EXISTS reviewed_by;

DROP FUNCTION IF EXISTS kai.package_2a_reject_engagement_requirement_set_mutation();

COMMIT;
