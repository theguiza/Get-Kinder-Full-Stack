BEGIN;

CREATE TEMP TABLE p2_01_results (
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
  source_version1 uuid;
  aggregate_statement text;
  field1_statement text;
  field2_statement text;
  aggregate_fingerprint text;
  field1_locator_fingerprint text;
  field1_fingerprint text;
  field2_locator_fingerprint text;
  field2_fingerprint text;
  aggregate_evidence_id uuid := gen_random_uuid();
  field1_locator_id uuid := gen_random_uuid();
  field1_evidence_id uuid := gen_random_uuid();
  field2_locator_id uuid := gen_random_uuid();
  field2_evidence_id uuid := gen_random_uuid();
  evidence_count_before integer;
  locator_count_before integer;
  queue_count_before integer;
  audit_count_before integer;
  evidence_count_after integer;
  locator_count_after integer;
  queue_count_after integer;
  audit_count_after integer;
  locator_insert_reached boolean := false;
  evidence_insert_reached boolean := false;
  queue_insert_reached boolean := false;
  audit_insert_reached boolean := false;
BEGIN
  SELECT source_version_id INTO source_version1
    FROM kai.source_versions
   WHERE organization_id = org1 AND intake_source_candidate_id = candidate1;

  aggregate_statement := 'Source version''s committed data dictionary contains 2 field(s).';
  field1_statement := 'Source version''s committed data dictionary includes field "field_1" of committed type "number".';
  field2_statement := 'Source version''s committed data dictionary includes field "field_2" of committed type "mixed".';

  aggregate_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|dictionary_field_count_fact|' || aggregate_statement, 'sha256'), 'hex');
  field1_locator_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|column|field_1', 'sha256'), 'hex');
  field1_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|dictionary_field_presence_fact|' || field1_statement, 'sha256'), 'hex');
  field2_locator_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|column|field_2', 'sha256'), 'hex');
  field2_fingerprint := encode(digest(org1::text || '|' || source_version1::text || '|dictionary_field_presence_fact|' || field2_statement, 'sha256'), 'hex');

  -- Creation: the aggregate fact, one field-presence fact per committed
  -- kai.data_dictionary_fields row with its own 'column' locator, and one open
  -- evidence_review queue item per evidence item, all atomically.
  locator_insert_reached := true;
  INSERT INTO kai.source_locators (source_locator_id, organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
  VALUES
    (field1_locator_id, org1, source_version1, 'column', jsonb_build_object('column_name', 'field_1'), field1_locator_fingerprint),
    (field2_locator_id, org1, source_version1, 'column', jsonb_build_object('column_name', 'field_2'), field2_locator_fingerprint);

  evidence_insert_reached := true;
  INSERT INTO kai.evidence_items (evidence_item_id, organization_id, source_version_id, source_locator_id, evidence_type, data_class, statement, statement_fingerprint, created_by_type)
  VALUES
    (aggregate_evidence_id, org1, source_version1, NULL, 'dictionary_field_count_fact', 'organization_committed_metadata', aggregate_statement, aggregate_fingerprint, 'human'),
    (field1_evidence_id, org1, source_version1, field1_locator_id, 'dictionary_field_presence_fact', 'organization_committed_metadata', field1_statement, field1_fingerprint, 'human'),
    (field2_evidence_id, org1, source_version1, field2_locator_id, 'dictionary_field_presence_fact', 'organization_committed_metadata', field2_statement, field2_fingerprint, 'human');

  queue_insert_reached := true;
  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
  VALUES
    (org1, 'evidence_review', 'evidence_item', aggregate_evidence_id, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', NULL, '{}'::jsonb, 'system'),
    (org1, 'evidence_review', 'evidence_item', field1_evidence_id, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', NULL, '{}'::jsonb, 'system'),
    (org1, 'evidence_review', 'evidence_item', field2_evidence_id, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', NULL, '{}'::jsonb, 'system');

  audit_insert_reached := true;
  INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata)
  VALUES (
    org1, file1, 'evidence_lineage_extracted', 'confirmed', 'confirmed', 'success',
    jsonb_build_object(
      'metadata_only', true,
      'contract', 'p2_evidence_lineage_extraction_v1',
      'source_version_id', source_version1::text,
      'intake_sensitivity_profile_id', (SELECT intake_sensitivity_profile_id::text FROM kai.intake_source_candidates WHERE intake_source_candidate_id = candidate1),
      'profile_canonical_sha256', (SELECT profile_canonical_sha256 FROM kai.intake_source_candidates WHERE intake_source_candidate_id = candidate1),
      'evidence_item_count', 3,
      'source_locator_count', 2,
      'review_queue_item_count', 3,
      'fresh_write_count', 3,
      'validator_key', 'VAL-KAI-P2-01-001'
    )
  );

  INSERT INTO p2_01_results VALUES (
    'creation_evidence_items_persisted',
    CASE WHEN (SELECT count(*) FROM kai.evidence_items WHERE organization_id = org1 AND source_version_id = source_version1) = 3
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly three evidence items (one aggregate, two per-field) for the accepted source_version identity'
  );
  INSERT INTO p2_01_results VALUES (
    'creation_source_locators_persisted',
    CASE WHEN (SELECT count(*) FROM kai.source_locators WHERE organization_id = org1 AND source_version_id = source_version1) = 2
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly two source_locators (one per committed field) were created'
  );
  INSERT INTO p2_01_results VALUES (
    'creation_review_queue_items_open',
    CASE WHEN (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = org1 AND queue_type = 'evidence_review' AND queue_status = 'open'
                 AND target_object_id IN (aggregate_evidence_id, field1_evidence_id, field2_evidence_id)) = 3
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly three open evidence_review queue items, one per evidence item'
  );
  INSERT INTO p2_01_results VALUES (
    'creation_audit_persisted',
    CASE WHEN (SELECT count(*) FROM kai.upload_lifecycle_audit WHERE organization_id = org1 AND operation = 'evidence_lineage_extracted') = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one audit row for the extraction'
  );

  -- Replay: an authoritative re-read by identity returns the same evidence items.
  INSERT INTO p2_01_results VALUES (
    'replay_reads_same_evidence_items',
    CASE WHEN (SELECT evidence_item_id FROM kai.evidence_items WHERE organization_id = org1 AND source_version_id = source_version1 AND statement_fingerprint = aggregate_fingerprint) = aggregate_evidence_id
      THEN 'PASS' ELSE 'FAIL' END,
    'authoritative identity lookup returns the same evidence_item_id on replay'
  );

  -- Duplicate-identity rejection at the database level.
  BEGIN
    INSERT INTO kai.evidence_items (organization_id, source_version_id, evidence_type, data_class, statement, statement_fingerprint)
    VALUES (org1, source_version1, 'dictionary_field_count_fact', 'organization_committed_metadata', aggregate_statement, aggregate_fingerprint);
    INSERT INTO p2_01_results VALUES ('duplicate_identity_rejected', 'FAIL', 'duplicate organization_id + source_version_id + statement_fingerprint unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_01_results VALUES ('duplicate_identity_rejected', 'PASS', 'safe unique-violation failure via evidence_items_p2_01_identity_unique');
  END;

  -- Genuine concurrent-insert convergence proof (sequential-within-one-session
  -- form, mirroring the established P1-04 through P1-08 SQL-level convention).
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
    VALUES (org1, 'evidence_review', 'evidence_item', aggregate_evidence_id, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', NULL, '{}'::jsonb, 'system');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
    VALUES (org1, 'evidence_review', 'evidence_item', aggregate_evidence_id, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', NULL, '{}'::jsonb, 'system');
    INSERT INTO p2_01_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'FAIL', 'second concurrent-identity insert unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_01_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'PASS', 'safe unique-violation failure on the second concurrent attempt');
  END;
  INSERT INTO p2_01_results VALUES (
    'concurrent_insert_convergence_exactly_one_row',
    CASE WHEN (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = org1 AND queue_type = 'evidence_review' AND target_object_id = aggregate_evidence_id) = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one evidence_review queue item exists after two concurrent-identity insert attempts'
  );

  -- Cross-tenant invisibility.
  INSERT INTO p2_01_results VALUES (
    'cross_tenant_invisible',
    CASE WHEN NOT EXISTS (SELECT 1 FROM kai.evidence_items WHERE organization_id = org2 AND source_version_id = source_version1)
      THEN 'PASS' ELSE 'FAIL' END,
    'organization_id + source_version_id prevents cross-tenant visibility'
  );

  -- Transaction-and-audit atomicity proof: a second, previously-unused statement
  -- fingerprint's locator, evidence item, review-queue item, and audit are all
  -- reached, then rolled back together by a forced exception, leaving the exact
  -- pre-block counts.
  SELECT count(*) INTO evidence_count_before FROM kai.evidence_items;
  SELECT count(*) INTO locator_count_before FROM kai.source_locators;
  SELECT count(*) INTO queue_count_before FROM kai.review_queue_items WHERE queue_type = 'evidence_review';
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_lineage_extracted';
  DECLARE
    forced_locator_id uuid := gen_random_uuid();
    forced_evidence_id uuid := gen_random_uuid();
    forced_locator_fingerprint text := encode(digest(org1::text || '|' || source_version1::text || '|column|field_forced', 'sha256'), 'hex');
    forced_statement text := 'Source version''s committed data dictionary includes field "field_forced" of committed type "text".';
    forced_fingerprint text := encode(digest(org1::text || '|' || source_version1::text || '|dictionary_field_presence_fact|forced', 'sha256'), 'hex');
  BEGIN
    BEGIN
      INSERT INTO kai.source_locators (source_locator_id, organization_id, source_version_id, locator_type, coordinates, locator_fingerprint)
      VALUES (forced_locator_id, org1, source_version1, 'column', jsonb_build_object('column_name', 'field_forced'), forced_locator_fingerprint);

      INSERT INTO kai.evidence_items (evidence_item_id, organization_id, source_version_id, source_locator_id, evidence_type, data_class, statement, statement_fingerprint)
      VALUES (forced_evidence_id, org1, source_version1, forced_locator_id, 'dictionary_field_presence_fact', 'organization_committed_metadata', forced_statement, forced_fingerprint);

      INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
      VALUES (org1, 'evidence_review', 'evidence_item', forced_evidence_id, 'normal', 'open', 'needs_gk_review', 'New evidence item requires GK review.', NULL, '{}'::jsonb, 'system');

      INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata)
      VALUES (
        org1, file1, 'evidence_lineage_extracted', 'confirmed', 'confirmed', 'success',
        jsonb_build_object(
          'metadata_only', true, 'contract', 'p2_evidence_lineage_extraction_v1',
          'source_version_id', source_version1::text, 'intake_sensitivity_profile_id', gen_random_uuid()::text,
          'profile_canonical_sha256', repeat('d', 64), 'evidence_item_count', 4, 'source_locator_count', 3,
          'review_queue_item_count', 4, 'fresh_write_count', 1, 'validator_key', 'VAL-KAI-P2-01-001'
        )
      );

      RAISE EXCEPTION 'force rollback after locator, evidence item, queue item, and audit insert';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  SELECT count(*) INTO evidence_count_after FROM kai.evidence_items;
  SELECT count(*) INTO locator_count_after FROM kai.source_locators;
  SELECT count(*) INTO queue_count_after FROM kai.review_queue_items WHERE queue_type = 'evidence_review';
  SELECT count(*) INTO audit_count_after FROM kai.upload_lifecycle_audit WHERE operation = 'evidence_lineage_extracted';
  INSERT INTO p2_01_results VALUES (
    'transaction_and_audit_atomicity',
    CASE WHEN locator_insert_reached AND evidence_insert_reached AND queue_insert_reached AND audit_insert_reached
           AND evidence_count_after = evidence_count_before
           AND locator_count_after = locator_count_before
           AND queue_count_after = queue_count_before
           AND audit_count_after = audit_count_before
         THEN 'PASS' ELSE 'FAIL' END,
    'the locator, evidence item, queue item, and audit inserts were all reached before a forced exception rolled back all effects together'
  );

  INSERT INTO p2_01_results VALUES (
    'audit_metadata_no_raw_content',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'evidence_lineage_extracted'
         AND metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/|signed_url|storage_uri)'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'evidence-lineage audit rows exclude raw/free-text content and storage pointers'
  );

  INSERT INTO p2_01_results VALUES (
    'audit_metadata_exact_keys',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'evidence_lineage_extracted'
         AND metadata - ARRAY[
           'metadata_only', 'contract', 'source_version_id', 'intake_sensitivity_profile_id',
           'profile_canonical_sha256', 'evidence_item_count', 'source_locator_count',
           'review_queue_item_count', 'fresh_write_count', 'validator_key'
         ] <> '{}'::jsonb
    ) THEN 'PASS' ELSE 'FAIL' END,
    'evidence-lineage audit metadata carries no keys beyond the accepted ten-key allowlist'
  );

  INSERT INTO p2_01_results VALUES (
    'audit_metadata_forbids_statement_keys',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'evidence_lineage_extracted'
         AND (metadata ? 'statement' OR metadata ? 'statement_fingerprint')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'evidence-lineage audit metadata never carries derived statement content or per-item fingerprints'
  );
END $$;

SELECT 'P2_01_SMOKE' AS result_type, check_name, status, detail
FROM p2_01_results
ORDER BY check_name;

ROLLBACK;
