BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.board_reporting_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.board_reporting_candidates (BR-02) is required before board-reporting-candidate-export-manifest-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'board_reporting_candidates_br_02_id_org_unique'
       AND conrelid = 'kai.board_reporting_candidates'::regclass
  ) THEN
    RAISE EXCEPTION 'the BR-02 tenant-safe UNIQUE(board_reporting_candidate_id, organization_id) is required before board-reporting-candidate-export-manifest-foundation migration';
  END IF;
  IF to_regclass('kai.board_reporting_candidate_human_authority_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.board_reporting_candidate_human_authority_decisions (BR-04) is required before board-reporting-candidate-export-manifest-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'brchad_br_04_id_org_candidate_type_unique'
       AND conrelid = 'kai.board_reporting_candidate_human_authority_decisions'::regclass
  ) THEN
    RAISE EXCEPTION 'the BR-04 tenant-safe lineage-target UNIQUE(decision_id, organization_id, board_reporting_candidate_id, decision_type) is required before board-reporting-candidate-export-manifest-foundation migration';
  END IF;
END $$;

-- Scope: this migration adds exactly one new additive, append-only
-- foundation - an immutable Board Reporting export-manifest identity record
-- binding an existing, immutable BR-02 Board Reporting candidate to the
-- exact effective BR-04 export_authority_granted decision that authorized
-- it. It is the Board-scoped analogue of the existing P3-19
-- kai.export_manifests foundation (member-level) and the existing P14-08A
-- kai.grant_response_packet_export_manifests foundation (packet-level) - the
-- same identity shape, the same replay-convergence-unique pattern, the same
-- append-only trigger discipline - but it is NOT an alteration of either
-- existing table, neither of which can represent a Board Reporting
-- candidate: kai.export_manifests' mandatory
-- export_manifests_p3_19_candidate_fk and
-- export_manifests_p3_19_authority_decision_fk hard-reference
-- kai.export_candidates and kai.human_authority_decisions, and
-- kai.grant_response_packet_export_manifests' mandatory
-- grppem_p14_08a_candidate_fk and grppem_p14_08a_authority_decision_fk
-- hard-reference kai.grant_response_packet_export_candidates and
-- kai.grant_response_packet_human_authority_decisions - three structurally
-- disjoint candidate/authority lineages with no compatible row across one
-- another. Rather than weaken any of those constraints into a
-- polymorphic/nullable reference, this migration adds one Board-scoped
-- sibling manifest table instead, exactly mirroring how P14-08A added a
-- packet-scoped sibling rather than altering kai.export_manifests.
--
-- This migration creates no export_review_queue_item binding column (no
-- FUNCTIONAL_DEPENDENCY_PROOF establishing a single valid Board review item
-- per candidate has been established for this package, unlike the proven
-- P3-20 follow-on to P3-19 - if such a proof is established for Board in a
-- future package, review binding can be added the same way P3-20 added it,
-- as a separate, additive migration), no requested_audience/packet_audience
-- column (a Board Reporting candidate's packet_audience is always exactly
-- "internal" - board_reporting_candidates_br_02_audience_chk), and no
-- final-eligibility snapshot column (the existing Board final-eligibility
-- gate is a fresh, read-only, run-time composition over current governed
-- state, not a table this manifest can copy a point-in-time snapshot from
-- without inventing new persisted eligibility state this package is not
-- authorized to add). It creates no manifest-create service, route,
-- Board delivery, or final Board Summary - persistence identity only.
CREATE TABLE kai.board_reporting_candidate_export_manifests (
  board_reporting_candidate_export_manifest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_reporting_candidate_id uuid NOT NULL,
  effective_authority_decision_id uuid NOT NULL,
  effective_authority_decision_type text NOT NULL,
  fingerprint_contract_version text NOT NULL,
  canonical_fingerprint text NOT NULL,
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT brcem_id_org_unique
    UNIQUE (board_reporting_candidate_export_manifest_id, organization_id),
  -- Replay convergence: the same effective-authority state submitted twice
  -- for the same Board candidate converges to exactly one manifest row.
  CONSTRAINT brcem_replay_convergence_unique
    UNIQUE (organization_id, board_reporting_candidate_id, canonical_fingerprint),
  -- Tenant-safe composite FK into the existing, immutable BR-02 Board
  -- Reporting candidate table only - never kai.export_candidates
  -- (member-level) or kai.grant_response_packet_export_candidates
  -- (packet-level).
  CONSTRAINT brcem_candidate_fk
    FOREIGN KEY (board_reporting_candidate_id, organization_id)
    REFERENCES kai.board_reporting_candidates (board_reporting_candidate_id, organization_id)
    ON DELETE RESTRICT,
  -- The bound decision must belong to this same organization and Board
  -- candidate, and must be a decision of type export_authority_granted -
  -- lineage can never cross tenant, candidate, or decision-type, and never
  -- resolves to a row of kai.human_authority_decisions (member-level) or
  -- kai.grant_response_packet_human_authority_decisions (packet-level).
  CONSTRAINT brcem_authority_decision_fk
    FOREIGN KEY (effective_authority_decision_id, organization_id, board_reporting_candidate_id, effective_authority_decision_type)
    REFERENCES kai.board_reporting_candidate_human_authority_decisions (decision_id, organization_id, board_reporting_candidate_id, decision_type)
    ON DELETE RESTRICT,
  CONSTRAINT brcem_decision_type_check
    CHECK (effective_authority_decision_type = 'export_authority_granted'),
  CONSTRAINT brcem_fingerprint_contract_version_check
    CHECK (fingerprint_contract_version = 'kai-sprint2-board-reporting-candidate-export-manifest-fingerprint-v1'),
  CONSTRAINT brcem_canonical_fingerprint_check
    CHECK (canonical_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT brcem_created_by_type_check
    CHECK (created_by_type = 'human')
);

CREATE OR REPLACE FUNCTION kai.brcem_reject_manifest_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'board-reporting-candidate-export-manifest foundation is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_brcem_append_only
  BEFORE UPDATE OR DELETE ON kai.board_reporting_candidate_export_manifests
  FOR EACH ROW EXECUTE FUNCTION kai.brcem_reject_manifest_mutation();

COMMIT;
