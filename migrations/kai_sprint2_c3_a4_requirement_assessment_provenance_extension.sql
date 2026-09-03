BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.requirement_assessments') IS NULL THEN
    RAISE EXCEPTION 'kai.requirement_assessments (C2.1) is required before the C3.A4 provenance-extension migration';
  END IF;
  IF to_regclass('kai.impact_outcome_contexts') IS NULL THEN
    RAISE EXCEPTION 'kai.impact_outcome_contexts (A1.1) is required before the C3.A4 provenance-extension migration';
  END IF;
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items (P2-01) is required before the C3.A4 provenance-extension migration';
  END IF;
  IF to_regclass('kai.source_versions') IS NULL THEN
    RAISE EXCEPTION 'kai.source_versions (P1-08) is required before the C3.A4 provenance-extension migration';
  END IF;
  IF to_regclass('kai.intake_promotion_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.intake_promotion_decisions (P1-08) is required before the C3.A4 provenance-extension migration';
  END IF;
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims (P2-03) is required before the C3.A4 provenance-extension migration';
  END IF;
  IF to_regclass('kai.conflict_groups') IS NULL THEN
    RAISE EXCEPTION 'kai.conflict_groups (P2-05) is required before the C3.A4 provenance-extension migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items (P1-06) is required before the C3.A4 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'requirement_assessments' AND c.conname = 'requirement_assessments_c2_1_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.requirement_assessments_c2_1_id_org_unique is required before the C3.A4 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'evidence_items' AND c.conname = 'evidence_items_p2_01_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.evidence_items_p2_01_id_org_unique is required before the C3.A4 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'source_versions' AND c.conname = 'source_versions_p1_08_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.source_versions_p1_08_id_org_unique is required before the C3.A4 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'intake_promotion_decisions' AND c.conname = 'intake_promotion_decisions_p1_08_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.intake_promotion_decisions_p1_08_identity_unique is required before the C3.A4 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'claims' AND c.conname = 'claims_p2_03_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.claims_p2_03_id_org_unique is required before the C3.A4 provenance-extension migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'conflict_groups' AND c.conname = 'conflict_groups_p2_05_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.conflict_groups_p2_05_id_org_unique is required before the C3.A4 provenance-extension migration';
  END IF;
END $$;

-- C3.A4 owner decision: three new, additive, tenant-safe junction tables
-- closing the provenance gap the C3.A2/C3.A3/C3.B2 classification pass
-- identified for ir_pur_001, ir_stk_001, ir_data_001, and ir_contrib_003.
-- This migration implements ONLY these provenance objects - it does not
-- alter kai.requirement_assessments, kai.impact_outcome_contexts,
-- kai.evidence_items, kai.source_versions, kai.intake_promotion_decisions,
-- kai.claims, kai.conflict_groups, or kai.review_queue_items, and it does
-- not implement the assessment rule/state logic for any of the four
-- requirements (deferred to a follow-on package).
--
-- (1) ra_outcome_context_links (ir_pur_001 + ir_stk_001, shared): both
-- requirements' governed input is the SAME kai.impact_outcome_contexts row
-- (ir_pur_001 reads outcome_statement, ir_stk_001 reads
-- stakeholder_key/stakeholder_label) - one link table, not two. Unlike
-- P2-12 decisions or P2-04 gaps, impact_outcome_contexts has no append-only
-- lineage: it is a single mutable row per (organization, engagement,
-- outcome_key) with its own updated_at, so an assessment that cited only
-- impact_outcome_context_id would silently change meaning if that row is
-- later edited. A verified snapshot of the exact governed columns at cite
-- time (mirroring C3.A3's gap-link snapshot pattern) is therefore required
-- for reproducibility, not merely to record identity.
--
-- (2) ra_source_promotion_links (ir_data_001): pins the exact evidence_item
-- to the exact source/source_version it was drawn from and to the exact
-- intake_promotion_decision that promoted that source_version, tenant-safe
-- throughout. kai.intake_promotion_decisions transitions in place
-- (decision_status/reviewed_source_type/source_id/source_version_id are all
-- mutated by transitionDecisionRowIfNeedsMoreInformation in
-- postgresSourcePromotionRepository.js) and kai.source_versions.is_current
-- flips when a newer version is promoted, so decision_status,
-- reviewed_source_type, and is_current are snapshotted and verified at
-- cite time; source_id/source_version_id/intake_promotion_decision_id are
-- cited as real, tenant-safe foreign keys, not copied content.
--
-- (3) ra_conflict_resolution_links (ir_contrib_003, conflict-group half
-- only): kai.gap_log_items' own conflicting_source_indicators dimension is
-- already fully provable via the existing kai.ra_gap_links table from
-- C3.A3 - no new object is added for that half. What is NOT yet provable is
-- the conflict PAIRING itself: kai.conflict_groups (which claim conflicts
-- with which). kai.conflict_groups is append-only (no UPDATE path exists
-- anywhere in this codebase) and its associated
-- queue_type = 'conflict_resolution' kai.review_queue_items row has its
-- queue_status/review_status permanently pinned to 'open'/'needs_gk_review'
-- by review_queue_items_p2_05_conflict_resolution_contract_check - neither
-- object carries mutable state, so no snapshot is needed here (unlike (1)
-- and (2) above); this is a bare identity link exactly like C2.1's own
-- requirement_assessment_claim_links, plus one structural BEFORE INSERT
-- check that the cited claim actually participates in the cited
-- conflict_group (its lower_claim_id or higher_claim_id). The
-- review_queue_item itself is not separately cited: it is already 1:1
-- derivable from conflict_group_id via
-- ux_review_queue_items_p2_05_conflict_resolution_identity, so citing it
-- here would be duplicate, non-load-bearing provenance.
CREATE TABLE kai.ra_outcome_context_links (
  ra_outcome_context_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  impact_outcome_context_id uuid NOT NULL,

  -- Verified snapshot of kai.impact_outcome_contexts' own governed content
  -- at cite time (see BEFORE INSERT trigger below) - required because that
  -- table, unlike a P2-12 decision or a P2-04 gap, is mutable in place.
  outcome_key text NOT NULL,
  outcome_statement text NOT NULL,
  stakeholder_key text NOT NULL,
  stakeholder_label text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ra_outcome_context_links_c3_a4_identity_unique
    UNIQUE (requirement_assessment_id, impact_outcome_context_id),
  CONSTRAINT ra_outcome_context_links_c3_a4_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_outcome_context_links_c3_a4_context_fk
    FOREIGN KEY (impact_outcome_context_id, organization_id)
    REFERENCES kai.impact_outcome_contexts (impact_outcome_context_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX ix_ra_outcome_context_links_c3_a4_assessment
  ON kai.ra_outcome_context_links (requirement_assessment_id);

CREATE INDEX ix_ra_outcome_context_links_c3_a4_context
  ON kai.ra_outcome_context_links (organization_id, impact_outcome_context_id);

CREATE OR REPLACE FUNCTION kai.c3_a4_verify_outcome_context_link_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_row kai.impact_outcome_contexts;
BEGIN
  SELECT * INTO source_row
    FROM kai.impact_outcome_contexts
   WHERE impact_outcome_context_id = NEW.impact_outcome_context_id
     AND organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C3.A4 outcome-context-link snapshot: no kai.impact_outcome_contexts row found for impact_outcome_context_id % in organization %', NEW.impact_outcome_context_id, NEW.organization_id;
  END IF;

  IF source_row.outcome_key IS DISTINCT FROM NEW.outcome_key
     OR source_row.outcome_statement IS DISTINCT FROM NEW.outcome_statement
     OR source_row.stakeholder_key IS DISTINCT FROM NEW.stakeholder_key
     OR source_row.stakeholder_label IS DISTINCT FROM NEW.stakeholder_label
  THEN
    RAISE EXCEPTION 'C3.A4 outcome-context-link snapshot does not match kai.impact_outcome_contexts row % at insert time', NEW.impact_outcome_context_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_c3_a4_outcome_context_links_verify_snapshot
  BEFORE INSERT ON kai.ra_outcome_context_links
  FOR EACH ROW EXECUTE FUNCTION kai.c3_a4_verify_outcome_context_link_snapshot();

CREATE OR REPLACE FUNCTION kai.c3_a4_reject_outcome_context_link_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'C3.A4 requirement-assessment-outcome-context-link snapshot is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_c3_a4_outcome_context_links_append_only
  BEFORE UPDATE OR DELETE ON kai.ra_outcome_context_links
  FOR EACH ROW EXECUTE FUNCTION kai.c3_a4_reject_outcome_context_link_mutation();

CREATE TABLE kai.ra_source_promotion_links (
  ra_source_promotion_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  intake_source_candidate_id uuid NOT NULL,
  intake_promotion_decision_id uuid NOT NULL,

  -- Verified snapshot of mutable state on kai.source_versions and
  -- kai.intake_promotion_decisions at cite time (see BEFORE INSERT trigger
  -- below).
  is_current boolean NOT NULL,
  decision_status text NOT NULL,
  reviewed_source_type text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ra_source_promotion_links_c3_a4_identity_unique
    UNIQUE (requirement_assessment_id, evidence_item_id),
  CONSTRAINT ra_source_promotion_links_c3_a4_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_source_promotion_links_c3_a4_evidence_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_source_promotion_links_c3_a4_source_version_fk
    FOREIGN KEY (source_version_id, organization_id)
    REFERENCES kai.source_versions (source_version_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_source_promotion_links_c3_a4_decision_fk
    FOREIGN KEY (intake_source_candidate_id, organization_id)
    REFERENCES kai.intake_promotion_decisions (intake_source_candidate_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_source_promotion_links_c3_a4_decision_status_check
    CHECK (decision_status IN ('needs_more_information', 'rejected', 'promoted')),
  CONSTRAINT ra_source_promotion_links_c3_a4_reviewed_source_type_check
    CHECK (reviewed_source_type IN (
      'organization_primary_record', 'organization_secondary_record',
      'third_party_provided_record', 'public_record'
    ))
);

CREATE INDEX ix_ra_source_promotion_links_c3_a4_assessment
  ON kai.ra_source_promotion_links (requirement_assessment_id);

CREATE INDEX ix_ra_source_promotion_links_c3_a4_evidence
  ON kai.ra_source_promotion_links (organization_id, evidence_item_id);

CREATE OR REPLACE FUNCTION kai.c3_a4_verify_source_promotion_link_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_row kai.evidence_items;
  version_row kai.source_versions;
  decision_row kai.intake_promotion_decisions;
BEGIN
  SELECT * INTO evidence_row
    FROM kai.evidence_items
   WHERE evidence_item_id = NEW.evidence_item_id
     AND organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C3.A4 source-promotion-link snapshot: no kai.evidence_items row found for evidence_item_id % in organization %', NEW.evidence_item_id, NEW.organization_id;
  END IF;

  IF evidence_row.source_id IS DISTINCT FROM NEW.source_id
     OR evidence_row.source_version_id IS DISTINCT FROM NEW.source_version_id
  THEN
    RAISE EXCEPTION 'C3.A4 source-promotion-link snapshot: evidence_item_id % was not sourced from source_id %/source_version_id %', NEW.evidence_item_id, NEW.source_id, NEW.source_version_id;
  END IF;

  SELECT * INTO version_row
    FROM kai.source_versions
   WHERE source_version_id = NEW.source_version_id
     AND organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C3.A4 source-promotion-link snapshot: no kai.source_versions row found for source_version_id % in organization %', NEW.source_version_id, NEW.organization_id;
  END IF;

  IF version_row.source_id IS DISTINCT FROM NEW.source_id
     OR version_row.intake_source_candidate_id IS DISTINCT FROM NEW.intake_source_candidate_id
     OR version_row.is_current IS DISTINCT FROM NEW.is_current
  THEN
    RAISE EXCEPTION 'C3.A4 source-promotion-link snapshot does not match kai.source_versions row % at insert time', NEW.source_version_id;
  END IF;

  SELECT * INTO decision_row
    FROM kai.intake_promotion_decisions
   WHERE organization_id = NEW.organization_id
     AND intake_source_candidate_id = NEW.intake_source_candidate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C3.A4 source-promotion-link snapshot: no kai.intake_promotion_decisions row found for intake_source_candidate_id % in organization %', NEW.intake_source_candidate_id, NEW.organization_id;
  END IF;

  IF decision_row.intake_promotion_decision_id IS DISTINCT FROM NEW.intake_promotion_decision_id
     OR decision_row.source_id IS DISTINCT FROM NEW.source_id
     OR decision_row.source_version_id IS DISTINCT FROM NEW.source_version_id
     OR decision_row.decision_status IS DISTINCT FROM NEW.decision_status
     OR decision_row.reviewed_source_type IS DISTINCT FROM NEW.reviewed_source_type
  THEN
    RAISE EXCEPTION 'C3.A4 source-promotion-link snapshot does not match kai.intake_promotion_decisions row % at insert time', NEW.intake_promotion_decision_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_c3_a4_source_promotion_links_verify_snapshot
  BEFORE INSERT ON kai.ra_source_promotion_links
  FOR EACH ROW EXECUTE FUNCTION kai.c3_a4_verify_source_promotion_link_snapshot();

CREATE OR REPLACE FUNCTION kai.c3_a4_reject_source_promotion_link_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'C3.A4 requirement-assessment-source-promotion-link snapshot is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_c3_a4_source_promotion_links_append_only
  BEFORE UPDATE OR DELETE ON kai.ra_source_promotion_links
  FOR EACH ROW EXECUTE FUNCTION kai.c3_a4_reject_source_promotion_link_mutation();

CREATE TABLE kai.ra_conflict_resolution_links (
  ra_conflict_resolution_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requirement_assessment_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  conflict_group_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ra_conflict_resolution_links_c3_a4_identity_unique
    UNIQUE (requirement_assessment_id, conflict_group_id, claim_id),
  CONSTRAINT ra_conflict_resolution_links_c3_a4_assessment_fk
    FOREIGN KEY (requirement_assessment_id, organization_id)
    REFERENCES kai.requirement_assessments (requirement_assessment_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_conflict_resolution_links_c3_a4_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT ra_conflict_resolution_links_c3_a4_conflict_fk
    FOREIGN KEY (conflict_group_id, organization_id)
    REFERENCES kai.conflict_groups (conflict_group_id, organization_id)
    ON DELETE RESTRICT
);

CREATE INDEX ix_ra_conflict_resolution_links_c3_a4_assessment
  ON kai.ra_conflict_resolution_links (requirement_assessment_id);

CREATE INDEX ix_ra_conflict_resolution_links_c3_a4_conflict
  ON kai.ra_conflict_resolution_links (organization_id, conflict_group_id);

-- No snapshot/append-only machinery is needed here (unlike (1) and (2)
-- above): kai.conflict_groups is append-only with no UPDATE path anywhere
-- in this codebase, so there is no mutable state to protect. This single
-- BEFORE INSERT trigger only enforces the structural fact that the cited
-- claim_id is actually one of the two claims in the cited conflict_group -
-- the same kind of tenant/subject pin the C2.1 evidence/claim link tables
-- get for free from a composite FK, but not expressible as a plain FK here
-- because conflict_groups stores two claim ids on one row.
CREATE OR REPLACE FUNCTION kai.c3_a4_verify_conflict_resolution_link_participation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  conflict_row kai.conflict_groups;
BEGIN
  SELECT * INTO conflict_row
    FROM kai.conflict_groups
   WHERE conflict_group_id = NEW.conflict_group_id
     AND organization_id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'C3.A4 conflict-resolution-link: no kai.conflict_groups row found for conflict_group_id % in organization %', NEW.conflict_group_id, NEW.organization_id;
  END IF;

  IF NEW.claim_id IS DISTINCT FROM conflict_row.lower_claim_id
     AND NEW.claim_id IS DISTINCT FROM conflict_row.higher_claim_id
  THEN
    RAISE EXCEPTION 'C3.A4 conflict-resolution-link: claim_id % does not participate in conflict_group %', NEW.claim_id, NEW.conflict_group_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_c3_a4_conflict_resolution_links_verify_participation
  BEFORE INSERT ON kai.ra_conflict_resolution_links
  FOR EACH ROW EXECUTE FUNCTION kai.c3_a4_verify_conflict_resolution_link_participation();

COMMIT;
