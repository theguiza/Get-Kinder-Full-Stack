BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.grant_response_packet_export_candidates') IS NULL THEN
    RAISE EXCEPTION 'kai.grant_response_packet_export_candidates (P14-03) is required before P14-08A grant-response-packet-export-manifest-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'grant_response_packet_export_candidates_p14_03_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.grant_response_packet_export_candidates_p14_03_id_org_unique is required before P14-08A grant-response-packet-export-manifest-foundation migration';
  END IF;
  IF to_regclass('kai.grant_response_packet_human_authority_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.grant_response_packet_human_authority_decisions (P14-07B1) is required before P14-08A grant-response-packet-export-manifest-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'grppehad_p14_07b1_id_org_candidate_type_unique'
  ) THEN
    RAISE EXCEPTION 'kai.grppehad_p14_07b1_id_org_candidate_type_unique is required before P14-08A grant-response-packet-export-manifest-foundation migration';
  END IF;
END $$;

-- P14-08A scope: this migration adds exactly one new additive, append-only
-- foundation - an immutable Grant Response Packet export-manifest identity
-- record binding an existing, immutable P14-03 packet export candidate to the
-- exact effective P14-07B1 export_authority_granted decision that authorized
-- it. It is the packet-level analogue of the existing P3-19
-- kai.export_manifests foundation, not a different concept - same identity
-- shape, same replay-convergence-unique pattern, same append-only trigger
-- discipline - but it is NOT an alteration of kai.export_manifests, which
-- cannot represent a packet candidate: kai.export_manifests' mandatory
-- export_manifests_p3_19_candidate_fk and
-- export_manifests_p3_19_authority_decision_fk both hard-reference
-- kai.export_candidates and kai.human_authority_decisions, structurally
-- disjoint member-level tables. Rather than weaken either constraint into a
-- polymorphic/nullable reference, this migration adds one packet-scoped
-- sibling table instead, exactly mirroring how P14-07B1 added
-- kai.grant_response_packet_human_authority_decisions as a sibling to
-- kai.human_authority_decisions rather than altering it.
--
-- This migration creates no requested_audience column (a Grant Response
-- Packet's audience is always exactly "funder"), no export_review_queue_item
-- binding column (no packet-level review-queue-item concept exists to bind
-- to - the packet's own review state is read directly off its candidate, not
-- off a review-queue-item row, per the existing P14-06D/P14-07 read path),
-- and no packet_approved/packet_published/packet_funder_ready/
-- latest_manifest/preferred_manifest vocabulary. It creates no packet
-- final-eligibility state (P14-07 already exists and is reused, not
-- reimplemented, by the repository consuming this table), no packet
-- Markdown/PDF/DOCX/CSV bytes, and no HTTP route or frontend wiring.
CREATE TABLE kai.grant_response_packet_export_manifests (
  grant_response_packet_export_manifest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  grant_response_packet_export_candidate_id uuid NOT NULL,
  effective_authority_decision_id uuid NOT NULL,
  effective_authority_decision_type text NOT NULL,
  fingerprint_contract_version text NOT NULL,
  canonical_fingerprint text NOT NULL,
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grppem_p14_08a_id_org_unique
    UNIQUE (grant_response_packet_export_manifest_id, organization_id),
  -- Replay convergence: the same effective-authority state submitted twice
  -- for the same packet candidate converges to exactly one manifest row.
  CONSTRAINT grppem_p14_08a_replay_convergence_unique
    UNIQUE (organization_id, grant_response_packet_export_candidate_id, canonical_fingerprint),
  -- Tenant-safe composite FK into the existing, immutable P14-03 packet
  -- candidate table only - never kai.export_candidates (member-level).
  CONSTRAINT grppem_p14_08a_candidate_fk
    FOREIGN KEY (grant_response_packet_export_candidate_id, organization_id)
    REFERENCES kai.grant_response_packet_export_candidates (grant_response_packet_export_candidate_id, organization_id)
    ON DELETE RESTRICT,
  -- The bound decision must belong to this same organization and packet
  -- candidate, and must be a decision of type export_authority_granted -
  -- lineage can never cross tenant, candidate, or decision-type, and never
  -- resolves to a row of kai.human_authority_decisions (member-level).
  CONSTRAINT grppem_p14_08a_authority_decision_fk
    FOREIGN KEY (effective_authority_decision_id, organization_id, grant_response_packet_export_candidate_id, effective_authority_decision_type)
    REFERENCES kai.grant_response_packet_human_authority_decisions (decision_id, organization_id, grant_response_packet_export_candidate_id, decision_type)
    ON DELETE RESTRICT,
  CONSTRAINT grppem_p14_08a_decision_type_check
    CHECK (effective_authority_decision_type = 'export_authority_granted'),
  CONSTRAINT grppem_p14_08a_fingerprint_contract_version_check
    CHECK (fingerprint_contract_version = 'kai-sprint2-p14-08a-grant-response-packet-export-manifest-fingerprint-v1'),
  CONSTRAINT grppem_p14_08a_canonical_fingerprint_check
    CHECK (canonical_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT grppem_p14_08a_created_by_type_check
    CHECK (created_by_type = 'human')
);

CREATE OR REPLACE FUNCTION kai.p14_08a_reject_manifest_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P14-08A grant-response-packet-export-manifest foundation is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_p14_08a_grppem_append_only
  BEFORE UPDATE OR DELETE ON kai.grant_response_packet_export_manifests
  FOR EACH ROW EXECUTE FUNCTION kai.p14_08a_reject_manifest_mutation();

COMMIT;
