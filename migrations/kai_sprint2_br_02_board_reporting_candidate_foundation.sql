BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before BR-02 board-reporting-candidate-foundation migration';
  END IF;
  IF to_regclass('kai.generated_content_drafts') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_drafts is required before BR-02 board-reporting-candidate-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'kai.engagements'::regclass
       AND contype = 'u'
       AND pg_get_constraintdef(oid) LIKE '%UNIQUE (engagement_id, organization_id)%'
  ) THEN
    RAISE EXCEPTION 'tenant-safe UNIQUE(engagement_id, organization_id) is required before BR-02';
  END IF;
END $$;

CREATE TABLE kai.board_reporting_candidates (
  board_reporting_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  packet_audience text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint_contract_version text NOT NULL,
  canonical_fingerprint text NOT NULL,
  candidate_status text NOT NULL,
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT board_reporting_candidates_br_02_id_org_unique
    UNIQUE (board_reporting_candidate_id, organization_id),
  CONSTRAINT board_reporting_candidates_br_02_engagement_fk
    FOREIGN KEY (engagement_id, organization_id)
    REFERENCES kai.engagements (engagement_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT board_reporting_candidates_br_02_audience_chk
    CHECK (packet_audience = 'internal'),
  CONSTRAINT board_reporting_candidates_br_02_idempotency_key_chk
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  CONSTRAINT board_reporting_candidates_br_02_fp_contract_chk
    CHECK (fingerprint_contract_version = 'kai-sprint2-br-02-board-reporting-candidate-fingerprint-v1'),
  CONSTRAINT board_reporting_candidates_br_02_fp_chk
    CHECK (canonical_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT board_reporting_candidates_br_02_status_chk
    CHECK (candidate_status = 'created'),
  CONSTRAINT board_reporting_candidates_br_02_created_by_chk
    CHECK (created_by_type IN ('human', 'system')),
  CONSTRAINT board_reporting_candidates_br_02_idempotency_unq
    UNIQUE (organization_id, engagement_id, idempotency_key)
);

CREATE INDEX ix_board_reporting_candidates_br_02_engagement_created
  ON kai.board_reporting_candidates (organization_id, engagement_id, created_at DESC);

CREATE INDEX ix_board_reporting_candidates_br_02_fingerprint
  ON kai.board_reporting_candidates (organization_id, engagement_id, canonical_fingerprint);

CREATE OR REPLACE FUNCTION kai.br_02_reject_board_reporting_candidate_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'BR-02 board-reporting-candidate foundation is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_br_02_board_reporting_candidates_append_only
  BEFORE UPDATE OR DELETE ON kai.board_reporting_candidates
  FOR EACH ROW EXECUTE FUNCTION kai.br_02_reject_board_reporting_candidate_mutation();

CREATE TABLE kai.board_reporting_candidate_members (
  board_reporting_candidate_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_reporting_candidate_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  generated_content_draft_id uuid NOT NULL,
  ordinal integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT board_reporting_candidate_members_br_02_id_org_unique
    UNIQUE (board_reporting_candidate_member_id, organization_id),
  CONSTRAINT board_reporting_candidate_members_br_02_candidate_fk
    FOREIGN KEY (board_reporting_candidate_id, organization_id)
    REFERENCES kai.board_reporting_candidates (board_reporting_candidate_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT board_reporting_candidate_members_br_02_draft_fk
    FOREIGN KEY (generated_content_draft_id, organization_id)
    REFERENCES kai.generated_content_drafts (generated_content_draft_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT board_reporting_candidate_members_br_02_ordinal_chk
    CHECK (ordinal >= 0),
  CONSTRAINT board_reporting_candidate_members_br_02_draft_unique
    UNIQUE (board_reporting_candidate_id, generated_content_draft_id),
  CONSTRAINT board_reporting_candidate_members_br_02_ordinal_unique
    UNIQUE (board_reporting_candidate_id, ordinal)
);

CREATE INDEX ix_board_reporting_candidate_members_br_02_candidate_order
  ON kai.board_reporting_candidate_members (organization_id, board_reporting_candidate_id, ordinal);

CREATE INDEX ix_board_reporting_candidate_members_br_02_draft
  ON kai.board_reporting_candidate_members (organization_id, generated_content_draft_id);

CREATE TRIGGER trg_br_02_board_reporting_candidate_members_append_only
  BEFORE UPDATE OR DELETE ON kai.board_reporting_candidate_members
  FOR EACH ROW EXECUTE FUNCTION kai.br_02_reject_board_reporting_candidate_mutation();

COMMIT;
