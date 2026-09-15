BEGIN;

DO $$
BEGIN
  IF to_regclass('kai.coverage_review_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.coverage_review_decisions is required before P2-10 public coverage-authority extension';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-10 public coverage-authority extension';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
       AND r.relname = 'coverage_review_decisions'
       AND c.conname = 'coverage_review_decisions_p2_10_identity_fingerprint_unique'
       AND pg_get_constraintdef(c.oid) LIKE '%organization_id, claim_id, dimension_key, state_fingerprint, decision%'
  ) THEN
    RAISE EXCEPTION 'kai_sprint2_p2_10_funder_coverage_authority.sql is required before P2-10 public coverage-authority extension';
  END IF;
END $$;

-- P2-10 coverage authority remains an append-only, per-current-fingerprint
-- human decision ledger. Authority scope is encoded by the decision value
-- itself: historical accepted_internal_with_limitation and
-- accepted_funder_with_limitation rows retain their own semantics, while
-- accepted_public_with_limitation is the explicit public-use sibling. No
-- audience column is added, avoiding contradictory double-encoding. The
-- (organization_id, claim_id, dimension_key, state_fingerprint, decision)
-- identity-fingerprint uniqueness added by the funder extension already
-- covers this third decision value without further change.
ALTER TABLE kai.coverage_review_decisions
  DROP CONSTRAINT IF EXISTS coverage_review_decisions_p2_10_decision_check,
  ADD CONSTRAINT coverage_review_decisions_p2_10_decision_check
    CHECK (decision IN (
      'accepted_internal_with_limitation',
      'accepted_funder_with_limitation',
      'accepted_public_with_limitation'
    ));

DO $$
DECLARE
  old_expr text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO old_expr
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

  IF old_expr IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check is required before P2-10 public coverage-authority extension';
  END IF;

  IF position('coverage_review_decision_accepted_public_with_limitation' IN old_expr) = 0 THEN
    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check, ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check CHECK ((%s) OR operation = %L)',
      old_expr,
      'coverage_review_decision_accepted_public_with_limitation'
    );
  END IF;
END $$;

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check,
  ADD CONSTRAINT upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check
    CHECK (
      operation NOT IN (
        'coverage_review_decision_accepted_internal_with_limitation',
        'coverage_review_decision_accepted_funder_with_limitation',
        'coverage_review_decision_accepted_public_with_limitation'
      )
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
