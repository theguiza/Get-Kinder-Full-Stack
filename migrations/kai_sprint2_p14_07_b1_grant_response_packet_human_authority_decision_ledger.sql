BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.grant_response_packet_export_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.grant_response_packet_export_candidates (P14-03) is required before P14-07B1 grant-response-packet-human-authority-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'grant_response_packet_export_candidates_p14_03_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'the P14-03 tenant-safe UNIQUE(grant_response_packet_export_candidate_id, organization_id) is required before P14-07B1 grant-response-packet-human-authority-decision-ledger migration';
  END IF;
END $$;

-- P14-07B1 scope: this migration adds exactly one new additive, append-only
-- foundation - a human final-release authority decision ledger bound to an
-- exact, existing, immutable P14-03 grant-response-packet export candidate.
-- It is the same "human final-release authority" concept the existing P3-17
-- kai.human_authority_decisions ledger already represents for a single-draft
-- export candidate (export_authority_granted / grant / revoke, decided by an
-- exact mapped human gk_admin, append-only supersession lineage) - not a
-- different concept (no packet_approved/packet_funder_ready/packet_finalized
-- vocabulary). It changes no existing table, column, constraint, trigger, or
-- index from Gate A through P14-06, and in particular never touches
-- kai.human_authority_decisions or its existing hard
-- FOREIGN KEY (export_candidate_id, organization_id) REFERENCES
-- kai.export_candidates (export_candidate_id, organization_id) - that
-- member-level contract is preserved completely unchanged. A packet export
-- candidate cannot be represented by that table (it lives in
-- kai.grant_response_packet_export_candidates, an entirely separate table
-- with no compatible row), so this migration adds one packet-scoped sibling
-- ledger instead of weakening the existing FK into a polymorphic/nullable
-- reference.
--
-- Scope is intentionally narrower than kai.human_authority_decisions: a
-- Grant Response Packet's audience is always exactly "funder" (see
-- kai.grant_response_packet_export_identities.packet_audience and
-- GRANT_RESPONSE_PACKET_AUDIENCE), so there is no client_reviewed/
-- funder_ready/public_ready equivalent to represent here, and no
-- requested_audience column is needed on this ledger - only the single
-- decision type this package is authorized to add,
-- export_authority_granted, decided only by gk_admin, exactly mirroring the
-- existing P3-17 decision-type/role contract for that same decision type.
--
-- This migration creates no finalGate/VAL-EXP-001-equivalent packet final-
-- eligibility state, no packet manifest, and no packet file/artifact. No
-- eligibility read, route, or frontend wiring is added by this migration or
-- by the repository package that follows it in this same local package.
CREATE TABLE kai.grant_response_packet_human_authority_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  grant_response_packet_export_candidate_id uuid NOT NULL,
  decision_type text NOT NULL,
  decision_action text NOT NULL,
  decided_by uuid NOT NULL,
  decided_by_role text NOT NULL,
  supersedes_decision_id uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grppehad_p14_07b1_id_org_unique
    UNIQUE (decision_id, organization_id),
  -- Self-referencing lineage FK target: pins (decision_id, organization_id,
  -- grant_response_packet_export_candidate_id, decision_type) together so a
  -- predecessor reference can never cross organization, candidate, or
  -- decision-type lineage - mirrors the existing P3-17
  -- human_authority_decisions_p3_17_id_org_candidate_type_unique exactly,
  -- targeted at the packet candidate instead.
  CONSTRAINT grppehad_p14_07b1_id_org_candidate_type_unique
    UNIQUE (decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type),
  -- Tenant-safe composite FK into the existing, immutable P14-03 packet
  -- candidate table - a decision can never attach to another organization's
  -- candidate, and (being a composite key on the candidate's own
  -- PRIMARY KEY plus organization_id) can never attach to any row of any
  -- other table, in particular never to kai.export_candidates (member-level)
  -- or to kai.grant_response_packet_export_identities (structural identity,
  -- not a candidate).
  CONSTRAINT grppehad_p14_07b1_candidate_fk
    FOREIGN KEY (grant_response_packet_export_candidate_id, organization_id)
    REFERENCES kai.grant_response_packet_export_candidates (grant_response_packet_export_candidate_id, organization_id)
    ON DELETE RESTRICT,
  -- The predecessor referenced by supersedes_decision_id must already exist
  -- (ordinary, non-deferred FK) and must belong to the same organization,
  -- packet candidate, and decision type as the new row - lineage can never
  -- fork across candidates or decision types, and a decision for candidate A
  -- can never supersede or be superseded by a decision for candidate B.
  CONSTRAINT grppehad_p14_07b1_supersedes_fk
    FOREIGN KEY (supersedes_decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type)
    REFERENCES kai.grant_response_packet_human_authority_decisions (decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type)
    ON DELETE RESTRICT,
  CONSTRAINT grppehad_p14_07b1_not_self_superseding
    CHECK (supersedes_decision_id IS DISTINCT FROM decision_id),
  -- Only the single decision type this package is authorized to add - no
  -- packet_approved/packet_funder_ready/packet_finalized vocabulary.
  CONSTRAINT grppehad_p14_07b1_decision_type_check
    CHECK (decision_type = 'export_authority_granted'),
  CONSTRAINT grppehad_p14_07b1_decision_action_check
    CHECK (decision_action IN ('grant', 'revoke')),
  -- Mirrors the existing P3-17 role-by-type contract for
  -- export_authority_granted exactly: gk_admin only.
  CONSTRAINT grppehad_p14_07b1_role_check
    CHECK (decided_by_role = 'gk_admin'),
  -- The first event in a lineage must be a grant: a root row (no
  -- predecessor) can never be a revoke.
  CONSTRAINT grppehad_p14_07b1_root_is_grant_check
    CHECK (supersedes_decision_id IS NOT NULL OR decision_action = 'grant'),
  CONSTRAINT grppehad_p14_07b1_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- At most one root (first) decision per (organization, packet candidate,
-- decision type) lineage: a lineage is a single chain, never a forest.
CREATE UNIQUE INDEX ux_grppehad_p14_07b1_root_per_lineage
  ON kai.grant_response_packet_human_authority_decisions (organization_id, grant_response_packet_export_candidate_id, decision_type)
  WHERE supersedes_decision_id IS NULL;

-- At most one direct successor per predecessor: two concurrent decisions
-- racing from the same current head can each attempt their own INSERT, but
-- only one can ever commit - the loser receives a unique_violation and zero
-- rows are written or rewritten for it.
CREATE UNIQUE INDEX ux_grppehad_p14_07b1_single_successor
  ON kai.grant_response_packet_human_authority_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION kai.p14_07b1_reject_authority_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P14-07B1 grant-response-packet-human-authority-decision-ledger history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_p14_07b1_grppehad_append_only
  BEFORE UPDATE OR DELETE ON kai.grant_response_packet_human_authority_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.p14_07b1_reject_authority_mutation();

COMMIT;
