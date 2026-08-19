BEGIN;

-- P1-06 corrective repair: some already-existing kai.review_queue_items rows
-- were created (outside this repository's own CREATE TABLE IF NOT EXISTS path)
-- while review_status was still kai.review_status_enum-backed. The shared
-- kai.review_status_enum never gained a 'resolved' label, so the P1-08
-- resolved/resolved terminal write (postgresSourcePromotionRepository.js
-- resolveReviewQueueItemIfCurrent) fails with 22P02 against that starting
-- shape. This migration converts review_status to a column-local text type
-- with its own CHECK vocabulary, exactly mirroring the already-reviewed
-- column definition this repository's own P1-06 migration creates for a
-- fresh table. It does not touch the shared kai.review_status_enum and does
-- not alter any other column, table, or review-status semantics.
--
-- Fail-fast locking: refuse rather than wait indefinitely for the DDL lock
-- if a concurrent session already holds one on this table.
LOCK TABLE ONLY kai.review_queue_items
  IN ACCESS EXCLUSIVE MODE NOWAIT;

-- This migration recognizes exactly two starting states and fails closed on
-- any other: (A) the diagnosed legacy enum-backed contract, which it repairs,
-- and (B) the exact already-repaired text contract, which it leaves
-- untouched and validates as a converged no-op. Because the mutation itself
-- must be conditional on which state is found, it runs via EXECUTE inside
-- this single guarded DO block rather than as bare top-level DDL.
DO $review_status_repair$
DECLARE
  v_relkind "char";
  v_ispartition boolean;
  v_attnum smallint;
  v_atttypid oid;
  v_atttypname text;
  v_atttypnamespace text;
  v_atttyptype "char";
  v_attnotnull boolean;
  v_attidentity "char";
  v_attgenerated "char";
  v_defexpr text;
  v_enum_type_oid oid;
  v_has_resolved_label boolean;
  v_non_vocab_count bigint;
  v_conflicting_check_count integer;
  v_name_collision_count integer;
  v_invalid_index_count integer;
  v_governing_check_count integer;
  v_check_name text;
  v_check_validated boolean;
  v_vocab_ok boolean;
  v_state text;
BEGIN
  -- Guard 1 (common to both recognized states): kai.review_queue_items
  -- exists as an ordinary, non-partition table.
  SELECT r.relkind, r.relispartition
    INTO v_relkind, v_ispartition
    FROM pg_class r
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items';

  IF v_relkind IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items does not exist; refusing the P1-06 review_status repair';
  END IF;
  IF v_relkind <> 'r' OR v_ispartition THEN
    RAISE EXCEPTION 'kai.review_queue_items is not an ordinary non-partition table (relkind=%, relispartition=%); refusing the P1-06 review_status repair', v_relkind, v_ispartition;
  END IF;

  SELECT a.attnum, a.atttypid, ty.typname, tn.nspname, ty.typtype,
         a.attnotnull, a.attidentity, a.attgenerated,
         pg_get_expr(d.adbin, d.adrelid)
    INTO v_attnum, v_atttypid, v_atttypname, v_atttypnamespace, v_atttyptype,
         v_attnotnull, v_attidentity, v_attgenerated, v_defexpr
    FROM pg_attribute a
    JOIN pg_class r ON r.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_type ty ON ty.oid = a.atttypid
    JOIN pg_namespace tn ON tn.oid = ty.typnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
   WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
     AND a.attname = 'review_status' AND NOT a.attisdropped;

  IF v_attnum IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items.review_status does not exist; refusing the P1-06 review_status repair';
  END IF;

  -- Classify the starting state by the column's actual type. Anything that
  -- is neither the diagnosed legacy enum contract nor the exact repaired
  -- text contract fails closed rather than being treated as convergence.
  IF v_atttypname = 'review_status_enum' AND v_atttypnamespace = 'kai' AND v_atttyptype = 'e' THEN
    v_state := 'legacy';
  ELSIF v_atttypname = 'text' AND v_atttypnamespace = 'pg_catalog' THEN
    v_state := 'repaired';
  ELSE
    RAISE EXCEPTION 'kai.review_queue_items.review_status is neither the diagnosed legacy enum contract (kai.review_status_enum) nor the exact repaired text contract (found %.%, typtype=%); refusing the P1-06 review_status repair', v_atttypnamespace, v_atttypname, v_atttyptype;
  END IF;

  IF v_state = 'legacy' THEN
    -- ================================================================
    -- STATE A: LEGACY-COMPATIBLE. Apply the already-accepted
    -- column-local forward repair.
    -- ================================================================
    IF NOT v_attnotnull THEN
      RAISE EXCEPTION 'kai.review_queue_items.review_status is not NOT NULL; refusing the P1-06 review_status repair';
    END IF;
    IF v_defexpr IS DISTINCT FROM '''needs_gk_review''::kai.review_status_enum' THEN
      RAISE EXCEPTION 'kai.review_queue_items.review_status default is not exactly ''needs_gk_review''::kai.review_status_enum (found %); refusing the P1-06 review_status repair', v_defexpr;
    END IF;
    IF v_attidentity <> '' OR v_attgenerated <> '' THEN
      RAISE EXCEPTION 'kai.review_queue_items.review_status is identity/generated (attidentity=%, attgenerated=%); refusing the P1-06 review_status repair', v_attidentity, v_attgenerated;
    END IF;

    -- Guard 4: the shared kai.review_status_enum exists and does NOT
    -- contain 'resolved'.
    SELECT ty.oid INTO v_enum_type_oid
      FROM pg_type ty
      JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = 'kai' AND ty.typname = 'review_status_enum' AND ty.typtype = 'e';

    IF v_enum_type_oid IS NULL THEN
      RAISE EXCEPTION 'kai.review_status_enum does not exist as an enum; refusing the P1-06 review_status repair';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_enum e WHERE e.enumtypid = v_enum_type_oid AND e.enumlabel = 'resolved'
    ) INTO v_has_resolved_label;

    IF v_has_resolved_label THEN
      RAISE EXCEPTION 'kai.review_status_enum already contains ''resolved''; the shared enum has drifted from the diagnosed starting contract, refusing the P1-06 review_status repair';
    END IF;

    -- Guard 5: every existing review_status value is representable in the
    -- intended P1-06 text vocabulary.
    EXECUTE format(
      'SELECT count(*) FROM kai.review_queue_items WHERE review_status::text NOT IN (%L, %L, %L)',
      'proposed', 'needs_gk_review', 'resolved'
    ) INTO v_non_vocab_count;

    IF v_non_vocab_count > 0 THEN
      RAISE EXCEPTION 'kai.review_queue_items has % row(s) whose review_status is outside {proposed, needs_gk_review, resolved}; refusing the P1-06 review_status repair', v_non_vocab_count;
    END IF;

    -- Guard 6: no unexpected existing CHECK constraint structurally
    -- references the review_status column (detected via conkey, not
    -- rendered-SQL matching).
    SELECT count(*) INTO v_conflicting_check_count
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c'
       AND v_attnum = ANY (c.conkey);

    IF v_conflicting_check_count > 0 THEN
      RAISE EXCEPTION 'kai.review_queue_items already has % CHECK constraint(s) structurally referencing review_status; refusing to guess a compatible shape', v_conflicting_check_count;
    END IF;

    -- Guard 7: the intended constraint name is not already occupied
    -- unexpectedly.
    SELECT count(*) INTO v_name_collision_count
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.conname = 'review_queue_items_p1_06_review_status_check';

    IF v_name_collision_count > 0 THEN
      RAISE EXCEPTION 'kai.review_queue_items_p1_06_review_status_check already exists unexpectedly; refusing the P1-06 review_status repair';
    END IF;

    -- Guard 8: any index involving review_status begins valid/ready.
    SELECT count(*) INTO v_invalid_index_count
      FROM pg_index i
      JOIN pg_class r ON r.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND v_attnum = ANY (i.indkey)
       AND NOT (i.indisvalid AND i.indisready);

    IF v_invalid_index_count > 0 THEN
      RAISE EXCEPTION 'kai.review_queue_items has % index(es) involving review_status that are not valid/ready; refusing the P1-06 review_status repair', v_invalid_index_count;
    END IF;

    -- The mutation itself: drop the enum-typed default, convert with a
    -- label-preserving text cast, restore a text-typed default, and add
    -- exactly the P1-06 local vocabulary CHECK. ALTER TABLE ONLY protects
    -- against an unexpected inheriting child picking up this change
    -- implicitly. Dollar-quoted EXECUTE keeps the literal DDL text
    -- identical to a bare statement (no escaped-quote doubling), since the
    -- mutation is conditional on the branch selected above.
    EXECUTE $exec$ALTER TABLE ONLY kai.review_queue_items
      ALTER COLUMN review_status DROP DEFAULT$exec$;

    EXECUTE $exec$ALTER TABLE ONLY kai.review_queue_items
      ALTER COLUMN review_status TYPE text
      USING review_status::text$exec$;

    EXECUTE $exec$ALTER TABLE ONLY kai.review_queue_items
      ALTER COLUMN review_status SET DEFAULT 'needs_gk_review'::text$exec$;

    EXECUTE $exec$ALTER TABLE ONLY kai.review_queue_items
      ADD CONSTRAINT review_queue_items_p1_06_review_status_check
      CHECK (review_status IN ('proposed', 'needs_gk_review', 'resolved'))$exec$;

    -- Postconditions, verified structurally in the same transaction before
    -- commit (review_status_repair_postconditions).
    SELECT r.relkind, r.relispartition INTO v_relkind, v_ispartition
      FROM pg_class r
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items';
    IF v_relkind <> 'r' OR v_ispartition THEN
      RAISE EXCEPTION 'postcondition failed: kai.review_queue_items is no longer an ordinary non-partition table';
    END IF;

    SELECT a.attnum, ty.typname, tn.nspname, a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
      INTO v_attnum, v_atttypname, v_atttypnamespace, v_attnotnull, v_defexpr
      FROM pg_attribute a
      JOIN pg_class r ON r.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      JOIN pg_type ty ON ty.oid = a.atttypid
      JOIN pg_namespace tn ON tn.oid = ty.typnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND a.attname = 'review_status' AND NOT a.attisdropped;

    IF v_atttypname <> 'text' OR v_atttypnamespace <> 'pg_catalog' THEN
      RAISE EXCEPTION 'postcondition failed: review_status is not pg_catalog.text (found %.%)', v_atttypnamespace, v_atttypname;
    END IF;
    IF NOT v_attnotnull THEN
      RAISE EXCEPTION 'postcondition failed: review_status is no longer NOT NULL';
    END IF;
    IF v_defexpr IS DISTINCT FROM '''needs_gk_review''::text' THEN
      RAISE EXCEPTION 'postcondition failed: review_status default is not exactly ''needs_gk_review''::text (found %)', v_defexpr;
    END IF;

    SELECT count(*) INTO v_governing_check_count
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c'
       AND v_attnum = ANY (c.conkey);
    IF v_governing_check_count <> 1 THEN
      RAISE EXCEPTION 'postcondition failed: expected exactly 1 CHECK constraint governing review_status, found %', v_governing_check_count;
    END IF;

    SELECT c.conname, c.convalidated INTO v_check_name, v_check_validated
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c'
       AND v_attnum = ANY (c.conkey);
    IF v_check_name <> 'review_queue_items_p1_06_review_status_check' THEN
      RAISE EXCEPTION 'postcondition failed: governing CHECK is not review_queue_items_p1_06_review_status_check (found %)', v_check_name;
    END IF;
    IF NOT v_check_validated THEN
      RAISE EXCEPTION 'postcondition failed: review_queue_items_p1_06_review_status_check is not validated';
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM kai.review_queue_items WHERE review_status NOT IN (%L, %L, %L)',
      'proposed', 'needs_gk_review', 'resolved'
    ) INTO v_non_vocab_count;
    IF v_non_vocab_count > 0 THEN
      RAISE EXCEPTION 'postcondition failed: % row(s) outside the three-value vocabulary', v_non_vocab_count;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type ty ON ty.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = 'kai' AND ty.typname = 'review_status_enum' AND e.enumlabel = 'resolved'
    ) INTO v_has_resolved_label;
    IF v_has_resolved_label THEN
      RAISE EXCEPTION 'postcondition failed: kai.review_status_enum unexpectedly gained ''resolved''';
    END IF;

    SELECT count(*) INTO v_invalid_index_count
      FROM pg_index i
      JOIN pg_class r ON r.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND v_attnum = ANY (i.indkey)
       AND NOT (i.indisvalid AND i.indisready);
    IF v_invalid_index_count > 0 THEN
      RAISE EXCEPTION 'postcondition failed: % index(es) involving review_status are not valid/ready', v_invalid_index_count;
    END IF;

    RAISE NOTICE 'P1-06 review_status column repair applied: legacy enum contract converted to the repaired text contract.';
  ELSE
    -- ================================================================
    -- STATE B: EXACT REPAIRED / CONVERGED. Perform NO DDL mutation;
    -- validate the full repaired postconditions; complete successfully
    -- as an explicit converged no-op. A near-match (widened CHECK, wrong
    -- default, extra CHECK, invalid index, enum drift) refuses rather
    -- than silently succeeding.
    -- ================================================================
    IF NOT v_attnotnull THEN
      RAISE EXCEPTION 'converged-state check failed: kai.review_queue_items.review_status is not NOT NULL; refusing the P1-06 review_status repair no-op';
    END IF;
    IF v_defexpr IS DISTINCT FROM '''needs_gk_review''::text' THEN
      RAISE EXCEPTION 'converged-state check failed: review_status default is not exactly ''needs_gk_review''::text (found %); refusing the P1-06 review_status repair no-op', v_defexpr;
    END IF;
    IF v_attidentity <> '' OR v_attgenerated <> '' THEN
      RAISE EXCEPTION 'converged-state check failed: review_status is identity/generated (attidentity=%, attgenerated=%); refusing the P1-06 review_status repair no-op', v_attidentity, v_attgenerated;
    END IF;

    SELECT count(*) INTO v_governing_check_count
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c'
       AND v_attnum = ANY (c.conkey);
    IF v_governing_check_count <> 1 THEN
      RAISE EXCEPTION 'converged-state check failed: expected exactly 1 CHECK constraint governing review_status, found %; refusing the P1-06 review_status repair no-op', v_governing_check_count;
    END IF;

    SELECT c.conname, c.convalidated INTO v_check_name, v_check_validated
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND c.contype = 'c'
       AND v_attnum = ANY (c.conkey);
    IF v_check_name <> 'review_queue_items_p1_06_review_status_check' OR NOT v_check_validated THEN
      RAISE EXCEPTION 'converged-state check failed: governing CHECK is not the validated review_queue_items_p1_06_review_status_check (name=%, validated=%); refusing the P1-06 review_status repair no-op', v_check_name, v_check_validated;
    END IF;

    -- Exact-vocabulary structural check: the governing CHECK must admit
    -- exactly {proposed, needs_gk_review, resolved} and no fourth or
    -- additional value. Literal values are extracted from
    -- pg_get_constraintdef's rendered expression (a deterministic,
    -- catalog-backed representation) rather than matched by substring
    -- containment, so a widened CHECK is rejected rather than accepted.
    SELECT (array_agg(DISTINCT literal ORDER BY literal) = ARRAY['needs_gk_review', 'proposed', 'resolved'])
      INTO v_vocab_ok
      FROM (
        SELECT (regexp_matches(pg_get_constraintdef(c.oid), '''([^'']*)''', 'g'))[1] AS literal
          FROM pg_constraint c
          JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
         WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
           AND c.conname = 'review_queue_items_p1_06_review_status_check'
      ) literals;
    IF v_vocab_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'converged-state check failed: review_queue_items_p1_06_review_status_check does not admit exactly {proposed, needs_gk_review, resolved}; refusing the P1-06 review_status repair no-op';
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM kai.review_queue_items WHERE review_status NOT IN (%L, %L, %L)',
      'proposed', 'needs_gk_review', 'resolved'
    ) INTO v_non_vocab_count;
    IF v_non_vocab_count > 0 THEN
      RAISE EXCEPTION 'converged-state check failed: % row(s) outside the three-value vocabulary; refusing the P1-06 review_status repair no-op', v_non_vocab_count;
    END IF;

    SELECT ty.oid INTO v_enum_type_oid
      FROM pg_type ty
      JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = 'kai' AND ty.typname = 'review_status_enum' AND ty.typtype = 'e';
    IF v_enum_type_oid IS NULL THEN
      RAISE EXCEPTION 'converged-state check failed: kai.review_status_enum does not exist as an enum; refusing the P1-06 review_status repair no-op';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_enum e WHERE e.enumtypid = v_enum_type_oid AND e.enumlabel = 'resolved'
    ) INTO v_has_resolved_label;
    IF v_has_resolved_label THEN
      RAISE EXCEPTION 'converged-state check failed: kai.review_status_enum already contains ''resolved''; refusing the P1-06 review_status repair no-op';
    END IF;

    SELECT count(*) INTO v_invalid_index_count
      FROM pg_index i
      JOIN pg_class r ON r.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai' AND r.relname = 'review_queue_items'
       AND v_attnum = ANY (i.indkey)
       AND NOT (i.indisvalid AND i.indisready);
    IF v_invalid_index_count > 0 THEN
      RAISE EXCEPTION 'converged-state check failed: % index(es) involving review_status are not valid/ready; refusing the P1-06 review_status repair no-op', v_invalid_index_count;
    END IF;

    RAISE NOTICE 'P1-06 review_status column repair: already in the exact repaired contract, converged no-op.';
  END IF;
END $review_status_repair$;

COMMIT;
