BEGIN;

ALTER TABLE kai.intake_sensitivity_review_decisions
  DROP CONSTRAINT IF EXISTS intake_sensitivity_review_decisions_b1a_02_role_check,
  ADD CONSTRAINT intake_sensitivity_review_decisions_b1a_02_role_check
    CHECK (decided_by_role IN ('gk_admin', 'gk_operator', 'gk_reviewer', 'client_admin'));

COMMIT;
