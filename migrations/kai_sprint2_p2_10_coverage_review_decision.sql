BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before P2-10 coverage-review-decision migration';
  END IF;
  IF to_regclass('kai.gap_log_items') IS NULL THEN
    RAISE EXCEPTION 'kai.gap_log_items is required before P2-10 coverage-review-decision migration';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-10 coverage-review-decision migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-10 coverage-review-decision migration';
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
    RAISE EXCEPTION 'kai.claims_p2_03_id_org_unique is required before P2-10 coverage-review-decision migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'gap_log_items'
       AND c.conname = 'gap_log_items_p2_04_identity_unique'
  ) THEN
    RAISE EXCEPTION 'kai.gap_log_items_p2_04_identity_unique is required before P2-10 coverage-review-decision migration';
  END IF;
END $$;

-- P2-10 owner policy: a GK reviewer may record `accepted_internal_with_limitation`
-- for one CURRENT unresolved P2-02 coverage dimension on one CURRENT claim.
-- This never changes the automated P2-02 assessment, never means
-- resolved_clear, never waives resolved_risk_flagged, never resolves a
-- client_followup or a P2-05 conflict, and never grants funder/public/export
-- authority - it may affect INTERNAL eligibility only. Lineage follows the
-- P3-17 append-only ledger precedent: every row is an INSERT, never an
-- UPDATE, and the append-only trigger below rejects any UPDATE/DELETE outright.
--
-- state_fingerprint binds the decision to the CURRENT authoritative claim/
-- evidence/dimension/gap state exactly as P2-06's own
-- evaluateClaimTraceabilityInTransaction (and no second implementation)
-- computes it - see
-- Backend/kai/validators/kaiCoverageReviewDecisionValidators.js
-- computeCoverageReviewDecisionFingerprint. If any bound fact changes, the
-- recomputed fingerprint at read time no longer matches this row, and the
-- decision silently stops applying: this is the entire staleness mechanism,
-- so no separate expiry/superseding column is required. The composite FK to
-- kai.gap_log_items additionally enforces, at the database level, that a
-- P2-04 gap row already exists for the exact (organization, claim,
-- dimension) this decision targets.
CREATE TABLE kai.coverage_review_decisions (
  coverage_review_decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  dimension_key text NOT NULL,
  decision text NOT NULL DEFAULT 'accepted_internal_with_limitation',
  state_fingerprint text NOT NULL,
  decided_by uuid NOT NULL,
  decided_by_role text NOT NULL,
  created_by_type text NOT NULL DEFAULT 'human',
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT coverage_review_decisions_p2_10_id_org_unique
    UNIQUE (coverage_review_decision_id, organization_id),
  -- Idempotent-replay identity: a second INSERT under the identical current
  -- state (identical recomputed fingerprint) hits this constraint and is
  -- treated as a replay (ON CONFLICT DO NOTHING, reread) rather than a
  -- duplicate authority row. A materially different state produces a
  -- different fingerprint and is free to insert its own new row.
  CONSTRAINT coverage_review_decisions_p2_10_identity_fingerprint_unique
    UNIQUE (organization_id, claim_id, dimension_key, state_fingerprint),
  CONSTRAINT coverage_review_decisions_p2_10_claim_fk
    FOREIGN KEY (claim_id, organization_id)
    REFERENCES kai.claims (claim_id, organization_id)
    ON DELETE RESTRICT,
  CONSTRAINT coverage_review_decisions_p2_10_gap_fk
    FOREIGN KEY (organization_id, claim_id, dimension_key)
    REFERENCES kai.gap_log_items (organization_id, claim_id, dimension_key)
    ON DELETE RESTRICT,
  CONSTRAINT coverage_review_decisions_p2_10_dimension_key_check
    CHECK (dimension_key IN (
      'missingness',
      'duplicates',
      'definition_clarity',
      'denominator_clarity',
      'time_period_clarity',
      'entity_level_clarity',
      'small_cell_risk',
      'conflicting_source_indicators',
      'requirement_alignment',
      'coverage_gaps'
    )),
  CONSTRAINT coverage_review_decisions_p2_10_decision_check
    CHECK (decision = 'accepted_internal_with_limitation'),
  CONSTRAINT coverage_review_decisions_p2_10_state_fingerprint_check
    CHECK (state_fingerprint ~ '^[0-9a-f]{64}$'),
  -- Owner policy: only gk_reviewer may ever be the decided_by_role for this
  -- decision type - never gk_operator, gk_admin, client actors, system,
  -- assistant, import, or code actors.
  CONSTRAINT coverage_review_decisions_p2_10_decided_by_role_check
    CHECK (decided_by_role = 'gk_reviewer'),
  CONSTRAINT coverage_review_decisions_p2_10_created_by_type_check
    CHECK (created_by_type = 'human')
);

CREATE INDEX ix_coverage_review_decisions_p2_10_tenant_claim
  ON kai.coverage_review_decisions (organization_id, claim_id);

CREATE OR REPLACE FUNCTION kai.p2_10_reject_coverage_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'P2-10 coverage-review-decision history is append-only: % of %.% is not permitted', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER trg_p2_10_coverage_review_decisions_append_only
  BEFORE UPDATE OR DELETE ON kai.coverage_review_decisions
  FOR EACH ROW EXECUTE FUNCTION kai.p2_10_reject_coverage_decision_mutation();

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
      'evidence_review_completed',
      'claim_review_completed_internal_approval',
      'coverage_review_decision_accepted_internal_with_limitation'
    ));

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check
    CHECK (
      operation <> 'coverage_review_decision_accepted_internal_with_limitation'
      OR (
        jsonb_typeof(metadata) = 'object'
        AND kai.gate_a_p0_jsonb_metadata_only(metadata)
        AND metadata ? 'metadata_only'
        AND metadata ? 'contract'
        AND metadata ? 'claim_id'
        AND metadata ? 'dimension_key'
        AND metadata ? 'decision'
        AND metadata ? 'decided_by_role'
        AND metadata ? 'state_fingerprint'
        AND metadata ? 'replayed'
        AND metadata ? 'validator_key'
        AND NOT metadata ? 'rationale'
        AND NOT metadata ? 'question_text'
        AND NOT metadata ? 'safe_summary'
      )
    );

COMMIT;
