BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.board_reporting_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.board_reporting_candidates (BR-02) is required before BR-04 board-reporting-candidate-human-authority-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'board_reporting_candidates_br_02_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'the BR-02 tenant-safe UNIQUE(board_reporting_candidate_id, organization_id) is required before BR-04 board-reporting-candidate-human-authority-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'human_authority_decisions_p3_17_candidate_fk'
       AND conrelid = 'kai.human_authority_decisions'::regclass
       AND confrelid = 'kai.export_candidates'::regclass
  ) THEN
    RAISE EXCEPTION 'the existing P3-17 kai.human_authority_decisions -> kai.export_candidates FK must remain unchanged before BR-04 board-reporting-candidate-human-authority-decision-ledger migration';
  END IF;
END $$;

-- BR-04 scope: this migration adds exactly one new additive, append-only
-- foundation - a human final-release authority decision ledger bound to an
-- exact, existing, immutable BR-02 Board Reporting candidate. It is the same
-- "human final-release authority" concept the existing P3-17
-- kai.human_authority_decisions ledger already represents for a single-draft
-- export candidate, and the same concept the existing P14-07B1
-- kai.grant_response_packet_human_authority_decisions ledger represents for a
-- Grant Response Packet export candidate (export_authority_granted / grant /
-- revoke, decided only by a mapped human gk_admin, append-only supersession
-- lineage) - not a different concept (no board_approved/board_release/
-- board_finalized vocabulary). It changes no existing table, column,
-- constraint, trigger, or index from Gate A through BR-03B, and in
-- particular never touches kai.human_authority_decisions or
-- kai.grant_response_packet_human_authority_decisions or either of their
-- existing hard FOREIGN KEYs - those member-level and packet-level contracts
-- are preserved completely unchanged. A Board Reporting candidate cannot be
-- represented by either existing table (it lives in
-- kai.board_reporting_candidates, an entirely separate table with no
-- compatible row - the same reason P14-07B1 added a packet-scoped sibling
-- ledger instead of a Grant candidate), so this migration adds one
-- Board-scoped sibling ledger instead of weakening either existing FK into a
-- polymorphic/nullable reference.
--
-- Scope is intentionally narrower than kai.human_authority_decisions: a
-- Board Reporting candidate's packet_audience is always exactly "internal"
-- (board_reporting_candidates_br_02_audience_chk), so there is no
-- client_reviewed/funder_ready/public_ready equivalent to represent here, and
-- no requested_audience/packet_audience column is needed on this ledger -
-- only the single decision type this package is authorized to add,
-- export_authority_granted, decided only by gk_admin, exactly mirroring the
-- existing P3-17/P14-07B1 decision-type/role contract for that same decision
-- type.
--
-- This migration creates no finalGate/VAL-EXP-001-equivalent Board final-
-- eligibility state, no Board manifest, and no Board file/artifact. No
-- eligibility read, route, or frontend wiring is added by this migration.
-- Whether the bound candidate's board_reporting_candidate_review queue item
-- is resolved is a runtime authorization precondition for a future grant/
-- revoke mutation service (mirroring how the existing final-release path
-- checks exportCandidateId + exportReviewQueueItemId together at the service
-- layer) - it is intentionally not encoded as a schema constraint here, the
-- same way neither existing ledger encodes its own review-queue state as a
-- table constraint.
CREATE TABLE kai.board_reporting_candidate_human_authority_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_reporting_candidate_id uuid NOT NULL,
  decision_type text NOT NULL,
  decision_action text NOT NULL,
  decided_by uuid NOT NULL,
  decided_by_role text NOT NULL,
  supersedes_decision_id uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT brchad_br_04_id_org_unique
    UNIQUE (decision_id, organization_id),
  -- Self-referencing lineage FK target: pins (decision_id, organization_id,
  -- board_reporting_candidate_id, decision_type) together so a predecessor
  -- reference can never cross organization, candidate, or decision-type
  -- lineage - mirrors the existing P3-17/P14-07B1 id/org/candidate/type
  -- unique key exactly, targeted at the Board candidate instead.
  CONSTRAINT brchad_br_04_id_org_candidate_type_unique
    UNIQUE (decision_id, organization_id, board_reporting_candidate_id, decision_type),
  -- Tenant-safe composite FK into the existing, immutable BR-02 Board
  -- Reporting candidate table - a decision can never attach to another
  -- organization's candidate, and (being a composite key on the candidate's
  -- own PRIMARY KEY plus organization_id) can never attach to any row of any
  -- other table, in particular never to kai.export_candidates (member-level)
  -- or kai.grant_response_packet_export_candidates (packet-level).
  CONSTRAINT brchad_br_04_candidate_fk
    FOREIGN KEY (board_reporting_candidate_id, organization_id)
    REFERENCES kai.board_reporting_candidates (board_reporting_candidate_id, organization_id)
    ON DELETE RESTRICT,
  -- The predecessor referenced by supersedes_decision_id must already exist
  -- (ordinary, non-deferred FK) and must belong to the same organization,
  -- Board candidate, and decision type as the new row - lineage can never
  -- fork across candidates or decision types, and a decision for candidate A
  -- can never supersede or be superseded by a decision for candidate B.
  CONSTRAINT brchad_br_04_supersedes_fk
    FOREIGN KEY (supersedes_decision_id, organization_id, board_reporting_candidate_id, decision_type)
    REFERENCES kai.board_reporting_candidate_human_authority_decisions (decision_id, organization_id, board_reporting_candidate_id, decision_type)
    ON DELETE RESTRICT,
  CONSTRAINT brchad_br_04_not_self_superseding
    CHECK (supersedes_decision_id IS DISTINCT FROM decision_id),
  -- Only the single decision type this package is authorized to add - no
  -- board_approved/board_release/board_finalized vocabulary.
  CONSTRAINT brchad_br_04_decision_type_check
    CHECK (decision_type = 'export_authority_granted'),
  CONSTRAINT brchad_br_04_decision_action_check
    CHECK (decision_action IN ('grant', 'revoke')),
  -- Mirrors the existing P3-17/P14-07B1 role-by-type contract for
  -- export_authority_granted exactly: gk_admin only.
  CONSTRAINT brchad_br_04_role_check
    CHECK (decided_by_role = 'gk_admin'),
  -- The first event in a lineage must be a grant: a root row (no
  -- predecessor) can never be a revoke.
  CONSTRAINT brchad_br_04_root_is_grant_check
    CHECK (supersedes_decision_id IS NOT NULL OR decision_action = 'grant'),
  CONSTRAINT brchad_br_04_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- At most one root (first) decision per (organization, Board candidate,
-- decision type) lineage: a lineage is a single chain, never a forest.
CREATE UNIQUE INDEX ux_brchad_br_04_root_per_lineage
  ON kai.board_reporting_candidate_human_authority_decisions (organization_id, board_reporting_candidate_id, decision_type)
  WHERE supersedes_decision_id IS NULL;

-- At most one direct successor per predecessor: two concurrent decisions
-- racing from the same current head can each attempt their own INSERT, but
-- only one can ever commit - the loser receives a unique_violation and zero
-- rows are written or rewritten for it.
CREATE UNIQUE INDEX ux_brchad_br_04_single_successor
  ON kai.board_reporting_candidate_human_authority_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION kai.br_04_reject_authority_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'BR-04 board-reporting-candidate-human-authority-decision-ledger history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_br_04_brchad_append_only
  BEFORE UPDATE OR DELETE ON kai.board_reporting_candidate_human_authority_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.br_04_reject_authority_mutation();

COMMIT;
