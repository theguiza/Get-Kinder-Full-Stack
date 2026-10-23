BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'limitation_snapshots_p3_16_confirmed_by_role_check'
  ) THEN
    RAISE EXCEPTION 'limitation_snapshots_p3_16_confirmed_by_role_check is required before the organization internal release authority migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'human_authority_decisions_p3_17_role_by_type_check'
  ) THEN
    RAISE EXCEPTION 'human_authority_decisions_p3_17_role_by_type_check is required before the organization internal release authority migration';
  END IF;
END $$;

-- Owner amendment 2026-10-23 (Operating Model v0.2 section 11): an active
-- client_admin may confirm the limitation snapshot of, and grant final
-- release authority for, an ordinary internal evidence_summary of their own
-- organization. This widens exactly two role constraints by one role each,
-- keeping their names, and adds two insert triggers that pin a client_admin
-- row to an internal-audience evidence_summary (the rows carry no audience or
-- content type of their own; the trigger reads the bound draft or candidate,
-- as P3-17 already does for audience compatibility). A client_admin decision
-- is a grant only: the organization path records no revocation. Every GK combination,
-- row, and identity is unchanged. funder_ready / public_ready stay gk_admin
-- only; client_reviewed stays client_reviewer only. Whether a given draft is
-- ordinary (no section 7.2 category present or unknown, permitted use, AI
-- processing, current eligibility) is decided in the service transaction,
-- which the database cannot see.

ALTER TABLE kai.limitation_snapshots
  DROP CONSTRAINT IF EXISTS limitation_snapshots_p3_16_confirmed_by_role_check,
  ADD CONSTRAINT limitation_snapshots_p3_16_confirmed_by_role_check
    CHECK (confirmed_by_role IN ('gk_reviewer', 'gk_admin', 'client_admin'));

ALTER TABLE kai.human_authority_decisions
  DROP CONSTRAINT IF EXISTS human_authority_decisions_p3_17_role_by_type_check,
  ADD CONSTRAINT human_authority_decisions_p3_17_role_by_type_check
    CHECK (
      (decision_type = 'client_reviewed' AND decided_by_role = 'client_reviewer')
      OR (decision_type <> 'client_reviewed' AND decided_by_role = 'gk_admin')
      OR (decision_type = 'export_authority_granted' AND decided_by_role = 'client_admin' AND decision_action = 'grant')
    );

CREATE OR REPLACE FUNCTION kai.organization_release_enforce_snapshot_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  draft_content_type text;
  draft_audience text;
BEGIN
  IF NEW.confirmed_by_role <> 'client_admin' THEN
    RETURN NEW;
  END IF;
  SELECT content_type, requested_audience INTO draft_content_type, draft_audience
    FROM kai.generated_content_drafts
   WHERE generated_content_draft_id = NEW.generated_content_draft_id
     AND organization_id = NEW.organization_id;
  IF draft_content_type IS DISTINCT FROM 'evidence_summary' OR draft_audience IS DISTINCT FROM 'internal' THEN
    RAISE EXCEPTION 'organization internal release: a client_admin limitation snapshot may only bind an internal evidence_summary draft'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_release_limitation_snapshot_scope ON kai.limitation_snapshots;
CREATE TRIGGER trg_organization_release_limitation_snapshot_scope
  BEFORE INSERT ON kai.limitation_snapshots
  FOR EACH ROW EXECUTE FUNCTION kai.organization_release_enforce_snapshot_scope();

CREATE OR REPLACE FUNCTION kai.organization_release_enforce_decision_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_content_type text;
  candidate_audience text;
BEGIN
  IF NEW.decided_by_role <> 'client_admin' THEN
    RETURN NEW;
  END IF;
  SELECT content_type, requested_audience INTO candidate_content_type, candidate_audience
    FROM kai.export_candidates
   WHERE export_candidate_id = NEW.export_candidate_id
     AND organization_id = NEW.organization_id;
  IF candidate_content_type IS DISTINCT FROM 'evidence_summary' OR candidate_audience IS DISTINCT FROM 'internal' THEN
    RAISE EXCEPTION 'organization internal release: a client_admin final-release decision may only bind an internal evidence_summary candidate'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_release_decision_scope ON kai.human_authority_decisions;
CREATE TRIGGER trg_organization_release_decision_scope
  BEFORE INSERT ON kai.human_authority_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.organization_release_enforce_decision_scope();

COMMIT;
