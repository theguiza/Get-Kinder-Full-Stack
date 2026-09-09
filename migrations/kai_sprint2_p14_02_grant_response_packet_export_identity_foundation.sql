BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before P14-02 grant-response-packet-export-identity-foundation migration';
  END IF;
  IF to_regclass('kai.generation_runs') IS NULL THEN
    RAISE EXCEPTION 'kai.generation_runs is required before P14-02 grant-response-packet-export-identity-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'kai' AND table_name = 'generation_runs' AND column_name = 'engagement_id'
  ) THEN
    RAISE EXCEPTION 'kai.generation_runs.engagement_id (P14-01) is required before P14-02 grant-response-packet-export-identity-foundation migration';
  END IF;
END $$;

-- P14-02 scope (Grant Response Packet foundation, step 2 of N): this
-- migration adds exactly one new, additive foundation table - a durable,
-- append-only identity record for the existing read-only
-- organizationId + engagementId Grant Response Packet composite (see
-- Backend/kai/services/kaiGrantResponsePacketService.js), which today has no
-- identity of its own beyond that request-time pair. One row means "this
-- exact organization, engagement, and packet audience has a durable export
-- identity a later, separately authorized package may bind governed
-- final-release/manifest state to." This migration does not create that
-- binding, does not create a route, service, or repository call site that
-- mints or reads a row, does not touch kai.export_candidates or
-- kai.export_manifests, does not reopen P14-01, packet membership,
-- composition, preview, frontend, or member-level export work, and does not
-- assign any member's existing exportCandidateId or exportManifestId as this
-- identity - packet-level identity is new and independent of per-member
-- export identity.
--
-- Identity is structural, not content-derived: unlike kai.export_candidates
-- / kai.export_manifests (whose identity converges on a canonical_fingerprint
-- hash of mutable draft/authority state), a Grant Response Packet is already
-- uniquely determined by its (organization_id, engagement_id, packet_audience)
-- triple - that triple is this table's replay-convergence key, and
-- `INSERT ... ON CONFLICT (organization_id, engagement_id, packet_audience)
-- DO NOTHING` is sufficient for idempotent get-or-create. `packet_audience`
-- is pinned to 'funder', mirroring the existing packet DTO contract's only
-- supported audience.
CREATE TABLE kai.grant_response_packet_export_identities (
  grant_response_packet_export_identity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  packet_audience text NOT NULL,
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT grant_response_packet_export_identities_p14_02_id_org_unique
    UNIQUE (grant_response_packet_export_identity_id, organization_id),
  CONSTRAINT grant_response_packet_export_identities_p14_02_engagement_fk
    FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT grant_response_packet_export_identities_p14_02_audience_check
    CHECK (packet_audience = 'funder'),
  -- Name kept within Postgres's 63-byte identifier limit (the natural
  -- "..._created_by_type_check" name silently truncates otherwise).
  CONSTRAINT grant_response_packet_export_identities_p14_02_created_by_chk
    CHECK (created_by_type IN ('human', 'system')),
  -- Replay convergence / durable composite identity: one row per
  -- organization/engagement/audience triple, ever.
  CONSTRAINT grant_response_packet_export_identities_p14_02_identity_unique
    UNIQUE (organization_id, engagement_id, packet_audience)
);

CREATE OR REPLACE FUNCTION kai.p14_02_reject_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P14-02 grant-response-packet-export-identity foundation is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_p14_02_grant_response_packet_export_identities_append_only
  BEFORE UPDATE OR DELETE ON kai.grant_response_packet_export_identities
  FOR EACH ROW EXECUTE FUNCTION kai.p14_02_reject_identity_mutation();

COMMIT;
