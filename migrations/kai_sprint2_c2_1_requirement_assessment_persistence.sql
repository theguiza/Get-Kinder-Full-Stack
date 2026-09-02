BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.organizations') IS NULL THEN
    RAISE EXCEPTION 'kai.organizations is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
  IF to_regclass('kai.requirements') IS NULL THEN
    RAISE EXCEPTION 'kai.requirements (B1.1) is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
  IF to_regclass('kai.impact_evaluation_results') IS NULL THEN
    RAISE EXCEPTION 'kai.impact_evaluation_results (A1.3) is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'evidence_items'
       AND c.conname = 'evidence_items_p2_01_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.evidence_items_p2_01_id_org_unique is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'claims'
       AND c.conname = 'claims_p2_03_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.claims_p2_03_id_org_unique is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'impact_evaluation_results'
       AND c.conname = 'impact_evaluation_results_a1_4_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.impact_evaluation_results_a1_4_id_org_unique (A1.4) is required before the C2.1 requirement-assessment-persistence migration';
  END IF;
END $$;

-- C2.1 owner decision (Requirement Assessment Persistence), following the
-- C2A design: this migration is a pure persistence foundation - it stores
-- only "does current governed organizational knowledge satisfy this
-- requirement" as a two-state value plus its explanation, together with
-- exact provenance to the governed objects that grounded it. It never
-- computes that state, never scores readiness, never encodes human
-- approval, and never generates a gap or recommendation - all of that is
-- explicitly out of scope for C2.1 and left to a later behavioral package.
--
-- Scope identity (C2A section 1): kai.requirements (B1.1) carries no
-- organization_id or engagement_id - it is shared catalogue data, and the
-- only existing mechanism that scopes a requirement to a tenant is
-- kai.engagement_requirement_sets (organization_id + engagement_id). A
-- requirement assessment is therefore identified by
-- organization_id + engagement_id + requirement_id: an engagement is
-- mandatory, never optional, matching the same composite-FK-to-engagements
-- convention B1.1 and A1.1 already established.
--
-- State vocabulary (C2A section 2): 'satisfied' | 'not_satisfied' is new,
-- smallest-fitting vocabulary. It is not P2-02/P2-04's
-- SUPPORTED_INPUT_EXISTS/PARTIAL_INPUT_EXISTS/NO_CURRENT_INPUT vocabulary
-- (that is a static, design-time judgment about whether a schema field
-- exists to map to - not a live judgment about current governed
-- knowledge), not engagement_requirement_sets.applicability_status (a
-- lifecycle state, not a satisfaction judgment), and not
-- coverage_review_decisions.decision (a human-approval vocabulary this
-- package is explicitly forbidden from encoding).
--
-- History (C2A section 3): append-only fingerprint ledger, structurally
-- analogous to P2-10's kai.coverage_review_decisions - never a literal
-- reuse of that table. state_fingerprint binds one assessment row to the
-- exact governed state it was computed against; a later reassessment is a
-- new INSERT under a new fingerprint, the prior row is never updated or
-- deleted, and the append-only trigger below rejects any UPDATE/DELETE
-- outright. Currency is derived at read time (recompute-and-compare), the
-- same mechanism P2-10 already established - no separate
-- superseded_at/is_current/version column is required.
--
-- Provenance (C2A "Provenance shape"): exactly three new, additive,
-- tenant-safe junction tables, mirroring A1.4's own explicit rejection of
-- a generic subject/object link table - evidence, claim, and Impact
-- Evaluation result provenance are three separate tables below, each with
-- its own typed foreign key and no descriptive/derived column beyond the
-- link's own bare identity. An assessment may carry zero, one, or many
-- rows in each link table; none is required. This migration never alters
-- A1.4 itself, never alters kai.requirements or any other B1 catalogue
-- table/row, and never touches kai.coverage_review_decisions or
-- kai.gap_log_items.
CREATE TABLE IF NOT EXISTS kai.requirement_assessments (
  requirement_assessment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  assessment_state text NOT NULL,
  assessment_explanation text NOT NULL,
  state_fingerprint text NOT NULL,

  created_by uuid,
  created_by_type text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT requirement_assessments_c2_1_id_org_unique
    UNIQUE (requirement_assessment_id, organization_id),
  -- Idempotent-replay / append-only identity, following the P2-10
  -- precedent exactly: a second INSERT under an identical recomputed
  -- fingerprint is a replay of the same assessment, not a new historical
  -- row. A materially different governed state produces a different
  -- fingerprint and is free to insert its own new row alongside every
  -- prior one.
  CONSTRAINT requirement_assessments_c2_1_identity_fingerprint_unique
    UNIQUE (organization_id, engagement_id, requirement_id, state_fingerprint),
  -- Engagement-side tenant-safe FK: the requirement assessment's
  -- engagement_id must belong to the exact same organization_id this row
  -- claims. requirement_id is deliberately a bare single-column FK to
  -- kai.requirements: that table carries no organization_id of its own
  -- (B1.1 shared/organization catalogue data), so there is no tenant pair
  -- to pin on the requirement side.
  CONSTRAINT requirement_assessments_c2_1_engagement_fk
    FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirement_assessments_c2_1_requirement_fk
    FOREIGN KEY (requirement_id)
    REFERENCES kai.requirements (requirement_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirement_assessments_c2_1_assessment_state_check
    CHECK (assessment_state IN ('satisfied', 'not_satisfied')),
  CONSTRAINT requirement_assessments_c2_1_state_fingerprint_check
    CHECK (state_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT requirement_assessments_c2_1_created_by_type_check
    CHECK (created_by_type IN ('human', 'system', 'ai'))
);

CREATE INDEX IF NOT EXISTS ix_requirement_assessments_c2_1_tenant_engagement_requirement
  ON kai.requirement_assessments (organization_id, engagement_id, requirement_id);

CREATE OR REPLACE FUNCTION kai.c2_1_reject_requirement_assessment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'C2.1 requirement-assessment history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_c2_1_requirement_assessments_append_only
  BEFORE UPDATE OR DELETE ON kai.requirement_assessments
  FOR EACH ROW EXECUTE FUNCTION kai.c2_1_reject_requirement_assessment_mutation();

-- C2.1 provenance table: one row is one traceable-support link from a
-- single requirement assessment to a single governed evidence item, both
-- pinned to the same tenant. No evidence_statement, locator, source
-- content, or review-state field is copied, referenced by name, or
-- otherwise present - this table's only payload is the identity of the
-- link itself, exactly mirroring A1.4's own evidence-link shape.
CREATE TABLE IF NOT EXISTS kai.requirement_assessment_evidence_links (
  requirement_assessment_evidence_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT requirement_assessment_evidence_links_c2_1_identity_unique
    UNIQUE (requirement_assessment_id, evidence_item_id),
  CONSTRAINT requirement_assessment_evidence_links_c2_1_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirement_assessment_evidence_links_c2_1_evidence_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_requirement_assessment_evidence_links_c2_1_assessment
  ON kai.requirement_assessment_evidence_links (requirement_assessment_id);

CREATE INDEX IF NOT EXISTS ix_requirement_assessment_evidence_links_c2_1_evidence
  ON kai.requirement_assessment_evidence_links (organization_id, evidence_item_id);

-- C2.1 provenance table: one row is one traceable-support link from a
-- single requirement assessment to a single governed claim, both pinned to
-- the same tenant. No claim_statement, claim_status, or review-state field
-- is copied, referenced by name, or otherwise present - mirroring A1.4's
-- own claim-link shape.
CREATE TABLE IF NOT EXISTS kai.requirement_assessment_claim_links (
  requirement_assessment_claim_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  claim_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT requirement_assessment_claim_links_c2_1_identity_unique
    UNIQUE (requirement_assessment_id, claim_id),
  CONSTRAINT requirement_assessment_claim_links_c2_1_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirement_assessment_claim_links_c2_1_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_requirement_assessment_claim_links_c2_1_assessment
  ON kai.requirement_assessment_claim_links (requirement_assessment_id);

CREATE INDEX IF NOT EXISTS ix_requirement_assessment_claim_links_c2_1_claim
  ON kai.requirement_assessment_claim_links (organization_id, claim_id);

-- C2.1 provenance table: one row is one traceable-support link from a
-- single requirement assessment to a single Impact Evaluation criterion
-- result, both pinned to the same tenant. No criterion identity, score,
-- narrative, or snapshot content is copied, referenced by name, or
-- otherwise present - this table's only payload is the identity of the
-- link itself. This migration never alters A1.4's own two link tables.
CREATE TABLE IF NOT EXISTS kai.requirement_assessment_evaluation_result_links (
  requirement_assessment_evaluation_result_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  impact_evaluation_result_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT requirement_assessment_evaluation_result_links_c2_1_identity_unique
    UNIQUE (requirement_assessment_id, impact_evaluation_result_id),
  CONSTRAINT requirement_assessment_evaluation_result_links_c2_1_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT requirement_assessment_evaluation_result_links_c2_1_result_fk
    FOREIGN KEY (impact_evaluation_result_id, organization_id)
    REFERENCES kai.impact_evaluation_results (impact_evaluation_result_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_requirement_assessment_evaluation_result_links_c2_1_assessment
  ON kai.requirement_assessment_evaluation_result_links (requirement_assessment_id);

CREATE INDEX IF NOT EXISTS ix_requirement_assessment_evaluation_result_links_c2_1_result
  ON kai.requirement_assessment_evaluation_result_links (organization_id, impact_evaluation_result_id);

COMMIT;
