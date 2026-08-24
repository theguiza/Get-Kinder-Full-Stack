BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_rollback_canonical_check_expr(
  target_relation regclass,
  predicate text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  canonical_expr text;
BEGIN
  DROP TABLE IF EXISTS pg_temp.kai_recon_rb_probe;

  EXECUTE format(
    'CREATE TEMP TABLE pg_temp.kai_recon_rb_probe (LIKE %s)',
    target_relation
  );

  EXECUTE format(
    'ALTER TABLE pg_temp.kai_recon_rb_probe ADD CONSTRAINT kai_recon_rb_check CHECK (%s)',
    predicate
  );

  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO canonical_expr
    FROM pg_constraint c
   WHERE c.conrelid = 'pg_temp.kai_recon_rb_probe'::regclass
     AND c.contype = 'c'
     AND c.conname = 'kai_recon_rb_check'::name;

  DROP TABLE pg_temp.kai_recon_rb_probe;

  IF canonical_expr IS NULL THEN
    RAISE EXCEPTION
      'rollback refused: failed to derive CHECK expression for %',
      target_relation;
  END IF;

  RETURN canonical_expr;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_rollback_constraint_expr(
  rel regclass,
  constraint_name text
)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_get_expr(c.conbin, c.conrelid)
    FROM pg_constraint c
   WHERE c.conrelid = rel
     AND c.conname = constraint_name::name
$$;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_rollback_constraint_validated(
  rel regclass,
  constraint_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = rel
       AND c.conname = constraint_name::name
       AND c.convalidated
  )
$$;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_rollback_ops_from_expr(expr text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ops text[];
  accepts_all boolean;
BEGIN
  IF expr IS NULL THEN
    RAISE EXCEPTION 'rollback refused: cannot extract audit operations from NULL predicate';
  END IF;

  SELECT array_agg(DISTINCT op ORDER BY op)
    INTO ops
    FROM (
      SELECT regexp_split_to_table(
               CASE WHEN m[1] LIKE '{%' THEN trim(both '{}' from m[1]) ELSE m[1] END,
               CASE WHEN m[1] LIKE '{%' THEN ',' ELSE E'\\x1f' END
             ) AS op
        FROM regexp_matches(expr, '''([^'']+)''', 'g') AS m
    ) parsed
   WHERE op <> '';

  IF ops IS NULL OR cardinality(ops) = 0 THEN
    RAISE EXCEPTION 'rollback refused: could not prove audit operation vocabulary from %', expr;
  END IF;

  EXECUTE format('SELECT bool_and(%s) FROM unnest($1::text[]) AS probe(operation)', expr)
    INTO accepts_all
    USING ops;
  IF accepts_all IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'rollback refused: audit operation predicate did not accept every extracted operation from %', expr;
  END IF;

  RETURN ops;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM kai.evidence_items WHERE support_strength = 'reviewed_supported') THEN
    RAISE EXCEPTION 'rollback refused: kai.evidence_items has reviewed_supported rows';
  END IF;
  IF EXISTS (SELECT 1 FROM kai.claims WHERE claim_strength = 'reviewed_supported') THEN
    RAISE EXCEPTION 'rollback refused: kai.claims has reviewed_supported rows';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM kai.review_queue_items
     WHERE queue_type = 'client_followup'
       AND queue_status = 'resolved'
       AND review_status = 'resolved'
  ) THEN
    RAISE EXCEPTION 'rollback refused: client_followup resolved/resolved queue rows exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kai.upload_lifecycle_audit
     WHERE operation IN (
       'evidence_review_completed',
       'claim_review_completed_internal_approval',
       'client_followup_completed'
     )
  ) THEN
    RAISE EXCEPTION 'rollback refused: audit rows use operations widened/restored by reconciliation';
  END IF;
END $$;

DO $$
DECLARE
  old_expr text;
  pre_ops text[];
  kept_ops text[];
  preserved boolean;
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
    RAISE EXCEPTION 'rollback refused: shared upload_lifecycle_audit operation CHECK is required';
  END IF;

  pre_ops := pg_temp.kai_recon_rollback_ops_from_expr(old_expr);
  IF NOT 'coverage_review_decision_accepted_internal_with_limitation' = ANY (pre_ops) THEN
    RAISE EXCEPTION 'rollback refused: P2-10 audit operation is absent from current shared audit CHECK';
  END IF;

  SELECT array_agg(op ORDER BY op)
    INTO kept_ops
    FROM unnest(pre_ops) AS op
   WHERE op <> ALL (ARRAY[
     'evidence_review_completed',
     'claim_review_completed_internal_approval',
     'client_followup_completed'
   ]::text[]);

  EXECUTE format(
    'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon CHECK (operation = ANY (%L::text[])) NOT VALID',
    kept_ops
  );
  ALTER TABLE kai.upload_lifecycle_audit
    VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon;
  ALTER TABLE kai.upload_lifecycle_audit
    DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
  ALTER TABLE kai.upload_lifecycle_audit
    RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon
    TO upload_lifecycle_audit_gate_a_operation_check;

  SELECT bool_and(operation = ANY (kept_ops))
    INTO preserved
    FROM unnest(kept_ops) AS probe(operation);
  IF preserved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'rollback refused: narrowed audit operation CHECK did not preserve kept vocabulary';
  END IF;
END $$;

ALTER TABLE kai.upload_lifecycle_audit
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check,
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_claim_review_metadata_object_check,
  DROP CONSTRAINT IF EXISTS upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check;

DO $$
DECLARE
  observed text;

  canonical_expr text :=
    pg_temp.kai_recon_rollback_canonical_check_expr(
      'kai.review_queue_items'::regclass,
      $canon$
        queue_type <> 'client_followup'
        OR (
          target_object_type = 'client_followup_item'
          AND priority = 'medium'
          AND summary = 'Client clarification is required for an unresolved claim gap.'
          AND assigned_to IS NULL
          AND due_at IS NULL
          AND required_action = ANY (ARRAY[
            'Confirm the business meaning of the unresolved field or measure.'::text,
            'Confirm the denominator and how it is calculated.'::text,
            'Confirm the reporting period represented by this source.'::text,
            'Confirm the entity level represented by the unresolved field or measure.'::text
          ])
          AND (
            (queue_status = 'waiting_on_client' AND review_status = 'proposed')
            OR (queue_status = 'resolved' AND review_status = 'resolved')
          )
        )
      $canon$
    );

  stale_expr text :=
    pg_temp.kai_recon_rollback_canonical_check_expr(
      'kai.review_queue_items'::regclass,
      $stale$
        queue_type <> 'client_followup'
        OR (
          target_object_type = 'client_followup_item'
          AND queue_status = 'waiting_on_client'
          AND review_status = 'proposed'
          AND priority = 'medium'
          AND summary = 'Client clarification is required for an unresolved claim gap.'
          AND assigned_to IS NULL
          AND due_at IS NULL
          AND required_action = ANY (ARRAY[
            'Confirm the business meaning of the unresolved field or measure.'::text,
            'Confirm the denominator and how it is calculated.'::text,
            'Confirm the reporting period represented by this source.'::text,
            'Confirm the entity level represented by the unresolved field or measure.'::text
          ])
        )
      $stale$
    );
BEGIN
  observed :=
    pg_temp.kai_recon_rollback_constraint_expr(
      'kai.review_queue_items'::regclass,
      'review_queue_items_p2_04_client_followup_contract_check'
    );

  IF observed IS NULL THEN
    RAISE EXCEPTION
      'rollback refused: P2-11 client-followup queue CHECK is missing';
  END IF;

  IF NOT pg_temp.kai_recon_rollback_constraint_validated(
    'kai.review_queue_items'::regclass,
    'review_queue_items_p2_04_client_followup_contract_check'
  ) THEN
    RAISE EXCEPTION
      'rollback refused: P2-11 client-followup queue CHECK is not validated';
  END IF;

  IF observed <> canonical_expr THEN
    RAISE EXCEPTION
      'rollback refused: P2-11 client-followup queue CHECK is not canonical: %',
      observed;
  END IF;

  ALTER TABLE kai.review_queue_items
    ADD CONSTRAINT review_queue_items_p2_11_rollback_check
    CHECK (
      queue_type <> 'client_followup'
      OR (
        target_object_type = 'client_followup_item'
        AND queue_status = 'waiting_on_client'
        AND review_status = 'proposed'
        AND priority = 'medium'
        AND summary = 'Client clarification is required for an unresolved claim gap.'
        AND assigned_to IS NULL
        AND due_at IS NULL
        AND required_action IN (
          'Confirm the business meaning of the unresolved field or measure.',
          'Confirm the denominator and how it is calculated.',
          'Confirm the reporting period represented by this source.',
          'Confirm the entity level represented by the unresolved field or measure.'
        )
      )
    ) NOT VALID;

  ALTER TABLE kai.review_queue_items
    VALIDATE CONSTRAINT review_queue_items_p2_11_rollback_check;

  ALTER TABLE kai.review_queue_items
    DROP CONSTRAINT review_queue_items_p2_04_client_followup_contract_check;

  ALTER TABLE kai.review_queue_items
    RENAME CONSTRAINT review_queue_items_p2_11_rollback_check
    TO review_queue_items_p2_04_client_followup_contract_check;

  observed :=
    pg_temp.kai_recon_rollback_constraint_expr(
      'kai.review_queue_items'::regclass,
      'review_queue_items_p2_04_client_followup_contract_check'
    );

  IF observed IS NULL THEN
    RAISE EXCEPTION
      'rollback refused: post-rollback P2-11 client-followup queue CHECK is missing';
  END IF;

  IF NOT pg_temp.kai_recon_rollback_constraint_validated(
    'kai.review_queue_items'::regclass,
    'review_queue_items_p2_04_client_followup_contract_check'
  ) THEN
    RAISE EXCEPTION
      'rollback refused: post-rollback P2-11 client-followup queue CHECK is not validated';
  END IF;

  stale_expr :=
    pg_temp.kai_recon_rollback_canonical_check_expr(
      'kai.review_queue_items'::regclass,
      $stale$
        queue_type <> 'client_followup'
        OR (
          target_object_type = 'client_followup_item'
          AND queue_status = 'waiting_on_client'
          AND review_status = 'proposed'
          AND priority = 'medium'
          AND summary = 'Client clarification is required for an unresolved claim gap.'
          AND assigned_to IS NULL
          AND due_at IS NULL
          AND required_action = ANY (ARRAY[
            'Confirm the business meaning of the unresolved field or measure.'::text,
            'Confirm the denominator and how it is calculated.'::text,
            'Confirm the reporting period represented by this source.'::text,
            'Confirm the entity level represented by the unresolved field or measure.'::text
          ])
        )
      $stale$
    );

  IF observed <> stale_expr THEN
    RAISE EXCEPTION
      'rollback refused: post-rollback P2-11 client-followup queue CHECK is not the exact stale contract: %',
      observed;
  END IF;
END $$;

ALTER TABLE kai.claims
  DROP CONSTRAINT IF EXISTS claims_p2_03_claim_strength_check,
  ADD CONSTRAINT claims_p2_03_claim_strength_check
    CHECK (claim_strength = 'unassessed') NOT VALID;
ALTER TABLE kai.claims
  VALIDATE CONSTRAINT claims_p2_03_claim_strength_check;

ALTER TABLE kai.evidence_items
  DROP CONSTRAINT IF EXISTS evidence_items_p2_01_support_strength_check,
  ADD CONSTRAINT evidence_items_p2_01_support_strength_check
    CHECK (support_strength = 'unassessed') NOT VALID;
ALTER TABLE kai.evidence_items
  VALIDATE CONSTRAINT evidence_items_p2_01_support_strength_check;

COMMIT;
