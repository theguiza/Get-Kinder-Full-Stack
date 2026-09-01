BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.organizations') IS NULL THEN
    RAISE EXCEPTION 'kai.organizations is required before the A1.1 impact-outcome-context migration';
  END IF;
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before the A1.1 impact-outcome-context migration';
  END IF;
END $$;

-- A1.1 owner decision (Impact Outcome Context Foundation): this migration
-- creates exactly one new, additive relation - the canonical subject that
-- future Impact Evaluations will evaluate. One row means "one intended
-- outcome/change for one stakeholder/population in one organizational
-- context." It never creates framework, evaluation, criterion-result,
-- provenance, requirement, funder, gap, UI, or AI-evaluation objects, and it
-- never modifies kai.organizations or kai.engagements (both pre-existing,
-- shared, KEEP_SHARED_IN_KAI objects owned outside this package).
--
-- Tenant scoping mirrors the owner-confirmed production shape: organization_id
-- is the tenant key (organization_id alone, since kai.organizations' primary
-- key is organization_id); engagement_id is optional (NULL means
-- organization-level impact knowledge, not tied to any single engagement) and,
-- when present, is bound through the composite
-- (engagement_id, organization_id) -> kai.engagements (engagement_id,
-- organization_id) foreign key so an engagement can never be attached to an
-- organization other than the one that owns it.
CREATE TABLE IF NOT EXISTS kai.impact_outcome_contexts (
  impact_outcome_context_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid,

  outcome_key text NOT NULL,
  outcome_statement text NOT NULL,

  stakeholder_key text NOT NULL,
  stakeholder_label text NOT NULL,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT impact_outcome_contexts_a1_1_id_org_unique
    UNIQUE (impact_outcome_context_id, organization_id),
  CONSTRAINT impact_outcome_contexts_a1_1_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES kai.organizations (organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT impact_outcome_contexts_a1_1_engagement_fk
    FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT impact_outcome_contexts_a1_1_outcome_key_check
    CHECK (outcome_key ~ '^[a-z][a-z0-9_]{0,95}$'),
  CONSTRAINT impact_outcome_contexts_a1_1_outcome_statement_check
    CHECK (btrim(outcome_statement) <> '' AND char_length(outcome_statement) <= 2000),
  CONSTRAINT impact_outcome_contexts_a1_1_stakeholder_key_check
    CHECK (stakeholder_key ~ '^[a-z][a-z0-9_]{0,95}$'),
  CONSTRAINT impact_outcome_contexts_a1_1_stakeholder_label_check
    CHECK (btrim(stakeholder_label) <> '' AND char_length(stakeholder_label) <= 200),
  CONSTRAINT impact_outcome_contexts_a1_1_created_by_type_check
    CHECK (created_by_type IN ('human', 'system')),

  -- Canonical-subject identity when the context is bound to an engagement:
  -- one row per organization/engagement/outcome/stakeholder tuple. This alone
  -- does not police the engagement_id IS NULL (organization-level) case,
  -- because SQL UNIQUE treats every NULL as distinct from every other NULL -
  -- that case is closed by the partial index below.
  CONSTRAINT impact_outcome_contexts_a1_1_identity_unique
    UNIQUE (organization_id, engagement_id, outcome_key, stakeholder_key)
);

-- Canonical-subject identity for organization-level contexts (engagement_id
-- IS NULL): one row per organization/outcome/stakeholder tuple. Required
-- because the table-level UNIQUE constraint above cannot see two NULL
-- engagement_id values as duplicates of each other.
CREATE UNIQUE INDEX IF NOT EXISTS ux_impact_outcome_contexts_a1_1_org_level_identity
  ON kai.impact_outcome_contexts (organization_id, outcome_key, stakeholder_key)
  WHERE engagement_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_impact_outcome_contexts_a1_1_tenant_engagement
  ON kai.impact_outcome_contexts (organization_id, engagement_id);

CREATE OR REPLACE FUNCTION kai.touch_impact_outcome_contexts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_impact_outcome_contexts_touch_updated_at ON kai.impact_outcome_contexts;
CREATE TRIGGER trg_impact_outcome_contexts_touch_updated_at
BEFORE UPDATE ON kai.impact_outcome_contexts
FOR EACH ROW
EXECUTE FUNCTION kai.touch_impact_outcome_contexts_updated_at();

COMMIT;
