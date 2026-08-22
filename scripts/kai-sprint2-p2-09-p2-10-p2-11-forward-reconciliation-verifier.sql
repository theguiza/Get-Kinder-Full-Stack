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
expected AS (
  SELECT 'evidence_support_strength_check_canonical' AS check_name,
         'kai.evidence_items.support_strength admits unassessed and reviewed_supported only' AS detail,
         '(support_strength=ANY(ARRAY[''unassessed''::text,''reviewed_supported''::text]))' AS expected_norm,
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
         '(claim_strength=ANY(ARRAY[''unassessed''::text,''reviewed_supported''::text]))',
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
         NULL,
         (SELECT observed_definition FROM norm_defs WHERE conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE conname = 'upload_lifecycle_audit_p2_09_evidence_review_metadata_object_check'
              AND convalidated
              AND observed_definition LIKE '%evidence_review_completed%'
              AND observed_definition LIKE '%previous_support_strength%'
              AND observed_definition LIKE '%resulting_support_strength%'
              AND observed_definition LIKE '%validator_key%'
         )
  UNION ALL
  SELECT 'p2_09_claim_metadata_check_canonical',
         'P2-09 claim-review audit metadata CHECK is present, validated, and canonical',
         NULL,
         (SELECT observed_definition FROM norm_defs WHERE conname = 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE conname = 'upload_lifecycle_audit_p2_09_claim_review_metadata_object_check'
              AND convalidated
              AND observed_definition LIKE '%claim_review_completed_internal_approval%'
              AND observed_definition LIKE '%previous_claim_strength%'
              AND observed_definition LIKE '%resulting_claim_strength%'
              AND observed_definition LIKE '%validator_key%'
         )
  UNION ALL
  SELECT 'p2_10_table_exists',
         'to_regclass(''kai.coverage_review_decisions'') IS NOT NULL',
         NULL,
         to_regclass('kai.coverage_review_decisions')::text,
         to_regclass('kai.coverage_review_decisions') IS NOT NULL
  UNION ALL
  SELECT 'p2_10_columns_types_not_null_canonical',
         'P2-10 required columns, types, and NOT NULL contracts match the canonical repository definition',
         NULL,
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
         NULL,
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
         NULL,
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
         NULL,
         (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'kai' AND r.relname = 'coverage_review_decisions' AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'),
         EXISTS (
           SELECT 1 FROM pg_trigger t
           JOIN pg_class r ON r.oid = t.tgrelid
           JOIN pg_namespace n ON n.oid = r.relnamespace
           WHERE n.nspname = 'kai'
             AND r.relname = 'coverage_review_decisions'
             AND t.tgname = 'trg_p2_10_coverage_review_decisions_append_only'
             AND t.tgenabled = 'O'
             AND pg_get_triggerdef(t.oid) LIKE '%BEFORE%'
             AND pg_get_triggerdef(t.oid) LIKE '%UPDATE%'
             AND pg_get_triggerdef(t.oid) LIKE '%DELETE%'
             AND pg_get_triggerdef(t.oid) LIKE '%kai.p2_10_reject_coverage_decision_mutation()%'
         )
  UNION ALL
  SELECT 'p2_10_decision_vocabulary_canonical',
         'P2-10 decision vocabulary is exactly accepted_internal_with_limitation',
         NULL,
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
         NULL,
         (SELECT observed_definition FROM norm_defs WHERE conname = 'upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check'),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE conname = 'upload_lifecycle_audit_p2_10_coverage_review_decision_metadata_object_check'
              AND convalidated
              AND observed_definition LIKE '%coverage_review_decision_accepted_internal_with_limitation%'
              AND observed_definition LIKE '%state_fingerprint%'
              AND observed_definition LIKE '%replayed%'
              AND observed_definition LIKE '%NOT (metadata ? ''rationale''%'
         )
  UNION ALL
  SELECT 'p2_11_client_followup_contract_canonical',
         'P2-11 client_followup contract admits exactly fresh and resolved workflow states with fixed fields',
         NULL,
         (SELECT observed_definition FROM norm_defs WHERE relname = 'review_queue_items' AND conname = 'review_queue_items_p2_04_client_followup_contract_check'),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE relname = 'review_queue_items'
              AND conname = 'review_queue_items_p2_04_client_followup_contract_check'
              AND observed_definition LIKE '%queue_type <> ''client_followup''%'
              AND observed_definition LIKE '%target_object_type = ''client_followup_item''%'
              AND observed_definition LIKE '%priority = ''medium''%'
              AND observed_definition LIKE '%summary = ''Client clarification is required for an unresolved claim gap.''%'
              AND observed_definition LIKE '%assigned_to IS NULL%'
              AND observed_definition LIKE '%due_at IS NULL%'
              AND observed_definition LIKE '%queue_status = ''waiting_on_client''%'
              AND observed_definition LIKE '%review_status = ''proposed''%'
              AND observed_definition LIKE '%queue_status = ''resolved''%'
              AND observed_definition LIKE '%review_status = ''resolved''%'
              AND observed_definition LIKE '%Confirm the business meaning of the unresolved field or measure.%'
              AND observed_definition LIKE '%Confirm the denominator and how it is calculated.%'
              AND observed_definition LIKE '%Confirm the reporting period represented by this source.%'
              AND observed_definition LIKE '%Confirm the entity level represented by the unresolved field or measure.%'
         )
  UNION ALL
  SELECT 'p2_11_metadata_check_canonical',
         'P2-11 client-followup completion metadata CHECK is present, validated, and canonical',
         NULL,
         (SELECT observed_definition FROM norm_defs WHERE conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE conname = 'upload_lifecycle_audit_p2_11_client_followup_completion_metadata_object_check'
              AND convalidated
              AND observed_definition LIKE '%client_followup_completed%'
              AND observed_definition LIKE '%no_additional_client_information%'
              AND observed_definition LIKE '%NOT (metadata ? ''answer''%'
              AND observed_definition LIKE '%NOT (metadata ? ''raw_value''%'
         )
  UNION ALL
  SELECT 'shared_audit_required_operations_accepted',
         'Shared audit operation CHECK accepts required P2-09/P2-10/P2-11 and later/P3 operations',
         NULL,
         (SELECT observed_definition FROM norm_defs WHERE relname = 'upload_lifecycle_audit' AND conname = 'upload_lifecycle_audit_gate_a_operation_check'),
         EXISTS (
           SELECT 1 FROM norm_defs
            WHERE relname = 'upload_lifecycle_audit'
              AND conname = 'upload_lifecycle_audit_gate_a_operation_check'
              AND observed_definition LIKE '%evidence_review_completed%'
              AND observed_definition LIKE '%claim_review_completed_internal_approval%'
              AND observed_definition LIKE '%coverage_review_decision_accepted_internal_with_limitation%'
              AND observed_definition LIKE '%client_followup_completed%'
              AND observed_definition LIKE '%generated_content_draft_created%'
              AND observed_definition LIKE '%generated_content_review_completed%'
              AND observed_definition LIKE '%export_review_requested%'
              AND observed_definition LIKE '%export_review_started%'
              AND observed_definition LIKE '%export_review_completed%'
              AND observed_definition LIKE '%limitation_snapshot_confirmed%'
              AND observed_definition LIKE '%export_candidate_created%'
         )
)
SELECT check_name,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS status,
       detail,
       observed_definition
  FROM expected
 ORDER BY CASE WHEN pass THEN 1 ELSE 0 END, check_name;
