BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_norm(def text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(coalesce(def, ''), '\s+', '', 'g')
$$;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_canonical_check_expr(
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
  DROP TABLE IF EXISTS pg_temp.kai_recon_check_probe;

  EXECUTE format(
    'CREATE TEMP TABLE pg_temp.kai_recon_check_probe (LIKE %s)',
    target_relation
  );

  EXECUTE format(
    'ALTER TABLE pg_temp.kai_recon_check_probe ADD CONSTRAINT kai_recon_probe_check CHECK (%s)',
    predicate
  );

  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO canonical_expr
    FROM pg_constraint c
   WHERE c.conrelid = 'pg_temp.kai_recon_check_probe'::regclass
     AND c.contype = 'c'
     AND c.conname = 'kai_recon_probe_check'::name;

  DROP TABLE pg_temp.kai_recon_check_probe;

  IF canonical_expr IS NULL THEN
    RAISE EXCEPTION
      'failed to derive reconciliation CHECK for %',
      target_relation;
  END IF;

  RETURN canonical_expr;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_constraint_expr(rel regclass, constraint_name text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT pg_get_expr(c.conbin, c.conrelid)
    FROM pg_constraint c
   WHERE c.conrelid = rel
     AND c.conname = constraint_name::name
$$;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_constraint_validated(rel regclass, constraint_name text)
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

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_index_exists(schema_name text, index_name text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM pg_indexes i
     WHERE i.schemaname = schema_name
       AND i.indexname = index_name
  )
$$;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_ops_from_expr(expr text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ops text[];
  accepts_all boolean;
BEGIN
  IF expr IS NULL THEN
    RAISE EXCEPTION 'cannot extract audit operations from NULL predicate';
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
    RAISE EXCEPTION 'could not prove audit operation vocabulary from %', expr;
  END IF;

  EXECUTE format('SELECT bool_and(%s) FROM unnest($1::text[]) AS probe(operation)', expr)
    INTO accepts_all
    USING ops;
  IF accepts_all IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'audit operation predicate did not accept every extracted operation from %', expr;
  END IF;

  RETURN ops;
END $$;

DO $$
BEGIN
  IF to_regclass('kai.evidence_items') IS NULL THEN
    RAISE EXCEPTION 'kai.evidence_items is required before P2-09/P2-11 reconciliation';
  END IF;
  IF to_regclass('kai.claims') IS NULL THEN
    RAISE EXCEPTION 'kai.claims is required before P2-09/P2-11 reconciliation';
  END IF;
  IF to_regclass('kai.gap_log_items') IS NULL THEN
    RAISE EXCEPTION 'kai.gap_log_items is required before P2-09/P2-11 reconciliation';
  END IF;
  IF to_regclass('kai.review_queue_items') IS NULL THEN
    RAISE EXCEPTION 'kai.review_queue_items is required before P2-09/P2-11 reconciliation';
  END IF;
  IF to_regclass('kai.client_followup_items') IS NULL THEN
    RAISE EXCEPTION 'kai.client_followup_items is required before P2-09/P2-11 reconciliation';
  END IF;
  IF to_regclass('kai.upload_lifecycle_audit') IS NULL THEN
    RAISE EXCEPTION 'kai.upload_lifecycle_audit is required before P2-09/P2-11 reconciliation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kai'
       AND p.proname = 'gate_a_p0_jsonb_metadata_only'
  ) THEN
    RAISE EXCEPTION 'kai.gate_a_p0_jsonb_metadata_only is required before P2-09/P2-11 reconciliation';
  END IF;
END $$;

DO $$
DECLARE
  priority_type_oid oid;
  priority_type_schema text;
  priority_type_name text;
  priority_typtype text;
  priority_not_null boolean;
  priority_default text;
  priority_enum_labels text[];
  observed_priority_expr text;
  priority_constraint_validated boolean;
  canonical_priority_expr text :=
    pg_temp.kai_recon_canonical_check_expr(
      'kai.review_queue_items'::regclass,
      $canon$
        priority IN (
          'mandatory',
          'immediate_fix',
          'high',
          'medium',
          'low',
          'backlog',
          'not_applicable',
          'unknown'
        )
      $canon$
    );
  text_shape_supported boolean;
  enum_shape_supported boolean;
BEGIN
  SELECT
    ty.oid,
    tyn.nspname,
    ty.typname,
    ty.typtype::text,
    a.attnotnull,
    pg_get_expr(d.adbin, d.adrelid)
    INTO
      priority_type_oid,
      priority_type_schema,
      priority_type_name,
      priority_typtype,
      priority_not_null,
      priority_default
    FROM pg_attribute a
    JOIN pg_class r
      ON r.oid = a.attrelid
    JOIN pg_namespace rn
      ON rn.oid = r.relnamespace
    JOIN pg_type ty
      ON ty.oid = a.atttypid
    JOIN pg_namespace tyn
      ON tyn.oid = ty.typnamespace
    LEFT JOIN pg_attrdef d
      ON d.adrelid = a.attrelid
     AND d.adnum = a.attnum
   WHERE rn.nspname = 'kai'
     AND r.relname = 'review_queue_items'
     AND a.attname = 'priority'
     AND a.attnum > 0
     AND NOT a.attisdropped;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'kai.review_queue_items.priority is required before P2-09/P2-11 reconciliation';
  END IF;

  observed_priority_expr :=
    pg_temp.kai_recon_constraint_expr(
      'kai.review_queue_items'::regclass,
      'review_queue_items_p1_06_priority_check'
    );

  priority_constraint_validated :=
    pg_temp.kai_recon_constraint_validated(
      'kai.review_queue_items'::regclass,
      'review_queue_items_p1_06_priority_check'
    );

  IF priority_type_schema = 'kai'
     AND priority_type_name = 'priority_enum'
     AND priority_typtype = 'e' THEN
    SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
      INTO priority_enum_labels
      FROM pg_enum e
     WHERE e.enumtypid = priority_type_oid;
  END IF;

  text_shape_supported :=
    priority_type_schema = 'pg_catalog'
    AND priority_type_name = 'text'
    AND priority_typtype = 'b'
    AND priority_not_null
    AND priority_default = '''medium''::text'
    AND observed_priority_expr = canonical_priority_expr
    AND priority_constraint_validated;

  enum_shape_supported :=
    priority_type_schema = 'kai'
    AND priority_type_name = 'priority_enum'
    AND priority_typtype = 'e'
    AND priority_not_null
    AND priority_default = '''medium''::kai.priority_enum'
    AND priority_enum_labels = ARRAY[
      'mandatory',
      'immediate_fix',
      'high',
      'medium',
      'low',
      'backlog',
      'not_applicable',
      'unknown'
    ]::text[]
    AND (
      observed_priority_expr IS NULL
      OR (
        observed_priority_expr = canonical_priority_expr
        AND priority_constraint_validated
      )
    );

  IF text_shape_supported IS NOT TRUE
     AND enum_shape_supported IS NOT TRUE THEN
    RAISE EXCEPTION
      'kai.review_queue_items.priority has unsupported physical contract: type=%.%, typtype=%, not_null=%, default=%, enum_labels=%, priority_check=%, priority_check_validated=%',
      priority_type_schema,
      priority_type_name,
      priority_typtype,
      priority_not_null,
      priority_default,
      priority_enum_labels,
      observed_priority_expr,
      priority_constraint_validated;
  END IF;
END $$;

DO $$
DECLARE
  observed text;
  stale_expr text := pg_temp.kai_recon_canonical_check_expr('kai.evidence_items'::regclass, $stale$support_strength = 'unassessed'$stale$);
  canonical_expr text := pg_temp.kai_recon_canonical_check_expr('kai.evidence_items'::regclass, $canon$support_strength IN ('unassessed', 'reviewed_supported')$canon$);
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'evidence_items'
     AND c.conname = 'evidence_items_p2_01_support_strength_check';

  IF observed = canonical_expr THEN
    RETURN;
  END IF;
  IF observed <> stale_expr THEN
    RAISE EXCEPTION 'kai.evidence_items support_strength CHECK has unknown definition: %', observed;
  END IF;

  ALTER TABLE kai.evidence_items
    ADD CONSTRAINT evidence_items_p2_01_support_strength_check_recon
    CHECK (support_strength IN ('unassessed', 'reviewed_supported')) NOT VALID;
  ALTER TABLE kai.evidence_items
    VALIDATE CONSTRAINT evidence_items_p2_01_support_strength_check_recon;
  ALTER TABLE kai.evidence_items
    DROP CONSTRAINT evidence_items_p2_01_support_strength_check;
  ALTER TABLE kai.evidence_items
    RENAME CONSTRAINT evidence_items_p2_01_support_strength_check_recon
    TO evidence_items_p2_01_support_strength_check;
END $$;

DO $$
DECLARE
  observed text;
  stale_expr text := pg_temp.kai_recon_canonical_check_expr('kai.claims'::regclass, $stale$claim_strength = 'unassessed'$stale$);
  canonical_expr text := pg_temp.kai_recon_canonical_check_expr('kai.claims'::regclass, $canon$claim_strength IN ('unassessed', 'reviewed_supported')$canon$);
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'claims'
     AND c.conname = 'claims_p2_03_claim_strength_check';

  IF observed = canonical_expr THEN
    RETURN;
  END IF;
  IF observed <> stale_expr THEN
    RAISE EXCEPTION 'kai.claims claim_strength CHECK has unknown definition: %', observed;
  END IF;

  ALTER TABLE kai.claims
    ADD CONSTRAINT claims_p2_03_claim_strength_check_recon
    CHECK (claim_strength IN ('unassessed', 'reviewed_supported')) NOT VALID;
  ALTER TABLE kai.claims
    VALIDATE CONSTRAINT claims_p2_03_claim_strength_check_recon;
  ALTER TABLE kai.claims
    DROP CONSTRAINT claims_p2_03_claim_strength_check;
  ALTER TABLE kai.claims
    RENAME CONSTRAINT claims_p2_03_claim_strength_check_recon
    TO claims_p2_03_claim_strength_check;
END $$;

DO $$
DECLARE
  observed text;
  canonical_expr text := pg_temp.kai_recon_canonical_check_expr('kai.upload_lifecycle_audit'::regclass, $canon$
    operation <> 'evidence_review_completed'
    OR (
      jsonb_typeof(metadata) = 'object'
      AND kai.gate_a_p0_jsonb_metadata_only(metadata)
      AND metadata ? 'metadata_only'
      AND metadata ? 'contract'
      AND metadata ? 'evidence_item_id'
      AND metadata ? 'review_queue_item_id'
      AND metadata ? 'previous_queue_status'
      AND metadata ? 'resulting_queue_status'
      AND metadata ? 'previous_review_status'
      AND metadata ? 'resulting_review_status'
      AND metadata ? 'previous_support_strength'
      AND metadata ? 'resulting_support_strength'
      AND metadata ? 'validator_key'
    )
  $canon$);
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'::name;

  IF observed IS NULL THEN
    ALTER TABLE kai.upload_lifecycle_audit
      ADD CONSTRAINT upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check
      CHECK (
        operation <> 'evidence_review_completed'
        OR (
          jsonb_typeof(metadata) = 'object'
          AND kai.gate_a_p0_jsonb_metadata_only(metadata)
          AND metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'evidence_item_id'
          AND metadata ? 'review_queue_item_id'
          AND metadata ? 'previous_queue_status'
          AND metadata ? 'resulting_queue_status'
          AND metadata ? 'previous_review_status'
          AND metadata ? 'resulting_review_status'
          AND metadata ? 'previous_support_strength'
          AND metadata ? 'resulting_support_strength'
          AND metadata ? 'validator_key'
        )
      ) NOT VALID;
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check;
  ELSE
    IF observed <> canonical_expr THEN
      RAISE EXCEPTION 'P2-09 evidence-review audit metadata CHECK has unknown definition: %', observed;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  observed text;
  canonical_expr text := pg_temp.kai_recon_canonical_check_expr('kai.upload_lifecycle_audit'::regclass, $canon$
    operation <> 'claim_review_completed_internal_approval'
    OR (
      jsonb_typeof(metadata) = 'object'
      AND kai.gate_a_p0_jsonb_metadata_only(metadata)
      AND metadata ? 'metadata_only'
      AND metadata ? 'contract'
      AND metadata ? 'claim_id'
      AND metadata ? 'evidence_item_id'
      AND metadata ? 'review_queue_item_id'
      AND metadata ? 'previous_queue_status'
      AND metadata ? 'resulting_queue_status'
      AND metadata ? 'previous_review_status'
      AND metadata ? 'resulting_review_status'
      AND metadata ? 'previous_claim_strength'
      AND metadata ? 'resulting_claim_strength'
      AND metadata ? 'validator_key'
    )
  $canon$);
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'::name;

  IF observed IS NULL THEN
    ALTER TABLE kai.upload_lifecycle_audit
      ADD CONSTRAINT upload_lifecycle_audit_p2_09_claim_review_metadata_object_check
      CHECK (
        operation <> 'claim_review_completed_internal_approval'
        OR (
          jsonb_typeof(metadata) = 'object'
          AND kai.gate_a_p0_jsonb_metadata_only(metadata)
          AND metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'claim_id'
          AND metadata ? 'evidence_item_id'
          AND metadata ? 'review_queue_item_id'
          AND metadata ? 'previous_queue_status'
          AND metadata ? 'resulting_queue_status'
          AND metadata ? 'previous_review_status'
          AND metadata ? 'resulting_review_status'
          AND metadata ? 'previous_claim_strength'
          AND metadata ? 'resulting_claim_strength'
          AND metadata ? 'validator_key'
        )
      ) NOT VALID;
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_p2_09_claim_review_metadata_object_check;
  ELSE
    IF observed <> canonical_expr THEN
      RAISE EXCEPTION 'P2-09 claim-review audit metadata CHECK has unknown definition: %', observed;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  observed text;
  canonical_expr text := pg_temp.kai_recon_canonical_check_expr('kai.review_queue_items'::regclass, $canon$
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
  $canon$);
  stale_expr text := pg_temp.kai_recon_canonical_check_expr('kai.review_queue_items'::regclass, $stale$
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
  $stale$);
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'review_queue_items'
     AND c.conname = 'review_queue_items_p2_04_client_followup_contract_check';

  IF observed IS NULL THEN
    RAISE EXCEPTION
      'P2-11 client-followup queue CHECK is missing';
  END IF;

  IF observed = canonical_expr THEN
    RETURN;
  END IF;

  IF observed <> stale_expr THEN
    RAISE EXCEPTION
      'P2-11 client-followup queue CHECK has unknown definition: %',
      observed;
  END IF;

  ALTER TABLE kai.review_queue_items
    ADD CONSTRAINT review_queue_items_p2_04_client_followup_contract_check_recon
    CHECK (
      queue_type <> 'client_followup'
      OR (
        target_object_type = 'client_followup_item'
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
        AND (
          (queue_status = 'waiting_on_client' AND review_status = 'proposed')
          OR (queue_status = 'resolved' AND review_status = 'resolved')
        )
      )
    ) NOT VALID;
  ALTER TABLE kai.review_queue_items
    VALIDATE CONSTRAINT review_queue_items_p2_04_client_followup_contract_check_recon;
  ALTER TABLE kai.review_queue_items
    DROP CONSTRAINT review_queue_items_p2_04_client_followup_contract_check;
  ALTER TABLE kai.review_queue_items
    RENAME CONSTRAINT review_queue_items_p2_04_client_followup_contract_check_recon
    TO review_queue_items_p2_04_client_followup_contract_check;

  observed :=
    pg_temp.kai_recon_constraint_expr(
      'kai.review_queue_items'::regclass,
      'review_queue_items_p2_04_client_followup_contract_check'
    );

  IF observed IS NULL THEN
    RAISE EXCEPTION
      'post-reconciliation P2-11 client-followup queue CHECK is missing';
  END IF;

  IF NOT pg_temp.kai_recon_constraint_validated(
    'kai.review_queue_items'::regclass,
    'review_queue_items_p2_04_client_followup_contract_check'
  ) THEN
    RAISE EXCEPTION
      'post-reconciliation P2-11 client-followup queue CHECK is not validated';
  END IF;

  canonical_expr :=
    pg_temp.kai_recon_canonical_check_expr(
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

  IF observed <> canonical_expr THEN
    RAISE EXCEPTION
      'post-reconciliation P2-11 client-followup queue CHECK is not canonical: %',
      observed;
  END IF;
END $$;

DO $$
DECLARE
  observed text;
  canonical_expr text := pg_temp.kai_recon_canonical_check_expr('kai.upload_lifecycle_audit'::regclass, $canon$
    operation <> 'client_followup_completed'
    OR (
      jsonb_typeof(metadata) = 'object'
      AND kai.gate_a_p0_jsonb_metadata_only(metadata)
      AND metadata ? 'metadata_only'
      AND metadata ? 'contract'
      AND metadata ? 'claim_id'
      AND metadata ? 'client_followup_item_id'
      AND metadata ? 'gap_log_item_id'
      AND metadata ? 'dimension_key'
      AND metadata ? 'review_queue_item_id'
      AND metadata ? 'previous_queue_status'
      AND metadata ? 'resulting_queue_status'
      AND metadata ? 'previous_review_status'
      AND metadata ? 'resulting_review_status'
      AND metadata ? 'decided_by_role'
      AND metadata ? 'disposition'
      AND metadata ? 'replayed'
      AND metadata ? 'validator_key'
      AND metadata ->> 'disposition' = 'no_additional_client_information'
      AND NOT metadata ? 'answer'
      AND NOT metadata ? 'client_answer'
      AND NOT metadata ? 'question_text'
      AND NOT metadata ? 'safe_summary'
      AND NOT metadata ? 'raw_value'
    )
  $canon$);
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'::name;

  IF observed IS NULL THEN
    ALTER TABLE kai.upload_lifecycle_audit
      ADD CONSTRAINT upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check
      CHECK (
        operation <> 'client_followup_completed'
        OR (
          jsonb_typeof(metadata) = 'object'
          AND kai.gate_a_p0_jsonb_metadata_only(metadata)
          AND metadata ? 'metadata_only'
          AND metadata ? 'contract'
          AND metadata ? 'claim_id'
          AND metadata ? 'client_followup_item_id'
          AND metadata ? 'gap_log_item_id'
          AND metadata ? 'dimension_key'
          AND metadata ? 'review_queue_item_id'
          AND metadata ? 'previous_queue_status'
          AND metadata ? 'resulting_queue_status'
          AND metadata ? 'previous_review_status'
          AND metadata ? 'resulting_review_status'
          AND metadata ? 'decided_by_role'
          AND metadata ? 'disposition'
          AND metadata ? 'replayed'
          AND metadata ? 'validator_key'
          AND metadata ->> 'disposition' = 'no_additional_client_information'
          AND NOT metadata ? 'answer'
          AND NOT metadata ? 'client_answer'
          AND NOT metadata ? 'question_text'
          AND NOT metadata ? 'safe_summary'
          AND NOT metadata ? 'raw_value'
        )
      ) NOT VALID;
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check;
  ELSE
    IF observed <> canonical_expr THEN
      RAISE EXCEPTION 'P2-11 audit metadata CHECK has unknown definition: %', observed;
    END IF;
  END IF;
END $$;

DO $$
DECLARE
  old_expr text;
  pre_ops text[];
  required_ops text[] := ARRAY[
    'evidence_review_completed',
    'claim_review_completed_internal_approval',
    'coverage_review_decision_accepted_internal_with_limitation',
    'client_followup_completed'
  ]::text[];
  missing_ops text[];
  post_expr text;
  post_ops text[];
  unexpected_ops text[];
  missing_required_ops text[];
  new_expr text;
  p3_01_markers boolean[];
  p3_04_markers boolean[];
  p3_05_markers boolean[];
  p3_09_markers boolean[];
  p3_13_markers boolean[];
  p3_16_markers boolean[];
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
    RAISE EXCEPTION 'shared upload_lifecycle_audit operation CHECK is required';
  END IF;

  pre_ops := pg_temp.kai_recon_ops_from_expr(old_expr);
  IF NOT 'coverage_review_decision_accepted_internal_with_limitation' = ANY (pre_ops) THEN
    RAISE EXCEPTION 'P2-10 audit operation is absent from current shared audit CHECK; reconciliation cannot add it';
  END IF;

  p3_01_markers := ARRAY[
    to_regclass('kai.generation_runs') IS NOT NULL,
    to_regclass('kai.generated_content_drafts') IS NOT NULL,
    to_regclass('kai.generated_content_blocks') IS NOT NULL,
    to_regclass('kai.generated_content_citations') IS NOT NULL,
    pg_temp.kai_recon_constraint_validated('kai.upload_lifecycle_audit'::regclass, 'upload_lifecycle_audit_p3_01_metadata_object_check'),
    pg_temp.kai_recon_constraint_validated(to_regclass('kai.generation_runs'), 'generation_runs_p3_01_identity_unique'),
    pg_temp.kai_recon_constraint_validated(to_regclass('kai.generated_content_drafts'), 'generated_content_drafts_p3_01_run_unique'),
    pg_temp.kai_recon_constraint_validated(to_regclass('kai.generated_content_blocks'), 'generated_content_blocks_p3_01_identity_unique'),
    pg_temp.kai_recon_constraint_validated(to_regclass('kai.generated_content_citations'), 'generated_content_citations_p3_01_identity_unique')
  ];
  IF true = ANY (p3_01_markers) AND NOT (SELECT bool_and(marker) FROM unnest(p3_01_markers) AS marker) THEN
    RAISE EXCEPTION 'P3-01 generated-content draft contract markers are partial/contradictory';
  END IF;
  IF (SELECT bool_and(marker) FROM unnest(p3_01_markers) AS marker) THEN
    required_ops := required_ops || ARRAY['generated_content_draft_created']::text[];
  END IF;

  p3_04_markers := ARRAY[
    pg_temp.kai_recon_constraint_validated('kai.review_queue_items'::regclass, 'review_queue_items_p3_04_generated_content_review_contract_check'),
    pg_temp.kai_recon_constraint_validated('kai.upload_lifecycle_audit'::regclass, 'upload_lifecycle_audit_p3_04_metadata_object_check')
  ];
  IF true = ANY (p3_04_markers) AND NOT (SELECT bool_and(marker) FROM unnest(p3_04_markers) AS marker) THEN
    RAISE EXCEPTION 'P3-04 generated-content review contract markers are partial/contradictory';
  END IF;
  IF (SELECT bool_and(marker) FROM unnest(p3_04_markers) AS marker) THEN
    required_ops := required_ops || ARRAY['generated_content_review_completed']::text[];
  END IF;

  p3_05_markers := ARRAY[
    pg_temp.kai_recon_constraint_validated('kai.review_queue_items'::regclass, 'review_queue_items_p3_05_export_review_contract_check')
      OR pg_temp.kai_recon_constraint_validated('kai.review_queue_items'::regclass, 'review_queue_items_p3_09_export_review_contract_check')
      OR pg_temp.kai_recon_constraint_validated('kai.review_queue_items'::regclass, 'review_queue_items_p3_13_export_review_contract_check'),
    pg_temp.kai_recon_constraint_validated('kai.upload_lifecycle_audit'::regclass, 'upload_lifecycle_audit_p3_05_metadata_object_check'),
    pg_temp.kai_recon_index_exists('kai', 'ux_review_queue_items_p3_05_export_review_identity')
  ];
  IF true = ANY (p3_05_markers) AND NOT (SELECT bool_and(marker) FROM unnest(p3_05_markers) AS marker) THEN
    RAISE EXCEPTION 'P3-05 export-review request contract markers are partial/contradictory';
  END IF;
  IF (SELECT bool_and(marker) FROM unnest(p3_05_markers) AS marker) THEN
    required_ops := required_ops || ARRAY['export_review_requested']::text[];
  END IF;

  p3_09_markers := ARRAY[
    pg_temp.kai_recon_constraint_validated('kai.review_queue_items'::regclass, 'review_queue_items_p3_09_export_review_contract_check')
      OR pg_temp.kai_recon_constraint_validated('kai.review_queue_items'::regclass, 'review_queue_items_p3_13_export_review_contract_check'),
    pg_temp.kai_recon_constraint_validated('kai.upload_lifecycle_audit'::regclass, 'upload_lifecycle_audit_p3_09_metadata_object_check'),
    pg_temp.kai_recon_index_exists('kai', 'ux_review_queue_items_p3_05_export_review_identity')
  ];
  IF true = ANY (p3_09_markers) AND NOT (SELECT bool_and(marker) FROM unnest(p3_09_markers) AS marker) THEN
    RAISE EXCEPTION 'P3-09 export-review start contract markers are partial/contradictory';
  END IF;
  IF (SELECT bool_and(marker) FROM unnest(p3_09_markers) AS marker) THEN
    required_ops := required_ops || ARRAY['export_review_started']::text[];
  END IF;

  p3_13_markers := ARRAY[
    pg_temp.kai_recon_constraint_validated('kai.review_queue_items'::regclass, 'review_queue_items_p3_13_export_review_contract_check'),
    pg_temp.kai_recon_constraint_validated('kai.upload_lifecycle_audit'::regclass, 'upload_lifecycle_audit_p3_13_metadata_object_check'),
    pg_temp.kai_recon_index_exists('kai', 'ux_review_queue_items_p3_05_export_review_identity')
  ];
  IF true = ANY (p3_13_markers) AND NOT (SELECT bool_and(marker) FROM unnest(p3_13_markers) AS marker) THEN
    RAISE EXCEPTION 'P3-13 export-review completion contract markers are partial/contradictory';
  END IF;
  IF (SELECT bool_and(marker) FROM unnest(p3_13_markers) AS marker) THEN
    required_ops := required_ops || ARRAY['export_review_completed']::text[];
  END IF;

  p3_16_markers := ARRAY[
    to_regclass('kai.limitation_snapshots') IS NOT NULL,
    to_regclass('kai.limitation_snapshot_entries') IS NOT NULL,
    to_regclass('kai.export_candidates') IS NOT NULL,
    pg_temp.kai_recon_constraint_validated('kai.upload_lifecycle_audit'::regclass, 'upload_lifecycle_audit_p3_16_limitation_snapshot_metadata_check'),
    pg_temp.kai_recon_constraint_validated('kai.upload_lifecycle_audit'::regclass, 'upload_lifecycle_audit_p3_16_export_candidate_metadata_check'),
    pg_temp.kai_recon_constraint_validated(to_regclass('kai.limitation_snapshots'), 'limitation_snapshots_p3_16_supersedes_fk'),
    pg_temp.kai_recon_constraint_validated(to_regclass('kai.export_candidates'), 'export_candidates_p3_16_snapshot_fk')
  ];
  IF true = ANY (p3_16_markers) AND NOT (SELECT bool_and(marker) FROM unnest(p3_16_markers) AS marker) THEN
    RAISE EXCEPTION 'P3-16 export-candidate foundation markers are partial/contradictory';
  END IF;
  IF (SELECT bool_and(marker) FROM unnest(p3_16_markers) AS marker) THEN
    required_ops := required_ops || ARRAY['limitation_snapshot_confirmed', 'export_candidate_created']::text[];
  END IF;

  SELECT array_agg(DISTINCT op ORDER BY op)
    INTO required_ops
    FROM unnest(required_ops) AS op;

  SELECT array_agg(required_op ORDER BY required_op)
    INTO missing_ops
    FROM unnest(required_ops) required_op
   WHERE NOT required_op = ANY (pre_ops);

  IF missing_ops IS NOT NULL AND cardinality(missing_ops) > 0 THEN
    new_expr := format('(%s) OR operation = ANY (%L::text[])', old_expr, missing_ops);
    EXECUTE format(
      'ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon CHECK (%s) NOT VALID',
      new_expr
    );
    ALTER TABLE kai.upload_lifecycle_audit
      VALIDATE CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon;
    ALTER TABLE kai.upload_lifecycle_audit
      DROP CONSTRAINT upload_lifecycle_audit_gate_a_operation_check;
    ALTER TABLE kai.upload_lifecycle_audit
      RENAME CONSTRAINT upload_lifecycle_audit_gate_a_operation_check_recon
      TO upload_lifecycle_audit_gate_a_operation_check;
  ELSE
    missing_ops := ARRAY[]::text[];
  END IF;

  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO post_expr
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_gate_a_operation_check';

  post_ops := pg_temp.kai_recon_ops_from_expr(post_expr);

  SELECT array_agg(op ORDER BY op)
    INTO missing_required_ops
    FROM unnest(pre_ops || missing_ops) AS op
   WHERE NOT op = ANY (post_ops);
  IF missing_required_ops IS NOT NULL THEN
    RAISE EXCEPTION 'post-reconciliation audit operation CHECK lost required operations: %', missing_required_ops;
  END IF;

  SELECT array_agg(op ORDER BY op)
    INTO unexpected_ops
    FROM unnest(post_ops) AS op
   WHERE NOT op = ANY (pre_ops || missing_ops);
  IF unexpected_ops IS NOT NULL THEN
    RAISE EXCEPTION 'post-reconciliation audit operation CHECK introduced unexpected operations: %', unexpected_ops;
  END IF;
END $$;

COMMIT;
