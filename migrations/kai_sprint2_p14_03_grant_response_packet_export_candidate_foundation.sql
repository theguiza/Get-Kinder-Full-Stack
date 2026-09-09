BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.grant_response_packet_export_identities') IS NULL THEN
    RAISE EXCEPTION 'kai.grant_response_packet_export_identities (P14-02) is required before P14-03 grant-response-packet-export-candidate-foundation migration';
  END IF;
  IF to_regclass('kai.generated_content_drafts') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_drafts is required before P14-03 grant-response-packet-export-candidate-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'grant_response_packet_export_identities_p14_02_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'the P14-02 tenant-safe UNIQUE(grant_response_packet_export_identity_id, organization_id) is required before P14-03 grant-response-packet-export-candidate-foundation migration';
  END IF;
END $$;

-- P14-03 scope (Grant Response Packet foundation, step 3 of N): this
-- migration adds exactly two new, additive, append-only foundation tables on
-- top of the existing P14-02 durable packet identity
-- (kai.grant_response_packet_export_identities) and the existing immutable
-- generated-content draft/block/citation graph - a fingerprint-convergent
-- packet EXPORT CANDIDATE, and a server-derived, ordered MEMBER SNAPSHOT of
-- which generated_content_draft rows made up that exact candidate. It does
-- not create any approval, final-release, or manifest state, does not touch
-- kai.export_candidates, kai.export_manifests, or any P14-02 table/trigger/
-- constraint, does not reopen P14-01, membership, composition, preview,
-- frontend, or single-draft export-review/export-manifest work, and does not
-- add any member exportCandidateId/exportManifestId column to either new
-- table.
--
-- Identity shape decision: unlike P14-02 (structural (organization_id,
-- engagement_id, packet_audience) identity - a packet exists exactly once
-- per triple), a packet's CONTENT can legitimately change over time as
-- member drafts are reviewed/revised, so - exactly like
-- kai.export_candidates - this candidate's identity converges on a
-- canonical_fingerprint hash of the packet's own semantic render-model state
-- (see Backend/kai/services/kaiGrantResponsePacketExportCandidateFingerprintService.js),
-- scoped under the existing P14-02 packet identity it is FK'd to. The same
-- semantic packet state, requested any number of times, converges to the
-- SAME candidate row; changed semantic state produces a new one.
CREATE TABLE kai.grant_response_packet_export_candidates (
  grant_response_packet_export_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  grant_response_packet_export_identity_id uuid NOT NULL,
  fingerprint_contract_version text NOT NULL,
  canonical_fingerprint text NOT NULL,
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grant_response_packet_export_candidates_p14_03_id_org_unique
    UNIQUE (grant_response_packet_export_candidate_id, organization_id),
  -- Tenant-safe composite FK into the existing P14-02 identity table - a
  -- candidate can never be attached to another organization's packet
  -- identity, mirroring the P14-02 engagement FK and the P3-16
  -- export_candidates -> limitation_snapshots FK exactly.
  CONSTRAINT grant_response_packet_export_candidates_p14_03_identity_fk
    FOREIGN KEY (grant_response_packet_export_identity_id, organization_id)
    REFERENCES kai.grant_response_packet_export_identities (grant_response_packet_export_identity_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT grant_response_packet_export_candidates_p14_03_fp_contract_chk
    CHECK (fingerprint_contract_version = 'kai-sprint2-p14-03-grant-response-packet-export-candidate-fingerprint-v1'),
  CONSTRAINT grant_response_packet_export_candidates_p14_03_fp_check
    CHECK (canonical_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT grant_response_packet_export_candidates_p14_03_created_by_chk
    CHECK (created_by_type IN ('human', 'system')),
  -- Replay convergence: the same packet identity re-deriving the exact same
  -- semantic state (same canonical_fingerprint) always converges to this one
  -- row - never a duplicate.
  CONSTRAINT grant_response_packet_export_candidates_p14_03_converge_unq
    UNIQUE (organization_id, grant_response_packet_export_identity_id, canonical_fingerprint)
);

CREATE OR REPLACE FUNCTION kai.p14_03_reject_candidate_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P14-03 grant-response-packet-export-candidate foundation is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_p14_03_grant_response_packet_export_candidates_append_only
  BEFORE UPDATE OR DELETE ON kai.grant_response_packet_export_candidates
  FOR EACH ROW EXECUTE FUNCTION kai.p14_03_reject_candidate_mutation();

-- Server-derived, ordered membership snapshot: exactly which
-- generated_content_draft rows, in which deterministic render-model order,
-- made up this exact candidate. No block text, no raw evidence/source
-- content, no artifact bytes, and - like the candidate table above - no
-- member exportCandidateId/exportManifestId column: this is a NEW,
-- independent packet-level snapshot, never a promotion of per-member export
-- identity.
CREATE TABLE kai.grant_response_packet_export_candidate_members (
  grant_response_packet_export_candidate_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_response_packet_export_candidate_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  generated_content_draft_id uuid NOT NULL,
  ordinal integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grppec_members_p14_03_id_org_unique
    UNIQUE (grant_response_packet_export_candidate_member_id, organization_id),
  CONSTRAINT grppec_members_p14_03_candidate_fk
    FOREIGN KEY (grant_response_packet_export_candidate_id, organization_id)
    REFERENCES kai.grant_response_packet_export_candidates (grant_response_packet_export_candidate_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT grppec_members_p14_03_draft_fk
    FOREIGN KEY (generated_content_draft_id, organization_id)
    REFERENCES kai.generated_content_drafts (generated_content_draft_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT grppec_members_p14_03_ordinal_chk
    CHECK (ordinal >= 0),
  -- A draft is a member of a given candidate at most once.
  CONSTRAINT grppec_members_p14_03_draft_unique
    UNIQUE (grant_response_packet_export_candidate_id, generated_content_draft_id),
  -- Ordinal position within a candidate's membership is unique - the render
  -- model's deterministic order is preserved exactly, never two members at
  -- the same position.
  CONSTRAINT grppec_members_p14_03_ordinal_unique
    UNIQUE (grant_response_packet_export_candidate_id, ordinal)
);

CREATE TRIGGER trg_p14_03_grppec_members_append_only
  BEFORE UPDATE OR DELETE ON kai.grant_response_packet_export_candidate_members
  FOR EACH ROW EXECUTE FUNCTION kai.p14_03_reject_candidate_mutation();

COMMIT;
