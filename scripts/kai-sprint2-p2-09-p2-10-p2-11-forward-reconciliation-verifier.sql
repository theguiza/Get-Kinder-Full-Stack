WITH constraint_defs AS (
  SELECT n.nspname, r.relname, c.conname, c.contype, c.convalidated,
         pg_get_expr(c.conbin, c.conrelid) AS observed_definition,
         pg_get_constraintdef(c.oid) AS constraint_definition
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE n.nspname = 'kai'
),
norm_defs AS (
  SELECT *, regexp_replace(coalesce(observed_definition, constraint_definition, ''), '\s+', '', 'g') AS norm_definition
    FROM constraint_defs
),
audit_expr AS (
  SELECT observed_definition
    FROM norm_defs
   WHERE relname = 'upload_lifecycle_audit'
     AND conname = 'upload_lifecycle_audit_gate_a_operation_check'
),
audit_ops AS (
  SELECT array_agg(DISTINCT op ORDER BY op) AS operations
    FROM (
      SELECT regexp_split_to_table(
               CASE WHEN m[1] LIKE '{%' THEN trim(both '{}' from m[1]) ELSE m[1] END,
               CASE WHEN m[1] LIKE '{%' THEN ',' ELSE E'\\x1f' END
             ) AS op
        FROM audit_expr, regexp_matches(observed_definition, '''([^'']+)''', 'g') AS m
    ) parsed
   WHERE op <> ''
),
priority_column AS (
  SELECT ty.oid AS type_oid,
         tyn.nspname AS type_schema,
         ty.typname AS type_name,
         ty.typtype::text AS typtype,
         a.attnotnull AS not_null,
         pg_get_expr(d.adbin, d.adrelid) AS default_expr
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
     AND NOT a.attisdropped
),
priority_enum_labels AS (
  SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
    FROM priority_column pc
    JOIN pg_enum e
      ON e.enumtypid = pc.type_oid
),
priority_check AS (
  SELECT observed_definition,
         convalidated
    FROM norm_defs
   WHERE relname = 'review_queue_items'
     AND conname = 'review_queue_items_p1_06_priority_check'
),
priority_check_literals AS (
  SELECT array_agg(m[1] ORDER BY m[1]) AS literals,
         count(*)::int AS literal_count
    FROM priority_check pc
    CROSS JOIN LATERAL regexp_matches(
      pc.observed_definition,
      '''([^'']+)''',
      'g'
    ) AS m
),
priority_shape AS (
  SELECT CASE
           WHEN pc.type_schema = 'pg_catalog'
            AND pc.type_name = 'text'
            AND pc.typtype = 'b'
           THEN
             pc.not_null
             AND pc.default_expr = '''medium''::text'
             AND EXISTS (
               SELECT 1
                 FROM priority_check
                WHERE convalidated
                  AND observed_definition LIKE '(priority = ANY (ARRAY[%'
             )
             AND COALESCE(
               (SELECT literal_count FROM priority_check_literals),
               0
             ) = 8
             AND (SELECT literals FROM priority_check_literals) = ARRAY[
               'backlog',
               'high',
               'immediate_fix',
               'low',
               'mandatory',
               'medium',
               'not_applicable',
               'unknown'
             ]::text[]

           WHEN pc.type_schema = 'kai'
            AND pc.type_name = 'priority_enum'
            AND pc.typtype = 'e'
           THEN
             pc.not_null
             AND pc.default_expr = '''medium''::kai.priority_enum'
             AND (SELECT labels FROM priority_enum_labels) = ARRAY[
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
               NOT EXISTS (SELECT 1 FROM priority_check)
               OR (
                 EXISTS (
                   SELECT 1
                     FROM priority_check
                    WHERE convalidated
                      AND observed_definition LIKE '(priority = ANY (ARRAY[%'
                 )
                 AND COALESCE(
                   (SELECT literal_count FROM priority_check_literals),
                   0
                 ) = 8
                 AND (SELECT literals FROM priority_check_literals) = ARRAY[
                   'backlog',
                   'high',
                   'immediate_fix',
                   'low',
                   'mandatory',
                   'medium',
                   'not_applicable',
                   'unknown'
                 ]::text[]
               )
             )

           ELSE false
         END AS supported
    FROM priority_column pc
),
p2_11_expr AS (
  SELECT observed_definition,
         convalidated
    FROM norm_defs
   WHERE relname = 'review_queue_items'
     AND conname = 'review_queue_items_p2_04_client_followup_contract_check'
),
p2_11_lifecycle_pairs AS (
  SELECT m[1] AS queue_status,
         m[2] AS review_status
    FROM p2_11_expr e
    CROSS JOIN LATERAL regexp_matches(
      e.observed_definition,
      '\(queue_status = ''([^'']+)''::text\) AND \(review_status = ''([^'']+)''::text\)',
      'g'
    ) AS m
),
p2_11_required_action_array AS (
  SELECT (
           regexp_match(
             e.observed_definition,
             'required_action = ANY \(ARRAY\[([^]]*)\]\)'
           )
         )[1] AS array_body
    FROM p2_11_expr e
),
p2_11_required_actions AS (
  SELECT m[1] AS required_action
    FROM p2_11_required_action_array a
    CROSS JOIN LATERAL regexp_matches(
      COALESCE(a.array_body, ''),
      '''([^'']+)''::text',
      'g'
    ) AS m
),
p2_11_semantics AS (
  SELECT (
    (SELECT count(*) FROM p2_11_expr) = 1

    AND COALESCE(
      (SELECT convalidated FROM p2_11_expr),
      false
    )

    AND COALESCE(
      (SELECT supported FROM priority_shape),
      false
    )

    AND COALESCE((
      SELECT
        observed_definition LIKE
          '%(queue_type <> ''client_followup''::text)%'
        AND observed_definition LIKE
          '%(target_object_type = ''client_followup_item''::text)%'
        AND (
          observed_definition LIKE
            '%(priority = ''medium''::text)%'
          OR observed_definition LIKE
            '%(priority = ''medium''::kai.priority_enum)%'
        )
        AND observed_definition LIKE
          '%(summary = ''Client clarification is required for an unresolved claim gap.''::text)%'
        AND observed_definition LIKE
          '%(assigned_to IS NULL)%'
        AND observed_definition LIKE
          '%(due_at IS NULL)%'
        AND observed_definition LIKE
          '%required_action = ANY (ARRAY[%'
        FROM p2_11_expr
    ), false)

    AND (SELECT count(*) FROM p2_11_lifecycle_pairs) = 2

    AND EXISTS (
      SELECT 1
        FROM p2_11_lifecycle_pairs
       WHERE queue_status = 'waiting_on_client'
         AND review_status = 'proposed'
    )

    AND EXISTS (
      SELECT 1
        FROM p2_11_lifecycle_pairs
       WHERE queue_status = 'resolved'
         AND review_status = 'resolved'
    )

    AND NOT EXISTS (
      SELECT 1
        FROM p2_11_lifecycle_pairs
       WHERE NOT (
         (queue_status = 'waiting_on_client' AND review_status = 'proposed')
         OR
         (queue_status = 'resolved' AND review_status = 'resolved')
       )
    )

    AND (
      SELECT count(*)
        FROM p2_11_expr e
        CROSS JOIN LATERAL regexp_matches(
          e.observed_definition,
          '\(queue_status = ''[^'']+''::text\)',
          'g'
        ) AS m
    ) = 2

    AND (
      SELECT count(*)
        FROM p2_11_expr e
        CROSS JOIN LATERAL regexp_matches(
          e.observed_definition,
          '\(review_status = ''[^'']+''::text\)',
          'g'
        ) AS m
    ) = 2

    AND (SELECT count(*) FROM p2_11_required_actions) = 4

    AND (
      SELECT count(DISTINCT required_action)
        FROM p2_11_required_actions
    ) = 4

    AND NOT EXISTS (
      SELECT 1
        FROM p2_11_required_actions
       WHERE required_action <> ALL (ARRAY[
         'Confirm the business meaning of the unresolved field or measure.',
         'Confirm the denominator and how it is calculated.',
         'Confirm the reporting period represented by this source.',
         'Confirm the entity level represented by the unresolved field or measure.'
       ]::text[])
    )
  ) AS pass
),
p3_contracts AS (
  SELECT 'p3_01_installed_contract_operation_consistent' AS check_name,
         'P3-01 generated-content draft markers either absent together or installed with generated_content_draft_created accepted' AS detail,
         ARRAY['generated_content_draft_created']::text[] AS operations,
         ARRAY[
           to_regclass('kai.generation_runs') IS NOT NULL,
           to_regclass('kai.generated_content_drafts') IS NOT NULL,
           to_regclass('kai.generated_content_blocks') IS NOT NULL,
           to_regclass('kai.generated_content_citations') IS NOT NULL,
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'upload_lifecycle_audit' AND conname = 'upload_lifecycle_audit_p3_01_metadata_object_check' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'generation_runs' AND conname = 'generation_runs_p3_01_identity_unique' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'generated_content_drafts' AND conname = 'generated_content_drafts_p3_01_run_unique' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'generated_content_blocks' AND conname = 'generated_content_blocks_p3_01_identity_unique' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'generated_content_citations' AND conname = 'generated_content_citations_p3_01_identity_unique' AND convalidated)
         ] AS markers
  UNION ALL
  SELECT 'p3_04_installed_contract_operation_consistent',
         'P3-04 generated-content-review markers either absent together or installed with generated_content_review_completed accepted',
         ARRAY['generated_content_review_completed']::text[],
         ARRAY[
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'review_queue_items' AND conname = 'review_queue_items_p3_04_generated_content_review_contract_check' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'upload_lifecycle_audit' AND conname = 'upload_lifecycle_audit_p3_04_metadata_object_check' AND convalidated)
         ]
  UNION ALL
  SELECT 'p3_05_installed_contract_operation_consistent',
         'P3-05 export-review-request markers either absent together or installed with export_review_requested accepted',
         ARRAY['export_review_requested']::text[],
         ARRAY[
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'review_queue_items' AND conname IN ('review_queue_items_p3_05_export_review_contract_check', 'review_queue_items_p3_09_export_review_contract_check', 'review_queue_items_p3_13_export_review_contract_check') AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'upload_lifecycle_audit' AND conname = 'upload_lifecycle_audit_p3_05_metadata_object_check' AND convalidated),
           EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'kai' AND indexname = 'ux_review_queue_items_p3_05_export_review_identity')
         ]
  UNION ALL
  SELECT 'p3_09_installed_contract_operation_consistent',
         'P3-09 export-review-start markers either absent together or installed with export_review_started accepted',
         ARRAY['export_review_started']::text[],
         ARRAY[
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'review_queue_items' AND conname IN ('review_queue_items_p3_09_export_review_contract_check', 'review_queue_items_p3_13_export_review_contract_check') AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'upload_lifecycle_audit' AND conname = 'upload_lifecycle_audit_p3_09_metadata_object_check' AND convalidated),
           EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'kai' AND indexname = 'ux_review_queue_items_p3_05_export_review_identity')
         ]
  UNION ALL
  SELECT 'p3_13_installed_contract_operation_consistent',
         'P3-13 export-review-completion markers either absent together or installed with export_review_completed accepted',
         ARRAY['export_review_completed']::text[],
         ARRAY[
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'review_queue_items' AND conname = 'review_queue_items_p3_13_export_review_contract_check' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'upload_lifecycle_audit' AND conname = 'upload_lifecycle_audit_p3_13_metadata_object_check' AND convalidated),
           EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'kai' AND indexname = 'ux_review_queue_items_p3_05_export_review_identity')
         ]
  UNION ALL
  SELECT 'p3_16_installed_contract_operation_consistent',
         'P3-16 export-candidate foundation markers either absent together or installed with both P3-16 audit operations accepted',
         ARRAY['limitation_snapshot_confirmed', 'export_candidate_created']::text[],
         ARRAY[
           to_regclass('kai.limitation_snapshots') IS NOT NULL,
           to_regclass('kai.limitation_snapshot_entries') IS NOT NULL,
           to_regclass('kai.export_candidates') IS NOT NULL,
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'upload_lifecycle_audit' AND conname = 'upload_lifecycle_audit_p3_16_limitation_snapshot_metadata_check' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'upload_lifecycle_audit' AND conname = 'upload_lifecycle_audit_p3_16_export_candidate_metadata_check' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'limitation_snapshots' AND conname = 'limitation_snapshots_p3_16_supersedes_fk' AND convalidated),
           EXISTS (SELECT 1 FROM norm_defs WHERE relname = 'export_candidates' AND conname = 'export_candidates_p3_16_snapshot_fk' AND convalidated)
         ]
),
p3_expected AS (
  SELECT check_name, detail, operations, markers,
         (SELECT bool_or(marker) FROM unnest(markers) AS marker) AS any_marker,
         (SELECT bool_and(marker) FROM unnest(markers) AS marker) AS all_markers
    FROM p3_contracts
),
expected AS (
  SELECT 'evidence_support_strength_check_canonical' AS check_name,
         'kai.evidence_items.support_strength admits unassessed and reviewed_supported only' AS detail,
         (SELECT observed_definition FROM norm_defs WHERE relname = 'evidence_items' AND conname = 'evidence_items_p2_01_support_strength_check') AS observed_definition,
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE relname = 'evidence_items'
              AND conname = 'evidence_items_p2_01_support_strength_check'
              AND norm_definition = '(support_strength=ANY(ARRAY[''unassessed''::text,''reviewed_supported''::text]))'
         ) AS pass
  UNION ALL
  SELECT 'claim_strength_check_canonical',
         'kai.claims.claim_strength admits unassessed and reviewed_supported only',
         (SELECT observed_definition FROM norm_defs WHERE relname = 'claims' AND conname = 'claims_p2_03_claim_strength_check'),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE relname = 'claims'
              AND conname = 'claims_p2_03_claim_strength_check'
              AND norm_definition = '(claim_strength=ANY(ARRAY[''unassessed''::text,''reviewed_supported''::text]))'
         )
  UNION ALL
  SELECT 'p2_09_evidence_metadata_check_canonical',
         'P2-09 evidence-review audit metadata CHECK is present, validated, and canonical',
         (SELECT observed_definition FROM norm_defs WHERE conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'::name),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'::name
              AND convalidated
              AND observed_definition = '((operation <> ''evidence_review_completed''::text) OR ((jsonb_typeof(metadata) = ''object''::text) AND kai.gate_a_p0_jsonb_metadata_only(metadata) AND (metadata ? ''metadata_only''::text) AND (metadata ? ''contract''::text) AND (metadata ? ''evidence_item_id''::text) AND (metadata ? ''review_queue_item_id''::text) AND (metadata ? ''previous_queue_status''::text) AND (metadata ? ''resulting_queue_status''::text) AND (metadata ? ''previous_review_status''::text) AND (metadata ? ''resulting_review_status''::text) AND (metadata ? ''previous_support_strength''::text) AND (metadata ? ''resulting_support_strength''::text) AND (metadata ? ''validator_key''::text)))'
         )
  UNION ALL
  SELECT 'p2_09_claim_metadata_check_canonical',
         'P2-09 claim-review audit metadata CHECK is present, validated, and canonical',
         (SELECT observed_definition FROM norm_defs WHERE conname = 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'::name),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE conname = 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'::name
              AND convalidated
              AND observed_definition = '((operation <> ''claim_review_completed_internal_approval''::text) OR ((jsonb_typeof(metadata) = ''object''::text) AND kai.gate_a_p0_jsonb_metadata_only(metadata) AND (metadata ? ''metadata_only''::text) AND (metadata ? ''contract''::text) AND (metadata ? ''claim_id''::text) AND (metadata ? ''evidence_item_id''::text) AND (metadata ? ''review_queue_item_id''::text) AND (metadata ? ''previous_queue_status''::text) AND (metadata ? ''resulting_queue_status''::text) AND (metadata ? ''previous_review_status''::text) AND (metadata ? ''resulting_review_status''::text) AND (metadata ? ''previous_claim_strength''::text) AND (metadata ? ''resulting_claim_strength''::text) AND (metadata ? ''validator_key''::text)))'
         )
  UNION ALL
  SELECT 'p2_10_table_exists',
         'to_regclass(''kai.coverage_review_decisions'') IS NOT NULL',
         to_regclass('kai.coverage_review_decisions')::text,
         to_regclass('kai.coverage_review_decisions') IS NOT NULL
  UNION ALL
  SELECT 'p2_10_columns_types_not_null_canonical',
         'P2-10 required columns, types, and NOT NULL contracts match the canonical repository definition',
         string_agg(column_name || ':' || data_type || ':' || is_nullable, ', ' ORDER BY ordinal_position),
         count(*) = 10
         AND bool_and(
           CASE column_name
             WHEN 'coverage_review_decision_id' THEN data_type = 'uuid' AND is_nullable = 'NO'
             WHEN 'organization_id' THEN data_type = 'uuid' AND is_nullable = 'NO'
             WHEN 'claim_id' THEN data_type = 'uuid' AND is_nullable = 'NO'
             WHEN 'dimension_key' THEN data_type = 'text' AND is_nullable = 'NO'
             WHEN 'decision' THEN data_type = 'text' AND is_nullable = 'NO'
             WHEN 'state_fingerprint' THEN data_type = 'text' AND is_nullable = 'NO'
             WHEN 'decided_by' THEN data_type = 'uuid' AND is_nullable = 'NO'
             WHEN 'decided_by_role' THEN data_type = 'text' AND is_nullable = 'NO'
             WHEN 'created_by_type' THEN data_type = 'text' AND is_nullable = 'NO'
             WHEN 'created_at' THEN data_type = 'timestamp with time zone' AND is_nullable = 'NO'
             ELSE false
           END
         )
    FROM information_schema.columns
   WHERE table_schema = 'kai'
     AND table_name = 'coverage_review_decisions'
     AND column_name IN (
       'coverage_review_decision_id', 'organization_id', 'claim_id', 'dimension_key',
       'decision', 'state_fingerprint', 'decided_by', 'decided_by_role',
       'created_by_type', 'created_at'
     )
  UNION ALL
  SELECT 'p2_10_constraints_canonical',
         'P2-10 CHECK, FK, and unique constraints are present',
         string_agg(conname || ':' || contype::text, ', ' ORDER BY conname),
         count(*) FILTER (WHERE conname IN (
           'coverage_review_decisions_p2_10_id_org_unique',
           'coverage_review_decisions_p2_10_identity_fingerprint_unique',
           'coverage_review_decisions_p2_10_claim_fk',
           'coverage_review_decisions_p2_10_gap_fk',
           'coverage_review_decisions_p2_10_dimension_key_check',
           'coverage_review_decisions_p2_10_decision_check',
           'coverage_review_decisions_p2_10_state_fingerprint_check',
           'coverage_review_decisions_p2_10_decided_by_role_check',
           'coverage_review_decisions_p2_10_created_by_type_check'
         )) = 9
    FROM constraint_defs
   WHERE relname = 'coverage_review_decisions'
  UNION ALL
  SELECT 'p2_10_index_canonical',
         'P2-10 tenant/claim index is present',
         (SELECT indexdef FROM pg_indexes WHERE schemaname = 'kai' AND indexname = 'ix_coverage_review_decisions_p2_10_tenant_claim'),
         EXISTS (
           SELECT 1 FROM pg_indexes
            WHERE schemaname = 'kai'
              AND tablename = 'coverage_review_decisions'
              AND indexname = 'ix_coverage_review_decisions_p2_10_tenant_claim'
              AND indexdef LIKE '%(organization_id, claim_id)%'
         )
  UNION ALL
  SELECT 'p2_10_append_only_trigger_enabled',
         'P2-10 append-only trigger is present and enabled',
         (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'kai' AND r.relname = 'coverage_review_decisions' AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'),
         EXISTS (
           SELECT 1 FROM pg_trigger t
           JOIN pg_class r ON r.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           WHERE n.nspname = 'kai'
             AND r.relname = 'coverage_review_decisions'
             AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'
             AND t.tgenabled = 'O'
             AND pg_get_triggerdef(t.oid) LIKE '%kai.p2_10_reject_coverage_decision_mutation()%'
         )
  UNION ALL
  SELECT 'p2_10_decision_vocabulary_canonical',
         'P2-10 decision vocabulary is exactly accepted_internal_with_limitation',
         (SELECT observed_definition FROM norm_defs WHERE relname = 'coverage_review_decisions' AND conname = 'coverage_review_decisions_p2_10_decision_check'),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE relname = 'coverage_review_decisions'
              AND conname = 'coverage_review_decisions_p2_10_decision_check'
              AND norm_definition = '(decision=''accepted_internal_with_limitation''::text)'
         )
  UNION ALL
  SELECT 'p2_10_metadata_check_canonical',
         'P2-10 metadata audit contract is present, validated, and canonical',
         (SELECT observed_definition FROM norm_defs WHERE conname = 'upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check'::name),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE conname = 'upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check'::name
              AND convalidated
              AND observed_definition = '((operation <> ''coverage_review_decision_accepted_internal_with_limitation''::text) OR ((jsonb_typeof(metadata) = ''object''::text) AND kai.gate_a_p0_jsonb_metadata_only(metadata) AND (metadata ? ''metadata_only''::text) AND (metadata ? ''contract''::text) AND (metadata ? ''claim_id''::text) AND (metadata ? ''dimension_key''::text) AND (metadata ? ''decision''::text) AND (metadata ? ''decided_by_role''::text) AND (metadata ? ''state_fingerprint''::text) AND (metadata ? ''replayed''::text) AND (metadata ? ''validator_key''::text) AND (NOT (metadata ? ''rationale''::text)) AND (NOT (metadata ? ''question_text''::text)) AND (NOT (metadata ? ''safe_summary''::text))))'
         )
  UNION ALL
  SELECT 'p2_11_client_followup_contract_canonical',
         'P2-11 client_followup contract has a supported priority physical shape, exact fixed fields, exact four-action set, and exactly the fresh/proposed plus resolved/resolved lifecycle tuples',
         (SELECT observed_definition FROM p2_11_expr),
         COALESCE((SELECT pass FROM p2_11_semantics), false)
  UNION ALL
  SELECT 'p2_11_metadata_check_canonical',
         'P2-11 client-followup completion metadata CHECK is present, validated, and canonical',
         (SELECT observed_definition FROM norm_defs WHERE conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'::name),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'::name
              AND convalidated
              AND observed_definition = '((operation <> ''client_followup_completed''::text) OR ((jsonb_typeof(metadata) = ''object''::text) AND kai.gate_a_p0_jsonb_metadata_only(metadata) AND (metadata ? ''metadata_only''::text) AND (metadata ? ''contract''::text) AND (metadata ? ''claim_id''::text) AND (metadata ? ''client_followup_item_id''::text) AND (metadata ? ''gap_log_item_id''::text) AND (metadata ? ''dimension_key''::text) AND (metadata ? ''review_queue_item_id''::text) AND (metadata ? ''previous_queue_status''::text) AND (metadata ? ''resulting_queue_status''::text) AND (metadata ? ''previous_review_status''::text) AND (metadata ? ''resulting_review_status''::text) AND (metadata ? ''decided_by_role''::text) AND (metadata ? ''disposition''::text) AND (metadata ? ''replayed''::text) AND (metadata ? ''validator_key''::text) AND ((metadata ->> ''disposition''::text) = ''no_additional_client_information''::text) AND (NOT (metadata ? ''answer''::text)) AND (NOT (metadata ? ''client_answer''::text)) AND (NOT (metadata ? ''question_text''::text)) AND (NOT (metadata ? ''safe_summary''::text)) AND (NOT (metadata ? ''raw_value''::text))))'
         )
  UNION ALL
  SELECT 'shared_audit_base_required_operations_accepted',
         'Shared audit operation CHECK accepts required P2-09/P2-10/P2-11 operations',
         (SELECT observed_definition FROM audit_expr),
         ARRAY[
           'evidence_review_completed',
           'claim_review_completed_internal_approval',
           'coverage_review_decision_accepted_internal_with_limitation',
           'client_followup_completed'
         ]::text[] <@ coalesce((SELECT operations FROM audit_ops), ARRAY[]::text[])
  UNION ALL
  SELECT check_name,
         detail,
         (SELECT observed_definition FROM audit_expr),
         CASE
           WHEN any_marker IS DISTINCT FROM true THEN true
           WHEN all_markers IS DISTINCT FROM true THEN false
           ELSE operations <@ coalesce((SELECT operations FROM audit_ops), ARRAY[]::text[])
         END
    FROM p3_expected
)
SELECT check_name,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS status,
       detail,
       observed_definition
  FROM expected
 ORDER BY CASE WHEN pass THEN 1 ELSE 0 END, check_name;
