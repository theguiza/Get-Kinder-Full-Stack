BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evidence_review_decisions_p2_12_role_check'
  ) THEN
    RAISE EXCEPTION 'evidence_review_decisions_p2_12_role_check is required before the organization internal factual review authority migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_review_decisions_p2_12_role_check'
  ) THEN
    RAISE EXCEPTION 'claim_review_decisions_p2_12_role_check is required before the organization internal factual review authority migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coverage_review_decisions_p2_10_decided_by_role_check'
  ) THEN
    RAISE EXCEPTION 'coverage_review_decisions_p2_10_decided_by_role_check is required before the organization internal factual review authority migration';
  END IF;
  IF to_regclass('kai.evidence_measurements') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_measurements is required before the organization internal factual review authority migration';
  END IF;
END $$;

-- Owner authorization 2026-10-24 (Operating Model v0.2 section 11 exception;
-- Governance Simplification and Remediation Strategy sections 2.2-2.5): an
-- active client_admin may record the evidence factual review, the internal
-- claim review, and the internal coverage-limitation acceptance for their
-- own organization's ordinary source-record-count measurement. This widens
-- the three decision-role constraints by client_admin, keeping their names,
-- and pins a client_admin row to that scope:
--   - claim review: approved_audiences may only be internal (a CHECK);
--   - coverage: only accepted_internal_with_limitation, and only for the
--     three source-level dimensions a human sensitivity review can support
--     (a CHECK);
--   - all three: the reviewed evidence must be P2-01M measurement evidence,
--     and a client_admin evidence or claim decision may never supersede a
--     Get Kinder decision (insert triggers; the rows carry no evidence type
--     of their own, as migration 04's triggers read the bound draft).
-- Every GK role, row, and combination is unchanged; GK may still supersede a
-- client_admin decision. Whether the measurement is ordinary (current
-- source version, permitted use and AI processing, every section 7.2
-- category 'absent') is decided in the service transaction, and P2-06
-- refuses a client_admin evidence decision as funder or public authority.

ALTER TABLE kai.evidence_review_decisions
  DROP CONSTRAINT IF EXISTS evidence_review_decisions_p2_12_role_check,
  ADD CONSTRAINT evidence_review_decisions_p2_12_role_check
    CHECK (decided_by_role IN ('gk_reviewer', 'gk_admin', 'client_admin'));

ALTER TABLE kai.claim_review_decisions
  DROP CONSTRAINT IF EXISTS claim_review_decisions_p2_12_role_check,
  ADD CONSTRAINT claim_review_decisions_p2_12_role_check
    CHECK (decided_by_role IN ('gk_reviewer', 'gk_admin', 'client_admin'));

ALTER TABLE kai.claim_review_decisions
  DROP CONSTRAINT IF EXISTS claim_review_decisions_organization_internal_audience_check,
  ADD CONSTRAINT claim_review_decisions_organization_internal_audience_check
    CHECK (
      decided_by_role <> 'client_admin'
      OR approved_audiences IS NULL
      OR approved_audiences = ARRAY['internal']::text[]
    );

ALTER TABLE kai.coverage_review_decisions
  DROP CONSTRAINT IF EXISTS coverage_review_decisions_p2_10_decided_by_role_check,
  ADD CONSTRAINT coverage_review_decisions_p2_10_decided_by_role_check
    CHECK (
      decided_by_role = 'gk_reviewer'
      OR (
        decided_by_role = 'client_admin'
        AND decision = 'accepted_internal_with_limitation'
        AND dimension_key IN ('small_cell_risk', 'conflicting_source_indicators', 'requirement_alignment')
      )
    );

CREATE OR REPLACE FUNCTION kai.organization_factual_review_is_measurement_evidence(target_organization_id uuid, target_evidence_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM kai.evidence_items e
      JOIN kai.evidence_measurements m
        ON m.evidence_item_id = e.evidence_item_id
       AND m.organization_id = e.organization_id
     WHERE e.organization_id = target_organization_id
       AND e.evidence_item_id = target_evidence_item_id
       AND e.evidence_type = 'source_record_count_measurement'
  )
$$;

CREATE OR REPLACE FUNCTION kai.organization_factual_review_enforce_evidence_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.decided_by_role <> 'client_admin' THEN
    RETURN NEW;
  END IF;
  IF NOT kai.organization_factual_review_is_measurement_evidence(NEW.organization_id, NEW.evidence_item_id) THEN
    RAISE EXCEPTION 'organization factual review: a client_admin evidence decision may only bind source-record-count measurement evidence'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.supersedes_decision_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM kai.evidence_review_decisions
     WHERE decision_id = NEW.supersedes_decision_id
       AND decided_by_role <> 'client_admin'
  ) THEN
    RAISE EXCEPTION 'organization factual review: a client_admin evidence decision may not supersede a Get Kinder decision'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_factual_review_evidence_scope ON kai.evidence_review_decisions;
CREATE TRIGGER trg_organization_factual_review_evidence_scope
  BEFORE INSERT ON kai.evidence_review_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.organization_factual_review_enforce_evidence_scope();

CREATE OR REPLACE FUNCTION kai.organization_factual_review_enforce_claim_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  claim_evidence_item_id uuid;
BEGIN
  IF NEW.decided_by_role <> 'client_admin' THEN
    RETURN NEW;
  END IF;
  SELECT evidence_item_id INTO claim_evidence_item_id
    FROM kai.claims
   WHERE claim_id = NEW.claim_id
     AND organization_id = NEW.organization_id;
  IF claim_evidence_item_id IS NULL
     OR NOT kai.organization_factual_review_is_measurement_evidence(NEW.organization_id, claim_evidence_item_id) THEN
    RAISE EXCEPTION 'organization factual review: a client_admin claim decision may only bind a claim on source-record-count measurement evidence'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.supersedes_decision_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM kai.claim_review_decisions
     WHERE decision_id = NEW.supersedes_decision_id
       AND decided_by_role <> 'client_admin'
  ) THEN
    RAISE EXCEPTION 'organization factual review: a client_admin claim decision may not supersede a Get Kinder decision'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_factual_review_claim_scope ON kai.claim_review_decisions;
CREATE TRIGGER trg_organization_factual_review_claim_scope
  BEFORE INSERT ON kai.claim_review_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.organization_factual_review_enforce_claim_scope();

CREATE OR REPLACE FUNCTION kai.organization_factual_review_enforce_coverage_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  claim_evidence_item_id uuid;
BEGIN
  IF NEW.decided_by_role <> 'client_admin' THEN
    RETURN NEW;
  END IF;
  SELECT evidence_item_id INTO claim_evidence_item_id
    FROM kai.claims
   WHERE claim_id = NEW.claim_id
     AND organization_id = NEW.organization_id;
  IF claim_evidence_item_id IS NULL
     OR NOT kai.organization_factual_review_is_measurement_evidence(NEW.organization_id, claim_evidence_item_id) THEN
    RAISE EXCEPTION 'organization factual review: a client_admin coverage acceptance may only bind a claim on source-record-count measurement evidence'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_factual_review_coverage_scope ON kai.coverage_review_decisions;
CREATE TRIGGER trg_organization_factual_review_coverage_scope
  BEFORE INSERT ON kai.coverage_review_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.organization_factual_review_enforce_coverage_scope();

COMMIT;
