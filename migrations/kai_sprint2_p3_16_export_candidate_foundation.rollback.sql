BEGIN;

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_16_export_candidate_metadata_check;

ALTER TABLE IF EXISTS kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p3_16_limitation_snapshot_metadata_check;

DELETE FROM kai.upload_lifecycle_audit
 WHERE operation IN ('limitation_snapshot_confirmed', 'export_candidate_created');

-- Reverse the repaired forward migration's monotonic predecessor-extension:
-- it added "... OR operation IN ('limitation_snapshot_confirmed',
-- 'export_candidate_created')" as the outermost disjunct of whatever the
-- predecessor predicate was. Strip that trailing disjunct with a tolerant,
-- anchored pattern instead of reconstructing from a static historical
-- allowlist, but still fail closed if the current predicate does not have
-- the expected shape. Mirrors the mechanism
-- kai_sprint2_p3_13_export_review_completion.rollback.sql established for
-- this exact constraint.
DO $p3_16_rollback$
DECLARE
  existing_predicate text;
  restored_predicate text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO existing_predicate
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check'
     AND c.convalidated;

  IF existing_predicate IS NULL THEN
    RAISE EXCEPTION 'validated kai.upload_lifecycle_audit_gate_a_operation_check is required before the P3-16 export-candidate-foundation rollback';
  END IF;

  IF position('limitation_snapshot_confirmed' IN existing_predicate) = 0
     AND position('export_candidate_created' IN existing_predicate) = 0 THEN
    -- Already rolled back (or never applied by the repaired forward shape); nothing to reverse.
    NULL;
  ELSE
    restored_predicate := regexp_replace(
      existing_predicate,
      '\s*OR\s*\(operation\s*=\s*ANY\s*\(ARRAY\[''limitation_snapshot_confirmed''(::text)?,\s*''export_candidate_created''(::text)?\]\)\)(?=\)*\s*$)',
      ''
    );

    IF restored_predicate = existing_predicate
       OR restored_predicate = ''
       OR position('limitation_snapshot_confirmed' IN restored_predicate) <> 0
       OR position('export_candidate_created' IN restored_predicate) <> 0
    THEN
      RAISE EXCEPTION 'kai.upload_lifecycle_audit_gate_a_operation_check does not have the expected P3-16 monotonic-extension shape; refusing the P3-16 export-candidate-foundation rollback';
    END IF;

    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_16_rollback CHECK (%s) NOT VALID',
      restored_predicate
    );
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_16_rollback;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_p3_16_rollback
      TO upload_lifecycle_audit_gate_a_operation_check;
  END IF;
END $p3_16_rollback$;

DROP TABLE IF EXISTS kai.export_candidates;
DROP TRIGGER IF EXISTS trg_p3_16_limitation_snapshot_entries_append_only ON kai.limitation_snapshot_entries;
DROP TABLE IF EXISTS kai.limitation_snapshot_entries;
DROP TRIGGER IF EXISTS trg_p3_16_limitation_snapshots_append_only ON kai.limitation_snapshots;
DROP INDEX IF EXISTS kai.ux_limitation_snapshots_p3_16_single_successor;
DROP INDEX IF EXISTS kai.ux_limitation_snapshots_p3_16_root_per_draft;
DROP TABLE IF EXISTS kai.limitation_snapshots;
DROP FUNCTION IF EXISTS kai.p3_16_reject_authority_mutation();
DROP FUNCTION IF EXISTS kai.p3_16_limitation_codes_valid(text[]);

COMMIT;
