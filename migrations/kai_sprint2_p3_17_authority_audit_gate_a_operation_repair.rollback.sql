BEGIN;

-- Restores the exact pre-repair upload_lifecycle_audit_gate_a_operation_check
-- vocabulary by removing exactly the one operation this repair added
-- ('human_authority_decision_recorded'), leaving every other accepted
-- operation untouched. Ops are extracted from the live predicate's string
-- literals and rebuilt rather than pattern-matched against Postgres's
-- deparsed paren/cast shape, which is not a stable string to match against.
DO $$
DECLARE
  existing_predicate text;
  restored_ops text[];
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

  IF existing_predicate IS NULL THEN
    RETURN;
  END IF;

  IF position('human_authority_decision_recorded' IN existing_predicate) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1])
    INTO restored_ops
    FROM regexp_matches(existing_predicate, '''([^'']+)''::text', 'g') AS m
   WHERE m[1] <> 'human_authority_decision_recorded';

  IF restored_ops IS NULL OR cardinality(restored_ops) = 0 THEN
    RAISE EXCEPTION 'could not extract a restored operation vocabulary from %', existing_predicate;
  END IF;

  EXECUTE format(
    'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_rb CHECK (operation = ANY (%L::text[])) NOT VALID',
    restored_ops
  );
  ALTER TABLE kai.upload_lifecycle_audit
    VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_rb;
  ALTER TABLE kai.upload_lifecycle_audit
    DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
  ALTER TABLE kai.upload_lifecycle_audit
    RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_rb
    TO upload_lifecycle_audit_gate_a_operation_check;
END $$;

COMMIT;
