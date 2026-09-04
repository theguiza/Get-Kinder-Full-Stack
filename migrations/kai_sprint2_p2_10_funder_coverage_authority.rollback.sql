BEGIN;

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

DO $$
DECLARE
  old_expr text;
  retained_ops text[];
  new_expr text;
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
    RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check is required before P2-10 funder coverage-authority rollback';
  END IF;

  SELECT array_agg(DISTINCT op ORDER BY op)
    INTO retained_ops
    FROM (
      SELECT match[1] AS op
        FROM regexp_matches(old_expr, '''([^'']+)''', 'g') AS match
    ) parsed
   WHERE op <> 'coverage_review_decision_accepted_funder_with_limitation';

  new_expr := format('operation = ANY (ARRAY[%s]::text[])', (
    SELECT string_agg(quote_literal(op), ', ' ORDER BY op)
      FROM unnest(retained_ops) AS op
  ));

  EXECUTE format(
    'ALTER TABLE kai.upload_lifecycle_audit DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check, ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check CHECK (%s)',
    new_expr
  );
END $$;

ALTER TABLE kai.coverage_review_decisions
  DROP CONSTRAINT IF EXISTS coverage_review_decisions_p2_10_identity_fingerprint_unique,
  ADD CONSTRAINT coverage_review_decisions_p2_10_identity_fingerprint_unique
    UNIQUE (organization_id, claim_id, dimension_key, state_fingerprint);

ALTER TABLE kai.coverage_review_decisions
  DROP CONSTRAINT IF EXISTS coverage_review_decisions_p2_10_decision_check,
  ADD CONSTRAINT coverage_review_decisions_p2_10_decision_check
    CHECK (decision = 'accepted_internal_with_limitation');

COMMIT;
