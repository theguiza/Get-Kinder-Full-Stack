BEGIN;

-- Rolls back the organization internal factual review authority. Refuses
-- while any client_admin evidence, claim, or coverage decision exists: those
-- rows are an organization's own recorded decisions, append-only, and would
-- violate the restored GK-only constraints. They are never deleted or
-- rewritten to permit a rollback. The P2-12 / P2-10 constraints are restored
-- exactly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.evidence_review_decisions WHERE decided_by_role = 'client_admin')
     OR EXISTS (SELECT 1 FROM kai.claim_review_decisions WHERE decided_by_role = 'client_admin')
     OR EXISTS (SELECT 1 FROM kai.coverage_review_decisions WHERE decided_by_role = 'client_admin') THEN
    RAISE EXCEPTION 'organization internal factual review authority rollback refused: client_admin review decisions exist';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_organization_factual_review_coverage_scope ON kai.coverage_review_decisions;
DROP FUNCTION IF EXISTS kai.organization_factual_review_enforce_coverage_scope();
DROP TRIGGER IF EXISTS trg_organization_factual_review_claim_scope ON kai.claim_review_decisions;
DROP FUNCTION IF EXISTS kai.organization_factual_review_enforce_claim_scope();
DROP TRIGGER IF EXISTS trg_organization_factual_review_evidence_scope ON kai.evidence_review_decisions;
DROP FUNCTION IF EXISTS kai.organization_factual_review_enforce_evidence_scope();
DROP FUNCTION IF EXISTS kai.organization_factual_review_is_measurement_evidence(uuid, uuid);

ALTER TABLE kai.coverage_review_decisions
  DROP CONSTRAINT IF EXISTS coverage_review_decisions_p2_10_decided_by_role_check,
  ADD CONSTRAINT coverage_review_decisions_p2_10_decided_by_role_check
    CHECK (decided_by_role = 'gk_reviewer');

ALTER TABLE kai.claim_review_decisions
  DROP CONSTRAINT IF EXISTS claim_review_decisions_organization_internal_audience_check;

ALTER TABLE kai.claim_review_decisions
  DROP CONSTRAINT IF EXISTS claim_review_decisions_p2_12_role_check,
  ADD CONSTRAINT claim_review_decisions_p2_12_role_check
    CHECK (decided_by_role IN ('gk_reviewer', 'gk_admin'));

ALTER TABLE kai.evidence_review_decisions
  DROP CONSTRAINT IF EXISTS evidence_review_decisions_p2_12_role_check,
  ADD CONSTRAINT evidence_review_decisions_p2_12_role_check
    CHECK (decided_by_role IN ('gk_reviewer', 'gk_admin'));

COMMIT;
