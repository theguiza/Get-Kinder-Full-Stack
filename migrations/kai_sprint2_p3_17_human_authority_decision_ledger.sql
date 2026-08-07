BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.export_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.export_candidates is required before P3-17 human-authority-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'export_candidates_p3_16_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.export_candidates_p3_16_id_org_unique is required before P3-17 human-authority-decision-ledger migration';
  END IF;
END $$;

-- P3-17 scope: this migration adds exactly one new authoritative, additive,
-- append-only foundation - a human authority decision ledger for the four
-- decision types client_reviewed / funder_ready / public_ready /
-- export_authority_granted - bound to an existing P3-16 export candidate. It
-- changes no existing table, column, constraint, or lifecycle established by
-- Gate A through P3-16, creates no finalGate/VAL-EXP-001/exportEligible/
-- manifest/export-artifact state, and adds no runtime grant/revoke write
-- path, route, or UI. Lineage follows the P3-16 corrected pattern: a
-- backward pointer (supersedes_decision_id) written once, at INSERT time, on
-- the new row - never a forward pointer or an UPDATE of an existing row.

CREATE TABLE kai.human_authority_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  export_candidate_id uuid NOT NULL,
  decision_type text NOT NULL,
  decision_action text NOT NULL,
  decided_by uuid NOT NULL,
  decided_by_role text NOT NULL,
  supersedes_decision_id uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT human_authority_decisions_p3_17_id_org_unique
    UNIQUE (decision_id, organization_id),
  -- Self-referencing lineage FK target: pins (decision_id, organization_id,
  -- export_candidate_id, decision_type) together so a predecessor reference
  -- can never cross organization, candidate, or decision-type lineage.
  CONSTRAINT human_authority_decisions_p3_17_id_org_candidate_type_unique
    UNIQUE (decision_id, organization_id, export_candidate_id, decision_type),
  CONSTRAINT human_authority_decisions_p3_17_candidate_fk
    FOREIGN KEY (export_candidate_id, organization_id)
    REFERENCES kai.export_candidates (export_candidate_id, organization_id)
    ON DELETE RESTRICT,
  -- The predecessor referenced by supersedes_decision_id must already exist
  -- (ordinary, non-deferred FK) and must belong to the same organization,
  -- export candidate, and decision type as the new row - lineage can never
  -- fork across candidates or decision types.
  CONSTRAINT human_authority_decisions_p3_17_supersedes_fk
    FOREIGN KEY (supersedes_decision_id, organization_id, export_candidate_id, decision_type)
    REFERENCES kai.human_authority_decisions (decision_id, organization_id, export_candidate_id, decision_type)
    ON DELETE RESTRICT,
  CONSTRAINT human_authority_decisions_p3_17_not_self_superseding
    CHECK (supersedes_decision_id IS DISTINCT FROM decision_id),
  CONSTRAINT human_authority_decisions_p3_17_decision_type_check
    CHECK (decision_type IN ('client_reviewed', 'funder_ready', 'public_ready', 'export_authority_granted')),
  CONSTRAINT human_authority_decisions_p3_17_decision_action_check
    CHECK (decision_action IN ('grant', 'revoke')),
  -- Human ownership: client_reviewed is decided by client_reviewer; every
  -- other decision type is decided by gk_admin only.
  CONSTRAINT human_authority_decisions_p3_17_role_by_type_check
    CHECK (
      (decision_type = 'client_reviewed' AND decided_by_role = 'client_reviewer')
      OR (decision_type <> 'client_reviewed' AND decided_by_role = 'gk_admin')
    ),
  -- The first event in a lineage must be a grant: a root row (no
  -- predecessor) can never be a revoke.
  CONSTRAINT human_authority_decisions_p3_17_root_is_grant_check
    CHECK (supersedes_decision_id IS NOT NULL OR decision_action = 'grant'),
  CONSTRAINT human_authority_decisions_p3_17_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- At most one root (first) decision per (organization, export candidate,
-- decision type) lineage: a lineage is a single chain, never a forest.
CREATE UNIQUE INDEX ux_human_authority_decisions_p3_17_root_per_lineage
  ON kai.human_authority_decisions (organization_id, export_candidate_id, decision_type)
  WHERE supersedes_decision_id IS NULL;

-- At most one direct successor per predecessor: two concurrent decisions
-- racing from the same current head can each attempt their own INSERT, but
-- only one can ever commit - the loser receives a unique_violation and zero
-- rows are written or rewritten for it.
CREATE UNIQUE INDEX ux_human_authority_decisions_p3_17_single_successor
  ON kai.human_authority_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION kai.p3_17_reject_authority_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P3-17 human-authority-decision-ledger history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_p3_17_human_authority_decisions_append_only
  BEFORE UPDATE OR DELETE ON kai.human_authority_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.p3_17_reject_authority_mutation();

-- Audience compatibility: funder_ready may only bind a funder-audience
-- export candidate; public_ready may only bind a public-audience export
-- candidate. client_reviewed and export_authority_granted remain bound to
-- the candidate's actual audience without restriction (whatever it is).
-- Enforced by trigger (not a duplicated/denormalized audience column) so no
-- copy of the candidate's audience is ever persisted on the ledger row.
CREATE OR REPLACE FUNCTION kai.p3_17_enforce_decision_audience_compatibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_audience text;
BEGIN
  SELECT requested_audience INTO candidate_audience
    FROM kai.export_candidates
   WHERE export_candidate_id = NEW.export_candidate_id
     AND organization_id = NEW.organization_id;

  IF candidate_audience IS NULL THEN
    RAISE EXCEPTION 'P3-17 human-authority-decision-ledger: export_candidate_id % not found for organization %', NEW.export_candidate_id, NEW.organization_id;
  END IF;

  IF NEW.decision_type = 'funder_ready' AND candidate_audience <> 'funder' THEN
    RAISE EXCEPTION 'P3-17 human-authority-decision-ledger: funder_ready may only bind a funder-audience export candidate, bound candidate is %', candidate_audience;
  END IF;

  IF NEW.decision_type = 'public_ready' AND candidate_audience <> 'public' THEN
    RAISE EXCEPTION 'P3-17 human-authority-decision-ledger: public_ready may only bind a public-audience export candidate, bound candidate is %', candidate_audience;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_p3_17_human_authority_decisions_audience_compatibility
  BEFORE INSERT ON kai.human_authority_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.p3_17_enforce_decision_audience_compatibility();

COMMIT;
