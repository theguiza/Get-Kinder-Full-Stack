BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF to_regclass('kai.generated_content_drafts') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_drafts is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF to_regclass('kai.generated_content_blocks') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_blocks is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF to_regclass('kai.generated_content_citations') IS NULL THEN
    RAISE EXCEPTION 'kai.generated_content_citations is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'kai'
      AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'review_queue_items_p3_04_generated_content_review_contract_check'
  ) THEN
    RAISE EXCEPTION 'P3-04 generated-content-review contract check is required before P3-16 export-candidate-foundation migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'review_queue_items_p3_13_export_review_contract_check'
  ) THEN
    RAISE EXCEPTION 'P3-13 export-review contract check is required before P3-16 export-candidate-foundation migration';
  END IF;
END $$;

-- P3-16 owner decision (OWNER_DECISION.P3_EXPORT_CANDIDATE_V1 /
-- OWNER_DECISION.P3_EXPORT_LIMITATION_SNAPSHOT_V1): this migration adds exactly
-- two new authoritative, additive, append-only foundations - human-confirmed
-- limitation snapshots and export-candidate identities - on top of the
-- existing immutable generated-content draft/citation graph and the existing
-- generated-content-review / export-review queue lifecycles. It changes no
-- existing table, column, constraint, or lifecycle established by P3-01
-- through P3-15, creates no client_reviewed / funder_ready / public_ready /
-- export_authority_granted / finalGate state, and does not set
-- draft_status or exportEligible anywhere.

CREATE OR REPLACE FUNCTION kai.p3_16_limitation_codes_valid(codes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT codes IS NOT NULL
     AND cardinality(codes) <= 32
     AND NOT EXISTS (SELECT 1 FROM unnest(codes) AS c WHERE c !~ '^[a-z][a-z0-9_.:-]{0,95}$')
     AND (SELECT count(*) FROM unnest(codes) AS c) = (SELECT count(DISTINCT c) FROM unnest(codes) AS c)
$$;

-- P3-16 correction (append-only authority): limitation-snapshot lineage is
-- recorded as a backward pointer on the NEW row (supersedes_snapshot_id),
-- never as a forward pointer written onto the prior row. A supersession is
-- therefore always exactly one INSERT and never an UPDATE of any existing
-- snapshot or entry. The prior row's own columns - including its own
-- supersedes_snapshot_id - are never touched again after insert.
CREATE TABLE IF NOT EXISTS kai.limitation_snapshots (
  limitation_snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  generated_content_draft_id uuid NOT NULL,
  confirmed_by uuid NOT NULL,
  confirmed_by_role text NOT NULL,
  entries_fingerprint text NOT NULL,
  supersedes_snapshot_id uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT limitation_snapshots_p3_16_id_org_unique
    UNIQUE (limitation_snapshot_id, organization_id),
  CONSTRAINT limitation_snapshots_p3_16_id_org_draft_unique
    UNIQUE (limitation_snapshot_id, organization_id, generated_content_draft_id),
  CONSTRAINT limitation_snapshots_p3_16_draft_fk
    FOREIGN KEY (generated_content_draft_id, organization_id)
    REFERENCES kai.generated_content_drafts (generated_content_draft_id, organization_id)
    ON DELETE RESTRICT,
  -- The predecessor referenced by supersedes_snapshot_id must already exist
  -- (ordinary, non-deferred FK) and must belong to the same organization and
  -- the same generated-content draft as the new row - lineage can never
  -- cross tenant or draft (and therefore never crosses requested audience,
  -- which is fixed per draft).
  CONSTRAINT limitation_snapshots_p3_16_supersedes_fk
    FOREIGN KEY (supersedes_snapshot_id, organization_id, generated_content_draft_id)
    REFERENCES kai.limitation_snapshots (limitation_snapshot_id, organization_id, generated_content_draft_id)
    ON DELETE RESTRICT,
  CONSTRAINT limitation_snapshots_p3_16_not_self_superseding
    CHECK (supersedes_snapshot_id IS DISTINCT FROM limitation_snapshot_id),
  CONSTRAINT limitation_snapshots_p3_16_confirmed_by_role_check
    CHECK (confirmed_by_role IN ('gk_reviewer', 'gk_admin')),
  CONSTRAINT limitation_snapshots_p3_16_entries_fingerprint_check
    CHECK (entries_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT limitation_snapshots_p3_16_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- At most one root (first) snapshot per draft: a draft's lineage is a single
-- chain, never a forest.
CREATE UNIQUE INDEX IF NOT EXISTS ux_limitation_snapshots_p3_16_root_per_draft
  ON kai.limitation_snapshots (organization_id, generated_content_draft_id)
  WHERE supersedes_snapshot_id IS NULL;

-- At most one direct successor per predecessor: two concurrent changed
-- confirmations racing from the same current snapshot can insert their own
-- rows independently, but only one INSERT with a given supersedes_snapshot_id
-- can ever commit - the loser receives a unique_violation and zero rows are
-- written or rewritten for it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_limitation_snapshots_p3_16_single_successor
  ON kai.limitation_snapshots (supersedes_snapshot_id)
  WHERE supersedes_snapshot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION kai.p3_16_reject_authority_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P3-16 limitation-snapshot authority history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_p3_16_limitation_snapshots_append_only
  BEFORE UPDATE OR DELETE ON kai.limitation_snapshots
  FOR EACH ROW EXECUTE FUNCTION kai.p3_16_reject_authority_mutation();

CREATE TABLE IF NOT EXISTS kai.limitation_snapshot_entries (
  limitation_snapshot_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  limitation_snapshot_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  limitation_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT limitation_snapshot_entries_p3_16_identity_unique
    UNIQUE (limitation_snapshot_id, claim_id, evidence_item_id),
  CONSTRAINT limitation_snapshot_entries_p3_16_snapshot_fk
    FOREIGN KEY (limitation_snapshot_id, organization_id)
    REFERENCES kai.limitation_snapshots (limitation_snapshot_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT limitation_snapshot_entries_p3_16_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT limitation_snapshot_entries_p3_16_evidence_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT limitation_snapshot_entries_p3_16_codes_check
    CHECK (kai.p3_16_limitation_codes_valid(limitation_codes))
);

CREATE TRIGGER trg_p3_16_limitation_snapshot_entries_append_only
  BEFORE UPDATE OR DELETE ON kai.limitation_snapshot_entries
  FOR EACH ROW EXECUTE FUNCTION kai.p3_16_reject_authority_mutation();

CREATE TABLE IF NOT EXISTS kai.export_candidates (
  export_candidate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  generated_content_draft_id uuid NOT NULL,
  content_type text NOT NULL,
  requested_audience text NOT NULL,
  limitation_snapshot_id uuid NOT NULL,
  fingerprint_contract_version text NOT NULL,
  canonical_fingerprint text NOT NULL,
  created_by uuid NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT export_candidates_p3_16_id_org_unique
    UNIQUE (export_candidate_id, organization_id),
  CONSTRAINT export_candidates_p3_16_replay_convergence_unique
    UNIQUE (organization_id, generated_content_draft_id, requested_audience, canonical_fingerprint),
  CONSTRAINT export_candidates_p3_16_draft_fk
    FOREIGN KEY (generated_content_draft_id, organization_id)
    REFERENCES kai.generated_content_drafts (generated_content_draft_id, organization_id)
    ON DELETE RESTRICT,
  -- The bound snapshot must belong to this same organization and draft, so
  -- currentness (whether an authoritative successor exists for that exact
  -- snapshot) can be evaluated without any cross-draft ambiguity.
  CONSTRAINT export_candidates_p3_16_snapshot_fk
    FOREIGN KEY (limitation_snapshot_id, organization_id, generated_content_draft_id)
    REFERENCES kai.limitation_snapshots (limitation_snapshot_id, organization_id, generated_content_draft_id)
    ON DELETE RESTRICT,
  CONSTRAINT export_candidates_p3_16_content_type_check
    CHECK (content_type = 'evidence_summary'),
  CONSTRAINT export_candidates_p3_16_requested_audience_check
    CHECK (requested_audience IN ('internal', 'funder', 'public')),
  CONSTRAINT export_candidates_p3_16_fingerprint_contract_version_check
    CHECK (fingerprint_contract_version = 'kai-sprint2-p3-16-export-candidate-fingerprint-v1'),
  CONSTRAINT export_candidates_p3_16_canonical_fingerprint_check
    CHECK (canonical_fingerprint ~ '^[a-f0-9]{64}$'),
  CONSTRAINT export_candidates_p3_16_created_by_type_check
    CHECK (created_by_type = 'human')
);

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_gate_a_operation_check,
  ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check
    CHECK (operation IN (
      'reserve_upload',
      'start_upload',
      'complete_object_version',
      'confirm_upload',
      'block_upload',
      'abandon_upload',
      'expire_upload',
      'policy_decision_compare_and_set',
      'parser_run_recorded',
      'file_profile_persisted',
      'data_dictionary_draft_persisted',
      'intake_sensitivity_profile_persisted',
      'sensitivity_review_queue_item_created',
      'intake_source_candidate_persisted',
      'source_promotion_decision_persisted',
      'evidence_lineage_extracted',
      'claim_proposed',
      'claim_gap_and_followup_generated',
      'conflict_review_candidate_created',
      'generated_content_draft_created',
      'generated_content_review_completed',
      'export_review_requested',
      'export_review_started',
      'export_review_completed',
      'limitation_snapshot_confirmed',
      'export_candidate_created'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_16_limitation_snapshot_metadata_check,
  ADD CONSTRAINT upload_lifecycle_audit_p3_16_limitation_snapshot_metadata_check
    CHECK (
      operation <> 'limitation_snapshot_confirmed'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'contract'
        AND metadata ? 'organization_id'
        AND metadata ? 'generated_content_draft_id'
        AND metadata ? 'limitation_snapshot_id'
        AND metadata ? 'superseded_snapshot_id'
        AND metadata ? 'actor_id'
        AND metadata ? 'actor_type'
        AND metadata ? 'confirmed_by_role'
        AND metadata ? 'cited_pair_count'
        AND metadata ? 'entries_fingerprint'
        AND metadata ? 'confirmation_timestamp'
        AND NOT metadata ? 'limitation_codes'
        AND NOT metadata ? 'draft_text'
        AND NOT metadata ? 'claim_text'
        AND NOT metadata ? 'claim_statement'
        AND NOT metadata ? 'evidence_text'
        AND NOT metadata ? 'block_text'
        AND NOT metadata ? 'citations'
        AND NOT metadata ? 'credential'
        AND NOT metadata ? 'approval'
        AND NOT metadata ? 'export_authority'
        AND NOT metadata ? 'affirmative_human_export_authority'
        AND NOT metadata ? 'final_export_gate'
        AND NOT metadata ? 'final_gate'
        AND NOT metadata ? 'export_eligible'
        AND NOT metadata ? 'manifest'
        AND metadata - ARRAY[
          'contract',
          'organization_id',
          'generated_content_draft_id',
          'limitation_snapshot_id',
          'superseded_snapshot_id',
          'actor_id',
          'actor_type',
          'confirmed_by_role',
          'cited_pair_count',
          'entries_fingerprint',
          'confirmation_timestamp'
        ] = '{}'::jsonb
      )
    );

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_16_export_candidate_metadata_check,
  ADD CONSTRAINT upload_lifecycle_audit_p3_16_export_candidate_metadata_check
    CHECK (
      operation <> 'export_candidate_created'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'contract'
        AND metadata ? 'organization_id'
        AND metadata ? 'generated_content_draft_id'
        AND metadata ? 'export_candidate_id'
        AND metadata ? 'requested_audience'
        AND metadata ? 'limitation_snapshot_id'
        AND metadata ? 'fingerprint_contract_version'
        AND metadata ? 'canonical_fingerprint'
        AND metadata ? 'actor_id'
        AND metadata ? 'actor_type'
        AND metadata ? 'cited_pair_count'
        AND metadata ? 'block_count'
        AND metadata ? 'creation_timestamp'
        AND NOT metadata ? 'draft_text'
        AND NOT metadata ? 'claim_text'
        AND NOT metadata ? 'claim_statement'
        AND NOT metadata ? 'evidence_text'
        AND NOT metadata ? 'block_text'
        AND NOT metadata ? 'citations'
        AND NOT metadata ? 'limitation_codes'
        AND NOT metadata ? 'credential'
        AND NOT metadata ? 'approval'
        AND NOT metadata ? 'export_authority'
        AND NOT metadata ? 'affirmative_human_export_authority'
        AND NOT metadata ? 'final_export_gate'
        AND NOT metadata ? 'final_gate'
        AND NOT metadata ? 'export_eligible'
        AND NOT metadata ? 'manifest'
        AND metadata - ARRAY[
          'contract',
          'organization_id',
          'generated_content_draft_id',
          'export_candidate_id',
          'requested_audience',
          'limitation_snapshot_id',
          'fingerprint_contract_version',
          'canonical_fingerprint',
          'actor_id',
          'actor_type',
          'cited_pair_count',
          'block_count',
          'creation_timestamp'
        ] = '{}'::jsonb
      )
    );

COMMIT;
