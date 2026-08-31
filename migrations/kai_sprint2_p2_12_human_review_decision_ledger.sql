BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before P2-12 human-review-decision-ledger migration';
  END IF;
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before P2-12 human-review-decision-ledger migration';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-12 human-review-decision-ledger migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-12 human-review-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-12 human-review-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'evidence_items'
       AND c.conname = 'evidence_items_p2_01_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.evidence_items_p2_01_id_org_unique is required before P2-12 human-review-decision-ledger migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'claims'
       AND c.conname = 'claims_p2_03_id_org_unique'
  ) THEN
    RAISE EXCEPTION 'kai.claims_p2_03_id_org_unique is required before P2-12 human-review-decision-ledger migration';
  END IF;
END $$;

-- P2-12 (Problem A1) owner policy: repair the broken P2-09 human-review
-- contract, which could only ever write ONE outcome
-- (support_strength/claim_strength = 'reviewed_supported'), accepted no
-- reviewer decision content, and let `queue_status/review_status = resolved`
-- alone stand in for "reviewed" with no persisted decision. This migration
-- introduces a real, immutable, append-only human-decision ledger for both
-- evidence-review and claim-review, binds it atomically to the existing
-- queue/domain-column transitions (see
-- Backend/kai/dictionary/postgresHumanReviewRepository.js), and widens the
-- vocabulary those domain columns admit so a negative/needs-more-information
-- decision is representable. Lineage follows the P3-17
-- (kai_sprint2_p3_17_human_authority_decision_ledger.sql) append-only ledger
-- pattern exactly: a backward pointer (supersedes_decision_id) written once,
-- at INSERT time, on the new row - never a forward pointer or an UPDATE of an
-- existing row - but these are two NEW tables, not a reuse or mutation of
-- kai.human_authority_decisions.
--
-- Deliberately NOT touched: claims.claim_status (still pinned to 'proposed'
-- only - P2-05's own conflict-candidate detection,
-- Backend/kai/dictionary/postgresConflictReviewCandidateRepository.js,
-- depends on it), and every audience-gate boolean
-- (internal_only/public_use_allowed/funder_use_allowed/export_ready/
-- llm_processing_allowed/product_learning_allowed) on both evidence_items and
-- claims - this package grants no funder/public/export authority whatsoever.

-- PostgreSQL CHECK constraints cannot contain a subquery directly; this
-- small IMMUTABLE helper lets the "no blank limitation note" rule be
-- expressed as a plain function call inside each table's CHECK below.
CREATE OR REPLACE FUNCTION kai.p2_12_all_array_entries_non_blank(entries text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM unnest(entries) e WHERE btrim(e) = '')
$$;

CREATE TABLE kai.evidence_review_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  evidence_item_id uuid NOT NULL,
  review_queue_item_id uuid NOT NULL,
  decision_outcome text NOT NULL,
  limitation_notes text[],
  decided_by uuid NOT NULL,
  decided_by_role text NOT NULL,
  target_updated_at timestamptz NOT NULL,
  supersedes_decision_id uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidence_review_decisions_p2_12_id_org_unique
    UNIQUE (decision_id, organization_id),
  CONSTRAINT evidence_review_decisions_p2_12_id_org_item_unique
    UNIQUE (decision_id, organization_id, evidence_item_id),
  CONSTRAINT evidence_review_decisions_p2_12_item_fk
    FOREIGN KEY (evidence_item_id, organization_id)
    REFERENCES kai.evidence_items (evidence_item_id, organization_id)
    ON DELETE RESTRICT,
  -- The predecessor referenced by supersedes_decision_id must already exist
  -- and must belong to the same organization and evidence item as the new
  -- row - lineage can never fork across evidence items.
  CONSTRAINT evidence_review_decisions_p2_12_supersedes_fk
    FOREIGN KEY (supersedes_decision_id, organization_id, evidence_item_id)
    REFERENCES kai.evidence_review_decisions (decision_id, organization_id, evidence_item_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_review_decisions_p2_12_not_self_superseding
    CHECK (supersedes_decision_id IS DISTINCT FROM decision_id),
  CONSTRAINT evidence_review_decisions_p2_12_outcome_check
    CHECK (decision_outcome IN ('supported', 'supported_with_limitation', 'not_supported', 'needs_more_information')),
  CONSTRAINT evidence_review_decisions_p2_12_limitation_notes_check
    CHECK (
      (
        decision_outcome = 'supported_with_limitation'
        AND limitation_notes IS NOT NULL
        AND cardinality(limitation_notes) > 0
        AND kai.p2_12_all_array_entries_non_blank(limitation_notes)
      )
      OR (decision_outcome <> 'supported_with_limitation' AND limitation_notes IS NULL)
    ),
  -- Human ownership: only gk_reviewer/gk_admin may ever decide an evidence
  -- review - never gk_operator, client actors, system, assistant, or import.
  CONSTRAINT evidence_review_decisions_p2_12_role_check
    CHECK (decided_by_role IN ('gk_reviewer', 'gk_admin')),
  CONSTRAINT evidence_review_decisions_p2_12_created_by_type_check
    CHECK (created_by_type = 'human')
);

-- At most one root (first) decision per (organization, evidence item)
-- lineage: a lineage is a single chain, never a forest.
CREATE UNIQUE INDEX ux_evidence_review_decisions_p2_12_root_per_lineage
  ON kai.evidence_review_decisions (organization_id, evidence_item_id)
  WHERE supersedes_decision_id IS NULL;

-- At most one direct successor per predecessor: two concurrent decisions
-- racing from the same current head can each attempt their own INSERT, but
-- only one can ever commit.
CREATE UNIQUE INDEX ux_evidence_review_decisions_p2_12_single_successor
  ON kai.evidence_review_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE INDEX ix_evidence_review_decisions_p2_12_tenant_item
  ON kai.evidence_review_decisions (organization_id, evidence_item_id);

CREATE OR REPLACE FUNCTION kai.p2_12_reject_evidence_review_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P2-12 evidence-review-decision-ledger history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER evidence_review_decisions_p2_12_append_only
  BEFORE UPDATE OR DELETE ON kai.evidence_review_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.p2_12_reject_evidence_review_decision_mutation();

CREATE TABLE kai.claim_review_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  review_queue_item_id uuid NOT NULL,
  decision_outcome text NOT NULL,
  limitation_notes text[],
  approved_audiences text[],
  decided_by uuid NOT NULL,
  decided_by_role text NOT NULL,
  target_updated_at timestamptz NOT NULL,
  supersedes_decision_id uuid,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT claim_review_decisions_p2_12_id_org_unique
    UNIQUE (decision_id, organization_id),
  CONSTRAINT claim_review_decisions_p2_12_id_org_claim_unique
    UNIQUE (decision_id, organization_id, claim_id),
  CONSTRAINT claim_review_decisions_p2_12_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT claim_review_decisions_p2_12_supersedes_fk
    FOREIGN KEY (supersedes_decision_id, organization_id, claim_id)
    REFERENCES kai.claim_review_decisions (decision_id, organization_id, claim_id)
    ON DELETE RESTRICT,
  CONSTRAINT claim_review_decisions_p2_12_not_self_superseding
    CHECK (supersedes_decision_id IS DISTINCT FROM decision_id),
  CONSTRAINT claim_review_decisions_p2_12_outcome_check
    CHECK (decision_outcome IN ('approved', 'approved_with_limitation', 'rejected', 'needs_more_information')),
  CONSTRAINT claim_review_decisions_p2_12_limitation_notes_check
    CHECK (
      (
        decision_outcome = 'approved_with_limitation'
        AND limitation_notes IS NOT NULL
        AND cardinality(limitation_notes) > 0
        AND kai.p2_12_all_array_entries_non_blank(limitation_notes)
      )
      OR (decision_outcome <> 'approved_with_limitation' AND limitation_notes IS NULL)
    ),
  -- Governance ceiling (Problem B is NOT opened by this package): the ledger
  -- itself only records which audiences the reviewer intended to approve, in
  -- whatever vocabulary it admits - it does not by itself grant funder/public
  -- use. The service layer (Backend/kai/services/kaiHumanReviewService.js)
  -- independently fails closed before ever reaching this INSERT if funder/
  -- public is requested while the bound claim/evidence-item's own
  -- funder_use_allowed/public_use_allowed booleans are not both true - which,
  -- given those booleans are still hard-pinned to false everywhere in this
  -- schema, means only 'internal' can ever legitimately be persisted here
  -- today. This CHECK is the ledger's own defense-in-depth scoping of the
  -- vocabulary, not the governance gate itself.
  CONSTRAINT claim_review_decisions_p2_12_audience_scope_check
    CHECK (
      (
        decision_outcome IN ('approved', 'approved_with_limitation')
        AND approved_audiences IS NOT NULL
        AND cardinality(approved_audiences) > 0
        AND approved_audiences <@ ARRAY['internal', 'funder', 'public']::text[]
      )
      OR (decision_outcome NOT IN ('approved', 'approved_with_limitation') AND approved_audiences IS NULL)
    ),
  CONSTRAINT claim_review_decisions_p2_12_role_check
    CHECK (decided_by_role IN ('gk_reviewer', 'gk_admin')),
  CONSTRAINT claim_review_decisions_p2_12_created_by_type_check
    CHECK (created_by_type = 'human')
);

CREATE UNIQUE INDEX ux_claim_review_decisions_p2_12_root_per_lineage
  ON kai.claim_review_decisions (organization_id, claim_id)
  WHERE supersedes_decision_id IS NULL;

CREATE UNIQUE INDEX ux_claim_review_decisions_p2_12_single_successor
  ON kai.claim_review_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;

CREATE INDEX ix_claim_review_decisions_p2_12_tenant_claim
  ON kai.claim_review_decisions (organization_id, claim_id);

CREATE OR REPLACE FUNCTION kai.p2_12_reject_claim_review_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P2-12 claim-review-decision-ledger history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER claim_review_decisions_p2_12_append_only
  BEFORE UPDATE OR DELETE ON kai.claim_review_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.p2_12_reject_claim_review_decision_mutation();

-- Widen the two review-status CHECKs (P2-06's evidence_review_unresolved/
-- claim_review_unresolved blockers are, and remain, driven by the linked
-- kai.review_queue_items row's own review_status - this widening lets the
-- evidence_items/claims columns themselves also carry the resolved
-- ('reviewed') fact for anyone reading these tables directly) and the two
-- strength CHECKs (adding the negative terminal outcome
-- 'reviewed_not_supported', so a not_supported/rejected decision is
-- representable and remains permanently ineligible - never widened to imply
-- support).
ALTER TABLE kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_review_status_check,
  ADD CONSTRAINT evidence_items_p2_01_review_status_check
    CHECK (evidence_review_status IN ('needs_gk_review', 'reviewed'));

ALTER TABLE kai.claims
  DROP CONSTRAINT IF EXISTS claims_p2_03_claim_review_status_check,
  ADD CONSTRAINT claims_p2_03_claim_review_status_check
    CHECK (claim_review_status IN ('needs_gk_review', 'reviewed'));

ALTER TABLE kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_support_strength_check,
  ADD CONSTRAINT evidence_items_p2_01_support_strength_check
    CHECK (support_strength IN ('unassessed', 'reviewed_supported', 'reviewed_not_supported'));

ALTER TABLE kai.claims
  DROP CONSTRAINT IF EXISTS claims_p2_03_claim_strength_check,
  ADD CONSTRAINT claims_p2_03_claim_strength_check
    CHECK (claim_strength IN ('unassessed', 'reviewed_supported', 'reviewed_not_supported'));

-- Additive-only: every previously-required audit-metadata key stays required;
-- these two ALTERs only add new required keys carrying the ledger decision
-- identity onto the SAME two existing operation values (no new operation
-- string is introduced, so the shared upload_lifecycle_audit_gate_a_operation_check
-- allowlist is untouched).
ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check
    CHECK (
      operation <> 'evidence_review_completed'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'evidence_item_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'previous_support_strength'
        AND metadata ? 'resulting_support_strength'
        AND metadata ? 'validator_key'
        AND metadata ? 'decision_id'
        AND metadata ? 'decision_outcome'
        AND metadata ? 'previous_evidence_review_status'
        AND metadata ? 'resulting_evidence_review_status'
      )
    );

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_claim_review_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p2_09_claim_review_metadata_object_check
    CHECK (
      operation <> 'claim_review_completed_internal_approval'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'claim_id'
        AND metadata ? 'evidence_item_id'
        AND metadata ? 'review_queue_item_id'
        AND metadata ? 'previous_queue_status'
        AND metadata ? 'resulting_queue_status'
        AND metadata ? 'previous_review_status'
        AND metadata ? 'resulting_review_status'
        AND metadata ? 'previous_claim_strength'
        AND metadata ? 'resulting_claim_strength'
        AND metadata ? 'validator_key'
        AND metadata ? 'decision_id'
        AND metadata ? 'decision_outcome'
        AND metadata ? 'approved_audiences'
        AND metadata ? 'previous_claim_review_status'
        AND metadata ? 'resulting_claim_review_status'
      )
    );

COMMIT;
