BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.requirement_assessments') IS NULL THEN
    RAISE EXCEPTION 'kai.requirement_assessments (C2.1) is required before the C3.A3 provenance-extension migration';
  END IF;
  IF to_regclass('kai.evidence_review_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_review_decisions (P2-12) is required before the C3.A3 provenance-extension migration';
  END IF;
  IF to_regclass('kai.claim_review_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.claim_review_decisions (P2-12) is required before the C3.A3 provenance-extension migration';
  END IF;
  IF to_regclass('kai.gap_log_items') IS NULL THEN
    RAISE EXCEPTION 'kai.gap_log_items (P2-04) is required before the C3.A3 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'requirement_assessments' AND c.conname = 'requirement_assessments_c2_1_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.requirement_assessments_c2_1_id_org_unique is required before the C3.A3 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'evidence_review_decisions' AND c.conname = 'evidence_review_decisions_p2_12_id_org_item_unique'
  ) THEN
    RAISE EXCEPTION 'kai.evidence_review_decisions_p2_12_id_org_item_unique is required before the C3.A3 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'claim_review_decisions' AND c.conname = 'claim_review_decisions_p2_12_id_org_claim_unique'
  ) THEN
    RAISE EXCEPTION 'kai.claim_review_decisions_p2_12_id_org_claim_unique is required before the C3.A3 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'gap_log_items' AND c.conname = 'gap_log_items_p2_04_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.gap_log_items_p2_04_id_org_unique is required before the C3.A3 provenance-extension migration';
  END IF;
END $$;

-- C3.A3 owner decision (Provenance Foundation only - the C3A3 FINAL
-- IMPLEMENTATION CONTRACT): three new, additive, tenant-safe junction
-- tables (named with the "ra_" abbreviation of requirement_assessment so
-- every constraint/index name below stays within PostgreSQL's 63-byte
-- identifier limit). This migration implements only the provenance
-- objects that contract marked required. It does not alter
-- kai.requirement_assessments, kai.evidence_review_decisions,
-- kai.claim_review_decisions, or kai.gap_log_items, and it does not change
-- any P2 or C3 assessment behavior - the corrected assessment rule is
-- explicitly deferred.
--
-- Review-decision provenance (evidence + claim): each link cites the exact
-- append-only decision_id identity established by P2-12, pinned to the same
-- tenant and to the same evidence_item_id/claim_id the decision itself was
-- decided against. No decision content (outcome, limitation_notes,
-- approved_audiences) is copied - the ledger row already is that content
-- and is itself immutable, so citing decision_id (plus its tenant/subject
-- pin) is sufficient historical proof on its own. This mirrors the bare
-- link shape of C2.1's own evidence/claim link tables.
--
-- Gap provenance: gap_log_items carries no fingerprint/hash/current-state
-- column (C3A3.2/C3A3.3 findings) and its rows are already immutable (no
-- UPDATE path exists anywhere in this schema; the only write is
-- INSERT ... ON CONFLICT (organization_id, claim_id, dimension_key) DO
-- NOTHING). gap_log_item_id alone is a synthetic id with no material
-- content, so the link additionally pins the referenced row's own existing
-- immutable natural-key-plus-content columns
-- (claim_id, evidence_item_id, source_version_id, dimension_key,
-- assessment_status) at cite time via a verified snapshot, so the
-- assessment's provenance is reproducible even after source_versions or
-- live P2-02 recomputation later diverge from this claim's present state.
-- A BEFORE INSERT trigger rejects any snapshot that does not exactly match
-- the referenced gap_log_items row at insert time; a BEFORE UPDATE/DELETE
-- trigger then keeps that verified snapshot immutable forever, exactly like
-- every other historical ledger in this schema.
CREATE TABLE kai.ra_evidence_review_decision_links (
  ra_evidence_review_decision_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  decision_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ra_evidence_review_decision_links_c3_a3_identity_unique
    UNIQUE (requirement_assessment_id, decision_id),
  CONSTRAINT ra_evidence_review_decision_links_c3_a3_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  -- Tenant-safe AND subject-safe: the cited decision must belong to the
  -- same organization and must have been decided against this exact
  -- evidence_item_id.
  CONSTRAINT ra_evidence_review_decision_links_c3_a3_decision_fk
    FOREIGN KEY (decision_id, organization_id, evidence_item_id)
    REFERENCES kai.evidence_review_decisions (decision_id, organization_id, evidence_item_id)
    ON DELETE RESTRICT
);

CREATE INDEX ix_ra_evidence_review_decision_links_c3_a3_assessment
  ON kai.ra_evidence_review_decision_links (requirement_assessment_id);

CREATE INDEX ix_ra_evidence_review_decision_links_c3_a3_decision
  ON kai.ra_evidence_review_decision_links (organization_id, decision_id);

CREATE TABLE kai.ra_claim_review_decision_links (
  ra_claim_review_decision_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  decision_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ra_claim_review_decision_links_c3_a3_identity_unique
    UNIQUE (requirement_assessment_id, decision_id),
  CONSTRAINT ra_claim_review_decision_links_c3_a3_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_claim_review_decision_links_c3_a3_decision_fk
    FOREIGN KEY (decision_id, organization_id, claim_id)
    REFERENCES kai.claim_review_decisions (decision_id, organization_id, claim_id)
    ON DELETE RESTRICT
);

CREATE INDEX ix_ra_claim_review_decision_links_c3_a3_assessment
  ON kai.ra_claim_review_decision_links (requirement_assessment_id);

CREATE INDEX ix_ra_claim_review_decision_links_c3_a3_decision
  ON kai.ra_claim_review_decision_links (organization_id, decision_id);

CREATE TABLE kai.ra_gap_links (
  ra_gap_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  gap_log_item_id uuid NOT NULL,

  -- Verified snapshot of kai.gap_log_items' own immutable content at cite
  -- time (see BEFORE INSERT trigger below) - not new state, a pinned copy
  -- of state that already cannot change on the source row.
  claim_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  dimension_key text NOT NULL,
  assessment_status text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ra_gap_links_c3_a3_identity_unique
    UNIQUE (requirement_assessment_id, gap_log_item_id),
  CONSTRAINT ra_gap_links_c3_a3_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_gap_links_c3_a3_gap_fk
    FOREIGN KEY (gap_log_item_id, organization_id)
    REFERENCES kai.gap_log_items (gap_log_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_gap_links_c3_a3_dimension_key_check
    CHECK (dimension_key IN (
      'missingness', 'duplicates', 'definition_clarity', 'denominator_clarity',
      'time_period_clarity', 'entity_level_clarity', 'small_cell_risk',
      'conflicting_source_indicators', 'requirement_alignment', 'coverage_gaps'
    )),
  CONSTRAINT ra_gap_links_c3_a3_assessment_status_check
    CHECK (assessment_status IN ('resolved_risk_flagged', 'unresolved'))
);

CREATE INDEX ix_ra_gap_links_c3_a3_assessment
  ON kai.ra_gap_links (requirement_assessment_id);

CREATE INDEX ix_ra_gap_links_c3_a3_gap
  ON kai.ra_gap_links (organization_id, gap_log_item_id);

CREATE OR REPLACE FUNCTION kai.c3_a3_verify_gap_link_snapshot_matches_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_row kai.gap_log_items;
BEGIN
  SELECT * INTO source_row
    FROM kai.gap_log_items
   WHERE gap_log_item_id = NEW.gap_log_item_id
     AND organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C3.A3 gap-link snapshot: no kai.gap_log_items row found for gap_log_item_id % in organization %', NEW.gap_log_item_id, NEW.organization_id;
  END IF;

  IF source_row.claim_id IS DISTINCT FROM NEW.claim_id
     OR source_row.evidence_item_id IS DISTINCT FROM NEW.evidence_item_id
     OR source_row.source_version_id IS DISTINCT FROM NEW.source_version_id
     OR source_row.dimension_key IS DISTINCT FROM NEW.dimension_key
     OR source_row.assessment_status IS DISTINCT FROM NEW.assessment_status
  THEN
    RAISE EXCEPTION 'C3.A3 gap-link snapshot does not match kai.gap_log_items row % at insert time', NEW.gap_log_item_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_c3_a3_gap_links_verify_snapshot
  BEFORE INSERT ON kai.ra_gap_links
  FOR EACH ROW EXECUTE FUNCTION kai.c3_a3_verify_gap_link_snapshot_matches_source();

CREATE OR REPLACE FUNCTION kai.c3_a3_reject_gap_link_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'C3.A3 requirement-assessment-gap-link snapshot is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_c3_a3_gap_links_append_only
  BEFORE UPDATE OR DELETE ON kai.ra_gap_links
  FOR EACH ROW EXECUTE FUNCTION kai.c3_a3_reject_gap_link_mutation();

COMMIT;
