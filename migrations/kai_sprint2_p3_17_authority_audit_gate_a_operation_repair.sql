BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
  ) THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check is required before the P3-17 authority audit-operation repair';
  END IF;
  IF to_regclass('kai.human_authority_decisions') IS NULL THEN
    RAISE EXCEPTION 'kai.human_authority_decisions is required before the P3-17 authority audit-operation repair';
  END IF;
END $$;

-- P3-17 (kai_sprint2_p3_17_human_authority_decision_ledger.sql) shipped
-- kai.human_authority_decisions and postgresHumanAuthorityDecisionRepository's
-- recordDecision, which writes an upload_lifecycle_audit row with
-- operation = 'human_authority_decision_recorded' - but that migration never
-- extended the shared upload_lifecycle_audit operation allowlist to admit it.
-- Every real recordDecision write therefore fails at the database boundary
-- with SQLSTATE 23514 against upload_lifecycle_audit_gate_a_operation_check.
-- This is a corrective, additive-only repair, following the same two-phase
-- (NOT VALID / VALIDATE) pattern kai_sprint2_p2_09_p2_10_p2_11_forward_reconciliation.sql
-- already used to extend this exact constraint: it widens the existing
-- allowlist by exactly one value and changes nothing else already accepted.
DO $$
DECLARE
  existing_predicate text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

  IF position('export_candidate_created' IN existing_predicate) = 0 THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check must already admit export_candidate_created (P3-16) before the P3-17 authority audit-operation repair';
  END IF;

  IF position('human_authority_decision_recorded' IN existing_predicate) = 0 THEN
    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon CHECK ((%s) OR operation = ''human_authority_decision_recorded'') NOT VALID',
      existing_predicate
    );
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon
      TO upload_lifecycle_audit_gate_a_operation_check;
  END IF;
END $$;

COMMIT;
