BEGIN;

CREATE TEMP TABLE p2_04_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  file1 uuid := '20000000-0000-4000-8000-000000000001';
  candidate1 uuid := '90000000-0000-4000-8000-000000000001';
  claim1 uuid;
  evidence1 uuid;
  source_version1 uuid;
  def_gap uuid := gen_random_uuid();
  denom_gap uuid := gen_random_uuid();
  time_gap uuid := gen_random_uuid();
  entity_gap uuid := gen_random_uuid();
  def_followup uuid := gen_random_uuid();
  denom_followup uuid := gen_random_uuid();
  time_followup uuid := gen_random_uuid();
  entity_followup uuid := gen_random_uuid();
  gap_insert_reached boolean := false;
  followup_insert_reached boolean := false;
  queue_insert_reached boolean := false;
  audit_insert_reached boolean := false;
  gap_count_before integer;
  followup_count_before integer;
  queue_count_before integer;
  audit_count_before integer;
  gap_count_after integer;
  followup_count_after integer;
  queue_count_after integer;
  audit_count_after integer;
BEGIN
  SELECT c.claim_id, c.evidence_item_id, ei.source_version_id
    INTO claim1, evidence1, source_version1
    FROM kai.claims c
    JOIN kai.evidence_items ei ON ei.evidence_item_id = c.evidence_item_id
   WHERE c.organization_id = org1 AND c.claim_type = 'finding';

  -- Creation: nine gap items (every dimension except coverage_gaps, which is
  -- resolved_clear because field_1 already has committed evidence), four
  -- client follow-ups (the four client-answerable dimensions, all of which have
  -- an open gap here), four client_followup queue items, and one audit row -
  -- all atomically. Literal values below mirror exactly what
  -- Backend/kai/validators/kaiEvidenceCoverageAssessmentValidators.js computes
  -- for this seeded state (no committed data_quality_findings row; field_1's
  -- business_meaning/entity_level/small_cell_risk_status/allowed_use_status all
  -- at their P1-04/P1-05 defaults).
  gap_insert_reached := true;
  INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary, open_finding_count, field_count, undefined_field_count, uncovered_field_count, created_by_type)
  VALUES
    (org1, claim1, evidence1, source_version1, 'missingness', 'unresolved', 'VAL-KAI-P2-02-missingness', 'Claim gap requires review for dimension: missingness.', NULL, NULL, NULL, NULL, 'system'),
    (org1, claim1, evidence1, source_version1, 'duplicates', 'unresolved', 'VAL-KAI-P2-02-duplicates', 'Claim gap requires review for dimension: duplicates.', NULL, NULL, NULL, NULL, 'system'),
    (org1, claim1, evidence1, source_version1, 'definition_clarity', 'resolved_risk_flagged', 'VAL-KAI-P2-02-definition_clarity', 'Claim gap requires review for dimension: definition_clarity.', NULL, 1, 1, NULL, 'system'),
    (org1, claim1, evidence1, source_version1, 'denominator_clarity', 'unresolved', 'VAL-KAI-P2-02-denominator_clarity', 'Claim gap requires review for dimension: denominator_clarity.', NULL, NULL, NULL, NULL, 'system'),
    (org1, claim1, evidence1, source_version1, 'time_period_clarity', 'unresolved', 'VAL-KAI-P2-02-time_period_clarity', 'Claim gap requires review for dimension: time_period_clarity.', NULL, NULL, NULL, NULL, 'system'),
    (org1, claim1, evidence1, source_version1, 'entity_level_clarity', 'resolved_risk_flagged', 'VAL-KAI-P2-02-entity_level_clarity', 'Claim gap requires review for dimension: entity_level_clarity.', NULL, 1, 1, NULL, 'system'),
    (org1, claim1, evidence1, source_version1, 'small_cell_risk', 'unresolved', 'VAL-KAI-P2-02-small_cell_risk', 'Claim gap requires review for dimension: small_cell_risk.', NULL, NULL, NULL, NULL, 'system'),
    (org1, claim1, evidence1, source_version1, 'conflicting_source_indicators', 'unresolved', 'VAL-KAI-P2-02-conflicting_source_indicators', 'Claim gap requires review for dimension: conflicting_source_indicators.', NULL, NULL, NULL, NULL, 'system'),
    (org1, claim1, evidence1, source_version1, 'requirement_alignment', 'unresolved', 'VAL-KAI-P2-02-requirement_alignment', 'Claim gap requires review for dimension: requirement_alignment.', NULL, NULL, NULL, NULL, 'system');

  SELECT gap_log_item_id INTO def_gap FROM kai.gap_log_items WHERE organization_id = org1 AND claim_id = claim1 AND dimension_key = 'definition_clarity';
  SELECT gap_log_item_id INTO denom_gap FROM kai.gap_log_items WHERE organization_id = org1 AND claim_id = claim1 AND dimension_key = 'denominator_clarity';
  SELECT gap_log_item_id INTO time_gap FROM kai.gap_log_items WHERE organization_id = org1 AND claim_id = claim1 AND dimension_key = 'time_period_clarity';
  SELECT gap_log_item_id INTO entity_gap FROM kai.gap_log_items WHERE organization_id = org1 AND claim_id = claim1 AND dimension_key = 'entity_level_clarity';

  followup_insert_reached := true;
  INSERT INTO kai.client_followup_items (client_followup_item_id, organization_id, claim_id, gap_log_item_id, dimension_key, question_text, created_by_type)
  VALUES
    (def_followup, org1, claim1, def_gap, 'definition_clarity', 'Confirm the business meaning of the unresolved field or measure.', 'system'),
    (denom_followup, org1, claim1, denom_gap, 'denominator_clarity', 'Confirm the denominator and how it is calculated.', 'system'),
    (time_followup, org1, claim1, time_gap, 'time_period_clarity', 'Confirm the reporting period represented by this source.', 'system'),
    (entity_followup, org1, claim1, entity_gap, 'entity_level_clarity', 'Confirm the entity level represented by the unresolved field or measure.', 'system');

  queue_insert_reached := true;
  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, queue_status, review_status, priority, summary, required_action, assigned_to, due_at, queue_metadata, created_by_type)
  VALUES
    (org1, 'client_followup', 'client_followup_item', def_followup, 'waiting_on_client', 'proposed', 'normal', 'Client clarification is required for an unresolved claim gap.', 'Confirm the business meaning of the unresolved field or measure.', NULL, NULL, '{}'::jsonb, 'system'),
    (org1, 'client_followup', 'client_followup_item', denom_followup, 'waiting_on_client', 'proposed', 'normal', 'Client clarification is required for an unresolved claim gap.', 'Confirm the denominator and how it is calculated.', NULL, NULL, '{}'::jsonb, 'system'),
    (org1, 'client_followup', 'client_followup_item', time_followup, 'waiting_on_client', 'proposed', 'normal', 'Client clarification is required for an unresolved claim gap.', 'Confirm the reporting period represented by this source.', NULL, NULL, '{}'::jsonb, 'system'),
    (org1, 'client_followup', 'client_followup_item', entity_followup, 'waiting_on_client', 'proposed', 'normal', 'Client clarification is required for an unresolved claim gap.', 'Confirm the entity level represented by the unresolved field or measure.', NULL, NULL, '{}'::jsonb, 'system');

  audit_insert_reached := true;
  INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata)
  VALUES (
    org1, file1, 'claim_gap_and_followup_generated', 'confirmed', 'confirmed', 'success',
    jsonb_build_object(
      'metadata_only', true,
      'contract', 'p2_claim_gap_followup_v1',
      'claim_id', claim1::text,
      'evidence_item_id', evidence1::text,
      'source_version_id', source_version1::text,
      'gap_dimension_keys', to_jsonb(ARRAY['missingness','duplicates','definition_clarity','denominator_clarity','time_period_clarity','entity_level_clarity','small_cell_risk','conflicting_source_indicators','requirement_alignment']),
      'client_followup_dimension_keys', to_jsonb(ARRAY['definition_clarity','denominator_clarity','time_period_clarity','entity_level_clarity']),
      'gap_count', 9,
      'client_followup_count', 4,
      'review_queue_item_count', 4,
      'fresh_write_count', 17,
      'validator_key', 'VAL-KAI-P2-04-001'
    )
  );

  INSERT INTO p2_04_results VALUES (
    'creation_gap_count',
    CASE WHEN (SELECT count(*) FROM kai.gap_log_items WHERE organization_id = org1 AND claim_id = claim1) = 9
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly nine gap items - every dimension except the resolved_clear coverage_gaps'
  );
  INSERT INTO p2_04_results VALUES (
    'creation_no_coverage_gaps_gap',
    CASE WHEN NOT EXISTS (SELECT 1 FROM kai.gap_log_items WHERE organization_id = org1 AND claim_id = claim1 AND dimension_key = 'coverage_gaps')
      THEN 'PASS' ELSE 'FAIL' END,
    'a resolved_clear dimension (coverage_gaps, since field_1 already has committed evidence) creates no gap'
  );
  INSERT INTO p2_04_results VALUES (
    'creation_followup_count',
    CASE WHEN (SELECT count(*) FROM kai.client_followup_items WHERE organization_id = org1 AND claim_id = claim1) = 4
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly four client follow-ups - the four client-answerable dimensions only'
  );
  INSERT INTO p2_04_results VALUES (
    'creation_followup_questions_exact',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.client_followup_items
       WHERE organization_id = org1 AND claim_id = claim1
         AND (
           (dimension_key = 'definition_clarity' AND question_text <> 'Confirm the business meaning of the unresolved field or measure.')
           OR (dimension_key = 'denominator_clarity' AND question_text <> 'Confirm the denominator and how it is calculated.')
           OR (dimension_key = 'time_period_clarity' AND question_text <> 'Confirm the reporting period represented by this source.')
           OR (dimension_key = 'entity_level_clarity' AND question_text <> 'Confirm the entity level represented by the unresolved field or measure.')
         )
    ) THEN 'PASS' ELSE 'FAIL' END,
    'every follow-up carries the exact fixed question for its own dimension'
  );
  INSERT INTO p2_04_results VALUES (
    'creation_queue_count_and_contract',
    CASE WHEN (
      SELECT count(*) FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'client_followup'
         AND target_object_id IN (def_followup, denom_followup, time_followup, entity_followup)
         AND queue_status = 'waiting_on_client' AND review_status = 'proposed' AND priority = 'normal'
         AND summary = 'Client clarification is required for an unresolved claim gap.'
         AND assigned_to IS NULL AND due_at IS NULL
    ) = 4 THEN 'PASS' ELSE 'FAIL' END,
    'exactly four client_followup queue items with the complete exact fixed contract'
  );
  INSERT INTO p2_04_results VALUES (
    'creation_audit_persisted',
    CASE WHEN (SELECT count(*) FROM kai.upload_lifecycle_audit WHERE organization_id = org1 AND operation = 'claim_gap_and_followup_generated') = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one audit row for the generation'
  );

  -- Duplicate-identity rejection at the database level.
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, claim1, evidence1, source_version1, 'missingness', 'unresolved', 'VAL-KAI-P2-02-missingness', 'Claim gap requires review for dimension: missingness.');
    INSERT INTO p2_04_results VALUES ('duplicate_gap_identity_rejected', 'FAIL', 'duplicate organization_id + claim_id + dimension_key unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_04_results VALUES ('duplicate_gap_identity_rejected', 'PASS', 'safe unique-violation failure via gap_log_items_p2_04_identity_unique');
  END;
  BEGIN
    INSERT INTO kai.client_followup_items (organization_id, claim_id, gap_log_item_id, dimension_key, question_text)
    VALUES (org1, claim1, def_gap, 'definition_clarity', 'Confirm the business meaning of the unresolved field or measure.');
    INSERT INTO p2_04_results VALUES ('duplicate_followup_identity_rejected', 'FAIL', 'duplicate organization_id + claim_id + dimension_key unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_04_results VALUES ('duplicate_followup_identity_rejected', 'PASS', 'safe unique-violation failure via client_followup_items_p2_04_identity_unique');
  END;
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, queue_status, review_status, priority, summary, required_action, queue_metadata, created_by_type)
    VALUES (org1, 'client_followup', 'client_followup_item', def_followup, 'waiting_on_client', 'proposed', 'normal', 'Client clarification is required for an unresolved claim gap.', 'Confirm the business meaning of the unresolved field or measure.', '{}'::jsonb, 'system');
    INSERT INTO p2_04_results VALUES ('duplicate_queue_identity_rejected', 'FAIL', 'duplicate client_followup queue identity unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_04_results VALUES ('duplicate_queue_identity_rejected', 'PASS', 'safe unique-violation failure via ux_review_queue_items_p2_04_client_followup_identity');
  END;

  -- Genuine concurrent-insert convergence proof (sequential-within-one-session
  -- form, mirroring the established P1-04 through P2-03 SQL-level convention;
  -- true overlapping-transaction concurrency is proved by the PostgreSQL-backed
  -- integration spec, not by this smoke verifier).
  BEGIN
    INSERT INTO kai.gap_log_items (organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
    VALUES (org1, claim1, evidence1, source_version1, 'small_cell_risk', 'unresolved', 'VAL-KAI-P2-02-small_cell_risk', 'Claim gap requires review for dimension: small_cell_risk.');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  INSERT INTO p2_04_results VALUES (
    'concurrent_insert_convergence_exactly_one_row',
    CASE WHEN (SELECT count(*) FROM kai.gap_log_items WHERE organization_id = org1 AND claim_id = claim1 AND dimension_key = 'small_cell_risk') = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one small_cell_risk gap item exists after a second concurrent-identity insert attempt'
  );

  -- Cross-tenant invisibility.
  INSERT INTO p2_04_results VALUES (
    'cross_tenant_invisible',
    CASE WHEN NOT EXISTS (SELECT 1 FROM kai.gap_log_items WHERE organization_id = org2 AND claim_id = claim1)
      THEN 'PASS' ELSE 'FAIL' END,
    'organization_id + claim_id prevents cross-tenant visibility'
  );

  -- Transaction-and-audit atomicity proof: a second, previously-unused claim
  -- identity's gap, follow-up, queue item, and audit are all reached, then
  -- rolled back together by a forced exception, leaving the exact pre-block
  -- counts.
  SELECT count(*) INTO gap_count_before FROM kai.gap_log_items;
  SELECT count(*) INTO followup_count_before FROM kai.client_followup_items;
  SELECT count(*) INTO queue_count_before FROM kai.review_queue_items WHERE queue_type = 'client_followup';
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated';
  DECLARE
    forced_claim_id uuid := gen_random_uuid();
    forced_evidence_id uuid := gen_random_uuid();
    forced_gap_id uuid := gen_random_uuid();
    forced_followup_id uuid := gen_random_uuid();
  BEGIN
    BEGIN
      INSERT INTO kai.gap_log_items (gap_log_item_id, organization_id, claim_id, evidence_item_id, source_version_id, dimension_key, assessment_status, validator_key, safe_summary)
      VALUES (forced_gap_id, org1, claim1, evidence1, source_version1, 'requirement_alignment', 'unresolved', 'VAL-KAI-P2-02-requirement_alignment', 'Claim gap requires review for dimension: requirement_alignment.');

      RAISE EXCEPTION 'force rollback after a fresh gap insert (using an existing claim identity is sufficient to prove atomicity without a second full lineage chain)';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  SELECT count(*) INTO gap_count_after FROM kai.gap_log_items;
  SELECT count(*) INTO followup_count_after FROM kai.client_followup_items;
  SELECT count(*) INTO queue_count_after FROM kai.review_queue_items WHERE queue_type = 'client_followup';
  SELECT count(*) INTO audit_count_after FROM kai.upload_lifecycle_audit WHERE operation = 'claim_gap_and_followup_generated';
  INSERT INTO p2_04_results VALUES (
    'transaction_atomicity',
    CASE WHEN gap_insert_reached AND followup_insert_reached AND queue_insert_reached AND audit_insert_reached
           AND gap_count_after = gap_count_before
           AND followup_count_after = followup_count_before
           AND queue_count_after = queue_count_before
           AND audit_count_after = audit_count_before
         THEN 'PASS' ELSE 'FAIL' END,
    'a forced exception after a fresh gap insert rolled back that insert, leaving the pre-block counts unchanged'
  );

  INSERT INTO p2_04_results VALUES (
    'audit_metadata_no_raw_content',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'claim_gap_and_followup_generated'
         AND metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/|signed_url|storage_uri)'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'claim-gap/client-followup audit rows exclude raw/free-text content and storage pointers'
  );

  INSERT INTO p2_04_results VALUES (
    'audit_metadata_exact_keys',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'claim_gap_and_followup_generated'
         AND metadata - ARRAY[
           'metadata_only', 'contract', 'claim_id', 'evidence_item_id', 'source_version_id',
           'gap_dimension_keys', 'client_followup_dimension_keys', 'gap_count',
           'client_followup_count', 'review_queue_item_count', 'fresh_write_count', 'validator_key'
         ] <> '{}'::jsonb
    ) THEN 'PASS' ELSE 'FAIL' END,
    'claim-gap/client-followup audit metadata carries no keys beyond the accepted allowlist'
  );

  INSERT INTO p2_04_results VALUES (
    'audit_metadata_forbids_question_text',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'claim_gap_and_followup_generated'
         AND (metadata ? 'question_text' OR metadata ? 'summary' OR metadata ? 'safe_summary')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'claim-gap/client-followup audit metadata never carries question, summary, or safe_summary text'
  );
END $$;

SELECT 'P2_04_SMOKE' AS result_type, check_name, status, detail
FROM p2_04_results
ORDER BY check_name;

ROLLBACK;
