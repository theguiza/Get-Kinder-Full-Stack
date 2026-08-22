BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.kai_recon_norm(def text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(coalesce(def, ''), '\s+', '', 'g')
$$;

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
  observed text;
  observed_norm text;
  stale_norm text := pg_temp.kai_recon_norm('(support_strength = ''unassessed''::text)');
  canonical_norm text := pg_temp.kai_recon_norm('(support_strength = ANY (ARRAY[''unassessed''::text, ''reviewed_supported''::text]))');
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'evidence_items'
     AND c.conname = 'evidence_items_p2_01_support_strength_check';

  observed_norm := pg_temp.kai_recon_norm(observed);
  IF observed_norm = canonical_norm THEN
    RETURN;
  END IF;
  IF observed_norm <> stale_norm THEN
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
  observed_norm text;
  stale_norm text := pg_temp.kai_recon_norm('(claim_strength = ''unassessed''::text)');
  canonical_norm text := pg_temp.kai_recon_norm('(claim_strength = ANY (ARRAY[''unassessed''::text, ''reviewed_supported''::text]))');
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'claims'
     AND c.conname = 'claims_p2_03_claim_strength_check';

  observed_norm := pg_temp.kai_recon_norm(observed);
  IF observed_norm = canonical_norm THEN
    RETURN;
  END IF;
  IF observed_norm <> stale_norm THEN
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
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check';

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
  ELSIF observed NOT LIKE '%evidence_review_completed%'
     OR observed NOT LIKE '%metadata_only%'
     OR observed NOT LIKE '%contract%'
     OR observed NOT LIKE '%evidence_item_id%'
     OR observed NOT LIKE '%review_queue_item_id%'
     OR observed NOT LIKE '%previous_queue_status%'
     OR observed NOT LIKE '%resulting_queue_status%'
     OR observed NOT LIKE '%previous_review_status%'
     OR observed NOT LIKE '%resulting_review_status%'
     OR observed NOT LIKE '%previous_support_strength%'
     OR observed NOT LIKE '%resulting_support_strength%'
     OR observed NOT LIKE '%validator_key%' THEN
    RAISE EXCEPTION 'P2-09 evidence-review audit metadata CHECK has unknown definition: %', observed;
  END IF;
END $$;

DO $$
DECLARE
  observed text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check';

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
  ELSIF observed NOT LIKE '%claim_review_completed_internal_approval%'
     OR observed NOT LIKE '%metadata_only%'
     OR observed NOT LIKE '%contract%'
     OR observed NOT LIKE '%claim_id%'
     OR observed NOT LIKE '%evidence_item_id%'
     OR observed NOT LIKE '%review_queue_item_id%'
     OR observed NOT LIKE '%previous_queue_status%'
     OR observed NOT LIKE '%resulting_queue_status%'
     OR observed NOT LIKE '%previous_review_status%'
     OR observed NOT LIKE '%resulting_review_status%'
     OR observed NOT LIKE '%previous_claim_strength%'
     OR observed NOT LIKE '%resulting_claim_strength%'
     OR observed NOT LIKE '%validator_key%' THEN
    RAISE EXCEPTION 'P2-09 claim-review audit metadata CHECK has unknown definition: %', observed;
  END IF;
END $$;

DO $$
DECLARE
  observed text;
  has_canonical_shape boolean;
  has_stale_shape boolean;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'review_queue_items'
     AND c.conname = 'review_queue_items_p2_04_client_followup_contract_check';

  has_canonical_shape :=
    observed LIKE '%queue_type <> ''client_followup''%'
    AND observed LIKE '%target_object_type = ''client_followup_item''%'
    AND observed LIKE '%priority = ''medium''%'
    AND observed LIKE '%summary = ''Client clarification is required for an unresolved claim gap.''%'
    AND observed LIKE '%assigned_to IS NULL%'
    AND observed LIKE '%due_at IS NULL%'
    AND observed LIKE '%Confirm the business meaning of the unresolved field or measure.%'
    AND observed LIKE '%Confirm the denominator and how it is calculated.%'
    AND observed LIKE '%Confirm the reporting period represented by this source.%'
    AND observed LIKE '%Confirm the entity level represented by the unresolved field or measure.%'
    AND observed LIKE '%queue_status = ''waiting_on_client''%'
    AND observed LIKE '%review_status = ''proposed''%'
    AND observed LIKE '%queue_status = ''resolved''%'
    AND observed LIKE '%review_status = ''resolved''%';
  has_stale_shape :=
    observed LIKE '%queue_type <> ''client_followup''%'
    AND observed LIKE '%target_object_type = ''client_followup_item''%'
    AND observed LIKE '%priority = ''medium''%'
    AND observed LIKE '%summary = ''Client clarification is required for an unresolved claim gap.''%'
    AND observed LIKE '%assigned_to IS NULL%'
    AND observed LIKE '%due_at IS NULL%'
    AND observed LIKE '%Confirm the business meaning of the unresolved field or measure.%'
    AND observed LIKE '%Confirm the denominator and how it is calculated.%'
    AND observed LIKE '%Confirm the reporting period represented by this source.%'
    AND observed LIKE '%Confirm the entity level represented by the unresolved field or measure.%'
    AND observed LIKE '%queue_status = ''waiting_on_client''%'
    AND observed LIKE '%review_status = ''proposed''%'
    AND observed NOT LIKE '%queue_status = ''resolved''%'
    AND observed NOT LIKE '%review_status = ''resolved''%';

  IF has_canonical_shape THEN
    RETURN;
  END IF;
  IF NOT has_stale_shape THEN
    RAISE EXCEPTION 'P2-11 client-followup queue CHECK has unknown definition: %', observed;
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
END $$;

DO $$
DECLARE
  observed text;
BEGIN
  SELECT pg_get_expr(c.conbin, c.conrelid)
    INTO observed
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
     AND r.relname = 'upload_lifecycle_audit'
     AND c.conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check';

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
  ELSIF observed NOT LIKE '%client_followup_completed%'
     OR observed NOT LIKE '%metadata_only%'
     OR observed NOT LIKE '%contract%'
     OR observed NOT LIKE '%claim_id%'
     OR observed NOT LIKE '%client_followup_item_id%'
     OR observed NOT LIKE '%gap_log_item_id%'
     OR observed NOT LIKE '%dimension_key%'
     OR observed NOT LIKE '%review_queue_item_id%'
     OR observed NOT LIKE '%previous_queue_status%'
     OR observed NOT LIKE '%resulting_queue_status%'
     OR observed NOT LIKE '%previous_review_status%'
     OR observed NOT LIKE '%resulting_review_status%'
     OR observed NOT LIKE '%decided_by_role%'
     OR observed NOT LIKE '%disposition%'
     OR observed NOT LIKE '%replayed%'
     OR observed NOT LIKE '%validator_key%'
     OR observed NOT LIKE '%no_additional_client_information%'
     OR observed NOT LIKE '%NOT (metadata ? ''answer''%'
     OR observed NOT LIKE '%NOT (metadata ? ''client_answer''%'
     OR observed NOT LIKE '%NOT (metadata ? ''question_text''%'
     OR observed NOT LIKE '%NOT (metadata ? ''safe_summary''%'
     OR observed NOT LIKE '%NOT (metadata ? ''raw_value''%' THEN
    RAISE EXCEPTION 'P2-11 audit metadata CHECK has unknown definition: %', observed;
  END IF;
END $$;

DO $$
DECLARE
  old_expr text;
  missing_ops text[];
  pre_ops text[];
  new_expr text;
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
    RAISE EXCEPTION 'shared upload_lifecycle_audit operation CHECK is required';
  END IF;

  SELECT array_agg(DISTINCT op ORDER BY op)
    INTO pre_ops
    FROM (
      SELECT regexp_split_to_table(
               CASE WHEN m[1] LIKE '{%' THEN trim(both '{}' from m[1]) ELSE m[1] END,
               CASE WHEN m[1] LIKE '{%' THEN ',' ELSE E'\\x1f' END
             ) AS op
        FROM regexp_matches(old_expr, '''([^'']+)''', 'g') AS m
    ) ops;

  IF pre_ops IS NULL OR cardinality(pre_ops) = 0 THEN
    RAISE EXCEPTION 'could not prove pre-reconciliation audit operation vocabulary from %', old_expr;
  END IF;

  IF NOT ARRAY['generated_content_draft_created', 'generated_content_review_completed', 'export_review_requested', 'export_review_started', 'export_review_completed', 'limitation_snapshot_confirmed', 'export_candidate_created']::text[] <@ pre_ops THEN
    RAISE EXCEPTION 'later/P3 audit operations are not all present in the current shared audit CHECK: %', old_expr;
  END IF;
  IF NOT 'coverage_review_decision_accepted_internal_with_limitation' = ANY (pre_ops) THEN
    RAISE EXCEPTION 'P2-10 audit operation is absent from current shared audit CHECK; reconciliation cannot add it';
  END IF;

  SELECT array_agg(required_op ORDER BY required_op)
    INTO missing_ops
    FROM unnest(ARRAY[
      'evidence_review_completed',
      'claim_review_completed_internal_approval',
      'client_followup_completed'
    ]::text[]) required_op
   WHERE NOT required_op = ANY (pre_ops);

  IF missing_ops IS NULL OR cardinality(missing_ops) = 0 THEN
    RETURN;
  END IF;

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

  EXECUTE format('SELECT bool_and(%s) FROM unnest($1::text[]) AS probe(operation)', new_expr)
    INTO preserved
    USING pre_ops || missing_ops;
  IF preserved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'post-reconciliation audit operation CHECK did not preserve the expected vocabulary';
  END IF;
END $$;

COMMIT;
