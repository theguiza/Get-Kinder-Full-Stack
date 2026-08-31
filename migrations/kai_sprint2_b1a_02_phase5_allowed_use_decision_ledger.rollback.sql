BEGIN;

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_b1a_02_sensitivity_decision_metadata_check;

-- Remove only this package's own operation string from the shared allowlist, in place,
-- so operations added by other packages are preserved.
DO $$
DECLARE
  existing_definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO existing_definition
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

  IF existing_definition IS NOT NULL
     AND position('sensitivity_review_decision_recorded' IN existing_definition) > 0 THEN
    existing_definition := replace(
      existing_definition,
      ', ''sensitivity_review_decision_recorded''::text',
      ''
    );
    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check, ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check %s',
      existing_definition
    );
  END IF;
END $$;

DROP TRIGGER IF EXISTS intake_sensitivity_review_decisions_b1a_02_append_only ON kai.intake_sensitivity_review_decisions;
DROP FUNCTION IF EXISTS kai.b1a_02_reject_sensitivity_review_decision_mutation();

DROP TABLE IF EXISTS kai.intake_sensitivity_review_decisions;

ALTER TABLE IF EXISTS kai.intake_sensitivity_profiles
  DROP CONSTRAINT IF EXISTS intake_sensitivity_profiles_b1a_02_id_org_unique;

COMMIT;
