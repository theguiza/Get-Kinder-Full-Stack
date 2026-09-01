BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.impact_evaluation_results') IS NULL THEN
    RAISE EXCEPTION 'kai.impact_evaluation_results is required before the A1.4 provenance-links migration';
  END IF;
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before the A1.4 provenance-links migration';
  END IF;
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before the A1.4 provenance-links migration';
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
    RAISE EXCEPTION 'kai.evidence_items_p2_01_id_org_unique is required before the A1.4 provenance-links migration';
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
    RAISE EXCEPTION 'kai.claims_p2_03_id_org_unique is required before the A1.4 provenance-links migration';
  END IF;
END $$;

-- A1.4 owner decision (Impact Evaluation Provenance Links): this migration
-- adds exactly two new, additive tenant-safe junction tables plus the
-- single smallest A1.3 compatibility constraint required to make them
-- possible (see below) - never any descriptive, evaluative, or qualifying
-- column beyond the link's own bare identity, and never one
-- shared table addressed by a generic kind-plus-identifier pair standing in
-- for "evidence or claim" (evidence and claim provenance are two separate
-- tables below, each with its own typed foreign key). It never redesigns
-- the outcome-context foundation (A1.1), the framework-version/criteria
-- methodology layer (A1.2), or the evaluation/result snapshots (A1.3), and
-- it never alters the pre-existing governed evidence, claim, claim-gap,
-- client-followup, or funder relations from earlier packages.
--
-- Semantic boundary: a row in either link table below means only "this
-- governed evidence item or claim was used as traceable support for this
-- Impact Evaluation criterion result." It does not mean approved, causally
-- proven, human reviewed, eligible for every audience, requirement
-- covered, or gap resolved - none of those states live here, and neither
-- link table copies, derives, or mutates any evidence/claim content or
-- lifecycle field. Creating a link is a pure additive INSERT into a new
-- table; it cannot alter any column on kai.evidence_items or kai.claims,
-- because this migration adds no trigger, no view, and no write path
-- touching either table.
--
-- A1.3 compatibility constraint: kai.impact_evaluation_results was given a
-- PRIMARY KEY of impact_evaluation_result_id alone. Enforcing "this link's
-- organization_id matches its own result row's organization_id" as a
-- database-level composite FOREIGN KEY requires the referenced side to
-- itself carry a UNIQUE (or PRIMARY KEY) constraint on exactly
-- (impact_evaluation_result_id, organization_id). That constraint did not
-- exist after A1.3, so this migration adds the smallest possible redundant
-- unique constraint to permit it - it changes no column, no existing
-- constraint, and no existing behavior of kai.impact_evaluation_results.
ALTER TABLE kai.impact_evaluation_results
  ADD CONSTRAINT impact_evaluation_results_a1_4_id_org_unique
  UNIQUE (impact_evaluation_result_id, organization_id);

-- A1.4 foundation table: one row is one traceable-support link from a
-- single Impact Evaluation criterion result to a single governed evidence
-- item, both pinned to the same tenant. No evidence_statement, locator,
-- source content, review state, strength, audience-eligibility, or
-- allowed-use field is copied, referenced by name, or otherwise present -
-- this table's only payload is the identity of the link itself.
CREATE TABLE IF NOT EXISTS kai.impact_evaluation_result_evidence_links (
  impact_evaluation_result_evidence_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  impact_evaluation_result_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT impact_evaluation_result_evidence_links_a1_4_identity_unique
    UNIQUE (impact_evaluation_result_id, evidence_item_id),
  -- Result-side tenant-safe FK: the linked result must belong to the exact
  -- same organization_id this link row claims.
  CONSTRAINT impact_evaluation_result_evidence_links_a1_4_result_fk
    FOREIGN KEY (impact_evaluation_result_id, organization_id)
    REFERENCES kai.impact_evaluation_results (impact_evaluation_result_id, organization_id)
    ON DELETE RESTRICT,
  -- Evidence-side tenant-safe FK, reusing kai.evidence_items' own existing
  -- P2-01 tenant identity unchanged - a cross-organization evidence binding
  -- cannot satisfy this FK regardless of evidence_item_id's own validity.
  CONSTRAINT impact_evaluation_result_evidence_links_a1_4_evidence_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_impact_evaluation_result_evidence_links_a1_4_result
  ON kai.impact_evaluation_result_evidence_links (impact_evaluation_result_id);

CREATE INDEX IF NOT EXISTS ix_impact_evaluation_result_evidence_links_a1_4_evidence
  ON kai.impact_evaluation_result_evidence_links (organization_id, evidence_item_id);

-- A1.4 foundation table: one row is one traceable-support link from a
-- single Impact Evaluation criterion result to a single governed claim,
-- both pinned to the same tenant. No claim_statement, claim_status,
-- claim_review_status, claim strength, approval state, or audience-
-- eligibility field is copied, referenced by name, or otherwise present -
-- this table's only payload is the identity of the link itself, and this
-- migration adds no write path capable of mutating any of those fields on
-- kai.claims.
CREATE TABLE IF NOT EXISTS kai.impact_evaluation_result_claim_links (
  impact_evaluation_result_claim_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  impact_evaluation_result_id uuid NOT NULL,
  claim_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT impact_evaluation_result_claim_links_a1_4_identity_unique
    UNIQUE (impact_evaluation_result_id, claim_id),
  -- Result-side tenant-safe FK: the linked result must belong to the exact
  -- same organization_id this link row claims.
  CONSTRAINT impact_evaluation_result_claim_links_a1_4_result_fk
    FOREIGN KEY (impact_evaluation_result_id, organization_id)
    REFERENCES kai.impact_evaluation_results (impact_evaluation_result_id, organization_id)
    ON DELETE RESTRICT,
  -- Claim-side tenant-safe FK, reusing kai.claims' own existing P2-03
  -- tenant identity unchanged - a cross-organization claim binding cannot
  -- satisfy this FK regardless of claim_id's own validity.
  CONSTRAINT impact_evaluation_result_claim_links_a1_4_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_impact_evaluation_result_claim_links_a1_4_result
  ON kai.impact_evaluation_result_claim_links (impact_evaluation_result_id);

CREATE INDEX IF NOT EXISTS ix_impact_evaluation_result_claim_links_a1_4_claim
  ON kai.impact_evaluation_result_claim_links (organization_id, claim_id);

COMMIT;
