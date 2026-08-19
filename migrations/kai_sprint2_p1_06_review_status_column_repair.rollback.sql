BEGIN;

-- Fail-closed rollback for kai_sprint2_p1_06_review_status_column_repair.sql.
-- Restores review_status to kai.review_status_enum ONLY when every current
-- row is losslessly representable in that enum. It never rewrites, deletes,
-- or downgrades a 'resolved' row, and it never widens the shared enum to make
-- itself succeed: if any legitimate row is 'resolved' while the enum still
-- lacks that label, this rollback refuses and performs no mutation.
--
-- Fail-fast locking: refuse rather than wait indefinitely for the DDL lock
-- if a concurrent session already holds one on this table.
LOCK TABLE ONLY kai.review_queue_items
  IN ACCESS EXCLUSIVE MODE NOWAIT;

-- This rollback recognizes exactly two starting states and fails closed on
-- any other: (A) the exact repaired text contract, which it reverts via the
-- existing guarded, lossless path, and (B) the exact legacy/already-restored
-- enum contract, which it leaves untouched and validates as a rollback
-- no-op. The reversion itself is conditional on which state is found, so it
-- runs via EXECUTE inside this single guarded DO block rather than as bare
-- top-level DDL.
DO $review_status_rollback$
DECLARE
  v_relkind "char";
  v_ispartition boolean;
  v_attnum smallint;
  v_atttypname text;
  v_atttypnamespace text;
  v_atttyptype "char";
  v_attnotnull boolean;
  v_defexpr text;
  v_governing_check_count integer;
  v_check_name text;
  v_check_validated boolean;
  v_enum_type_oid oid;
  v_has_resolved_label boolean;
  v_non_enum_row_count bigint;
  v_invalid_index_count integer;
  v_state text;
BEGIN
  -- Guard 1 (common to both recognized states): kai.review_queue_items
  -- exists as an ordinary, non-partition table.
  SELECT r.relkind, r.relispartition INTO v_relkind, v_ispartition
    FROM pg_class r
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items';

  IF v_relkind IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items does not exist; refusing the P1-06 review_status rollback';
  END IF;
  IF v_relkind <> 'r' OR v_ispartition THEN
    RAISE EXCEPTION 'kai.review_queue_items is not an ordinary non-partition table; refusing the P1-06 review_status rollback';
  END IF;

  SELECT a.attnum, ty.typname, tn.nspname, ty.typtype, a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    INTO v_attnum, v_atttypname, v_atttypnamespace, v_atttyptype, v_attnotnull, v_defexpr
    FROM pg_attribute a
    JOIN pg_class r ON r.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_type ty ON ty.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = ty.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
     AND a.attname = 'review_status' AND NOT a.attisdropped;

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items.review_status does not exist; refusing the P1-06 review_status rollback';
  END IF;

  -- Classify the starting state by the column's actual type. Anything that
  -- is neither the exact repaired text contract nor the exact
  -- legacy/already-restored enum contract fails closed.
  IF v_atttypname = 'text' AND v_atttypnamespace = 'pg_catalog' THEN
    v_state := 'repaired';
  ELSIF v_atttypname = 'review_status_enum' AND v_atttypnamespace = 'kai' AND v_atttyptype = 'e' THEN
    v_state := 'legacy';
  ELSE
    RAISE EXCEPTION 'kai.review_queue_items.review_status is neither the exact repaired text contract nor the exact legacy enum contract (found %.%, typtype=%); refusing the P1-06 review_status rollback', v_atttypnamespace, v_atttypname, v_atttyptype;
  END IF;

  IF v_state = 'repaired' THEN
    -- ================================================================
    -- STATE A: EXACT REPAIRED STATE. Use the existing guarded, lossless
    -- rollback behavior.
    -- ================================================================
    IF NOT v_attnotnull THEN
      RAISE EXCEPTION 'kai.review_queue_items.review_status is not NOT NULL; refusing the P1-06 review_status rollback';
    END IF;
    IF v_defexpr IS DISTINCT FROM '''needs_gk_review''::text' THEN
      RAISE EXCEPTION 'kai.review_queue_items.review_status default is not exactly ''needs_gk_review''::text (found %); refusing the P1-06 review_status rollback', v_defexpr;
    END IF;

    SELECT count(*) INTO v_governing_check_count
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c'
       AND v_attnum = ANY (c.conkey);
    IF v_governing_check_count <> 1 THEN
      RAISE EXCEPTION 'expected exactly 1 CHECK constraint governing review_status, found %; refusing the P1-06 review_status rollback', v_governing_check_count;
    END IF;

    SELECT c.conname, c.convalidated INTO v_check_name, v_check_validated
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c'
       AND v_attnum = ANY (c.conkey);
    IF v_check_name <> 'review_queue_items_p1_06_review_status_check' OR NOT v_check_validated THEN
      RAISE EXCEPTION 'governing CHECK is not the validated review_queue_items_p1_06_review_status_check (name=%, validated=%); refusing the P1-06 review_status rollback', v_check_name, v_check_validated;
    END IF;

    SELECT count(*) INTO v_invalid_index_count
      FROM pg_index i
      JOIN pg_class r ON r.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND v_attnum = ANY (i.indkey)
       AND NOT (i.indisvalid AND i.indisready);
    IF v_invalid_index_count > 0 THEN
      RAISE EXCEPTION '% index(es) involving review_status are not valid/ready; refusing the P1-06 review_status rollback', v_invalid_index_count;
    END IF;

    -- The shared enum must still exist as an enum and must not itself have
    -- drifted to already contain 'resolved'.
    SELECT ty.oid INTO v_enum_type_oid
      FROM pg_type ty
      JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = 'kai' AND ty.typname = 'review_status_enum' AND ty.typtype = 'e';
    IF v_enum_type_oid IS NULL THEN
      RAISE EXCEPTION 'kai.review_status_enum does not exist as an enum; refusing the P1-06 review_status rollback';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_enum e WHERE e.enumtypid = v_enum_type_oid AND e.enumlabel = 'resolved'
    ) INTO v_has_resolved_label;
    IF v_has_resolved_label THEN
      RAISE EXCEPTION 'kai.review_status_enum already contains ''resolved''; refusing the P1-06 review_status rollback rather than mask that drift';
    END IF;

    -- Lossless-only rollback: every current row must already be
    -- representable in kai.review_status_enum's current label set. This is
    -- the fail-closed check that refuses rollback when a legitimate
    -- 'resolved' row exists, because the enum lacks 'resolved' by the guard
    -- above.
    SELECT count(*) INTO v_non_enum_row_count
      FROM kai.review_queue_items q
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_enum e WHERE e.enumtypid = v_enum_type_oid AND e.enumlabel = q.review_status
     );
    IF v_non_enum_row_count > 0 THEN
      RAISE EXCEPTION '% row(s) hold a review_status value not present in kai.review_status_enum (e.g. ''resolved''); rollback would be lossy, refusing', v_non_enum_row_count;
    END IF;

    -- Only reached when every guard above passed: the enum-typed reversion
    -- is provably lossless for every existing row. Dollar-quoted EXECUTE
    -- keeps the literal DDL text identical to a bare statement, since the
    -- reversion is conditional on the branch selected above.
    EXECUTE $exec$ALTER TABLE ONLY kai.review_queue_items
      DROP CONSTRAINT review_queue_items_p1_06_review_status_check$exec$;

    EXECUTE $exec$ALTER TABLE ONLY kai.review_queue_items
      ALTER COLUMN review_status DROP DEFAULT$exec$;

    EXECUTE $exec$ALTER TABLE ONLY kai.review_queue_items
      ALTER COLUMN review_status TYPE kai.review_status_enum
      USING review_status::kai.review_status_enum$exec$;

    EXECUTE $exec$ALTER TABLE ONLY kai.review_queue_items
      ALTER COLUMN review_status SET DEFAULT 'needs_gk_review'::kai.review_status_enum$exec$;

    RAISE NOTICE 'P1-06 review_status column rollback applied: repaired text contract reverted to the legacy enum contract.';
  ELSE
    -- ================================================================
    -- STATE B: EXACT LEGACY / ALREADY-RESTORED STATE. Perform NO DDL
    -- mutation; validate the exact legacy state; complete successfully
    -- as a rollback no-op. Do not broaden this definition merely to make
    -- rollback convenient.
    -- ================================================================
    IF NOT v_attnotnull THEN
      RAISE EXCEPTION 'legacy-state check failed: kai.review_queue_items.review_status is not NOT NULL; refusing the P1-06 review_status rollback no-op';
    END IF;
    IF v_defexpr IS DISTINCT FROM '''needs_gk_review''::kai.review_status_enum' THEN
      RAISE EXCEPTION 'legacy-state check failed: review_status default is not exactly ''needs_gk_review''::kai.review_status_enum (found %); refusing the P1-06 review_status rollback no-op', v_defexpr;
    END IF;

    SELECT ty.oid INTO v_enum_type_oid
      FROM pg_type ty
      JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = 'kai' AND ty.typname = 'review_status_enum' AND ty.typtype = 'e';
    IF v_enum_type_oid IS NULL THEN
      RAISE EXCEPTION 'legacy-state check failed: kai.review_status_enum does not exist as an enum; refusing the P1-06 review_status rollback no-op';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_enum e WHERE e.enumtypid = v_enum_type_oid AND e.enumlabel = 'resolved'
    ) INTO v_has_resolved_label;
    IF v_has_resolved_label THEN
      RAISE EXCEPTION 'legacy-state check failed: kai.review_status_enum already contains ''resolved''; refusing the P1-06 review_status rollback no-op';
    END IF;

    -- No P1-06 review_status text CHECK remains, and no unexpected CHECK
    -- constraint structurally governs review_status.
    SELECT count(*) INTO v_governing_check_count
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c'
       AND v_attnum = ANY (c.conkey);
    IF v_governing_check_count > 0 THEN
      RAISE EXCEPTION 'legacy-state check failed: % CHECK constraint(s) unexpectedly govern review_status on the legacy enum contract; refusing the P1-06 review_status rollback no-op', v_governing_check_count;
    END IF;

    -- Every current review_status value is a valid member of the shared
    -- enum's current label set.
    SELECT count(*) INTO v_non_enum_row_count
      FROM kai.review_queue_items q
     WHERE NOT EXISTS (
       SELECT 1 FROM pg_enum e WHERE e.enumtypid = v_enum_type_oid AND e.enumlabel = q.review_status::text
     );
    IF v_non_enum_row_count > 0 THEN
      RAISE EXCEPTION 'legacy-state check failed: % row(s) hold a review_status value not present in kai.review_status_enum; refusing the P1-06 review_status rollback no-op', v_non_enum_row_count;
    END IF;

    SELECT count(*) INTO v_invalid_index_count
      FROM pg_index i
      JOIN pg_class r ON r.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND v_attnum = ANY (i.indkey)
       AND NOT (i.indisvalid AND i.indisready);
    IF v_invalid_index_count > 0 THEN
      RAISE EXCEPTION 'legacy-state check failed: % index(es) involving review_status are not valid/ready; refusing the P1-06 review_status rollback no-op', v_invalid_index_count;
    END IF;

    RAISE NOTICE 'P1-06 review_status column rollback: already in the exact legacy enum contract, rollback no-op.';
  END IF;
END $review_status_rollback$;

COMMIT;
