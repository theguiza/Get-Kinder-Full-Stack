BEGIN;

-- Rolls back the organization internal release authority. Refuses while any
-- client_admin limitation snapshot or final-release decision exists: those
-- rows are an organization's own recorded decisions, append-only, and would
-- violate the restored GK-only constraints. They are never deleted or
-- rewritten to permit a rollback. The P3-16 / P3-17 constraints are restored
-- exactly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.limitation_snapshots WHERE confirmed_by_role = 'client_admin')
     OR EXISTS (SELECT 1 FROM kai.human_authority_decisions WHERE decided_by_role = 'client_admin') THEN
    RAISE EXCEPTION 'organization internal release authority rollback refused: client_admin release decisions exist';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_organization_release_decision_scope ON kai.human_authority_decisions;
DROP FUNCTION IF EXISTS kai.organization_release_enforce_decision_scope();
DROP TRIGGER IF EXISTS trg_organization_release_limitation_snapshot_scope ON kai.limitation_snapshots;
DROP FUNCTION IF EXISTS kai.organization_release_enforce_snapshot_scope();

ALTER TABLE kai.human_authority_decisions
  DROP CONSTRAINT IF EXISTS human_authority_decisions_p3_17_role_by_type_check,
  ADD CONSTRAINT human_authority_decisions_p3_17_role_by_type_check
    CHECK (
      (decision_type = 'client_reviewed' AND decided_by_role = 'client_reviewer')
      OR (decision_type <> 'client_reviewed' AND decided_by_role = 'gk_admin')
    );

ALTER TABLE kai.limitation_snapshots
  DROP CONSTRAINT IF EXISTS limitation_snapshots_p3_16_confirmed_by_role_check,
  ADD CONSTRAINT limitation_snapshots_p3_16_confirmed_by_role_check
    CHECK (confirmed_by_role IN ('gk_reviewer', 'gk_admin'));

COMMIT;
