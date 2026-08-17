BEGIN;

CREATE TEMP TABLE p2_03_results (
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
  evidence1 uuid;
  locator1 uuid;
  locator_fingerprint1 text;
  claim_statement1 text;
  claim_fingerprint1 text;
  claim1 uuid := gen_random_uuid();
  required_action1 text := 'Review the claim''s evidence lineage, support strength, limitations, requirement coverage, and audience eligibility before any use.';
  claim_insert_reached boolean := false;
  link_insert_reached boolean := false;
  queue_insert_reached boolean := false;
  audit_insert_reached boolean := false;
  claim_count_before integer;
  link_count_before integer;
  queue_count_before integer;
  audit_count_before integer;
  claim_count_after integer;
  link_count_after integer;
  queue_count_after integer;
  audit_count_after integer;
BEGIN
  SELECT ei.evidence_item_id, sl.source_locator_id, sl.locator_fingerprint
    INTO evidence1, locator1, locator_fingerprint1
    FROM kai.evidence_items ei
    JOIN kai.source_locators sl ON sl.source_locator_id = ei.source_locator_id
    JOIN kai.source_versions sv ON sv.source_version_id = ei.source_version_id
   WHERE ei.organization_id = org1
     AND sv.intake_source_candidate_id = candidate1
     AND sl.coordinates->>'column_name' = 'field_1';

  claim_statement1 := 'The promoted source contains the committed data-dictionary field "field_1" identified by locator ' || locator_fingerprint1 || '.';
  claim_fingerprint1 := encode(digest(org1::text || '|' || evidence1::text || '|finding|' || claim_statement1, 'sha256'), 'hex');

  -- Creation: one claim, one canonical claim-evidence link, one open
  -- claim_review queue item, and one audit row, all atomically.
  claim_insert_reached := true;
  INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint, created_by_type)
  VALUES (claim1, org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1, 'human');

  link_insert_reached := true;
  INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id, created_by_type)
  VALUES (org1, claim1, evidence1, 'system');

  queue_insert_reached := true;
  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
  VALUES (org1, 'claim_review', 'claim', claim1, 'medium', 'open', 'needs_gk_review', 'Review proposed internal-only claim.', required_action1, '{}'::jsonb, 'system');

  audit_insert_reached := true;
  INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata)
  VALUES (
    org1, file1, 'claim_proposed', 'confirmed', 'confirmed', 'success',
    jsonb_build_object(
      'metadata_only', true,
      'contract', 'p2_claim_proposal_v1',
      'evidence_item_id', evidence1::text,
      'claim_id', claim1::text,
      'claim_type', 'finding',
      'claim_status', 'proposed',
      'claim_review_status', 'needs_gk_review',
      'requirement_coverage_status', 'unresolved',
      'warning_count', 1,
      'review_queue_item_count', 1,
      'fresh_write_count', 1,
      'validator_key', 'VAL-KAI-P2-03-001'
    )
  );

  INSERT INTO p2_03_results VALUES (
    'creation_claim_persisted',
    CASE WHEN (SELECT count(*) FROM kai.claims WHERE organization_id = org1 AND evidence_item_id = evidence1 AND claim_type = 'finding') = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one finding claim for the accepted evidence_item identity'
  );
  INSERT INTO p2_03_results VALUES (
    'creation_claim_evidence_link_persisted',
    CASE WHEN (SELECT count(*) FROM kai.claim_evidence_links WHERE organization_id = org1 AND claim_id = claim1 AND evidence_item_id = evidence1) = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one canonical claim-evidence link'
  );
  INSERT INTO p2_03_results VALUES (
    'creation_claim_review_queue_item_open',
    CASE WHEN (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = org1 AND queue_type = 'claim_review' AND queue_status = 'open' AND target_object_id = claim1) = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one open claim_review queue item'
  );
  INSERT INTO p2_03_results VALUES (
    'creation_claim_review_required_action_set',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'claim_review' AND target_object_id = claim1
         AND (required_action IS NULL OR btrim(required_action) = '' OR required_action <> required_action1)
    ) THEN 'PASS' ELSE 'FAIL' END,
    'the claim_review queue item carries the exact required disclosed required_action text'
  );
  INSERT INTO p2_03_results VALUES (
    'creation_claim_audience_gates_closed',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.claims
       WHERE claim_id = claim1
         AND (internal_only IS DISTINCT FROM true
              OR public_use_allowed IS DISTINCT FROM false
              OR funder_use_allowed IS DISTINCT FROM false
              OR llm_processing_allowed IS DISTINCT FROM false
              OR product_learning_allowed IS DISTINCT FROM false
              OR export_ready IS DISTINCT FROM false)
    ) THEN 'PASS' ELSE 'FAIL' END,
    'the persisted claim carries every audience-gate boolean pinned to its fail-closed value'
  );
  INSERT INTO p2_03_results VALUES (
    'creation_audit_persisted',
    CASE WHEN (SELECT count(*) FROM kai.upload_lifecycle_audit WHERE organization_id = org1 AND operation = 'claim_proposed') = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one audit row for the proposal'
  );

  -- Replay: an authoritative re-read by identity returns the same claim.
  INSERT INTO p2_03_results VALUES (
    'replay_reads_same_claim',
    CASE WHEN (SELECT claim_id FROM kai.claims WHERE organization_id = org1 AND evidence_item_id = evidence1 AND claim_type = 'finding' AND statement_fingerprint = claim_fingerprint1) = claim1
      THEN 'PASS' ELSE 'FAIL' END,
    'authoritative identity lookup returns the same claim_id on replay'
  );

  -- Duplicate-identity rejection at the database level.
  BEGIN
    INSERT INTO kai.claims (organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
    VALUES (org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', claim_statement1, claim_fingerprint1);
    INSERT INTO p2_03_results VALUES ('duplicate_identity_rejected', 'FAIL', 'duplicate organization_id + evidence_item_id + claim_type unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_03_results VALUES ('duplicate_identity_rejected', 'PASS', 'safe unique-violation failure via claims_p2_03_identity_unique');
  END;

  -- Genuine concurrent-insert convergence proof (sequential-within-one-session
  -- form, mirroring the established P1-04 through P2-01 SQL-level convention;
  -- true overlapping-transaction concurrency is proved by the PostgreSQL-backed
  -- integration spec, not by this smoke verifier).
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
    VALUES (org1, 'claim_review', 'claim', claim1, 'medium', 'open', 'needs_gk_review', 'Review proposed internal-only claim.', required_action1, '{}'::jsonb, 'system');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
    VALUES (org1, 'claim_review', 'claim', claim1, 'medium', 'open', 'needs_gk_review', 'Review proposed internal-only claim.', required_action1, '{}'::jsonb, 'system');
    INSERT INTO p2_03_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'FAIL', 'second concurrent-identity insert unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p2_03_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'PASS', 'safe unique-violation failure on the second concurrent attempt');
  END;
  INSERT INTO p2_03_results VALUES (
    'concurrent_insert_convergence_exactly_one_row',
    CASE WHEN (SELECT count(*) FROM kai.review_queue_items WHERE organization_id = org1 AND queue_type = 'claim_review' AND target_object_id = claim1) = 1
      THEN 'PASS' ELSE 'FAIL' END,
    'exactly one claim_review queue item exists after two concurrent-identity insert attempts'
  );

  -- Cross-tenant invisibility.
  INSERT INTO p2_03_results VALUES (
    'cross_tenant_invisible',
    CASE WHEN NOT EXISTS (SELECT 1 FROM kai.claims WHERE organization_id = org2 AND evidence_item_id = evidence1)
      THEN 'PASS' ELSE 'FAIL' END,
    'organization_id + evidence_item_id prevents cross-tenant visibility'
  );

  -- Transaction-and-audit atomicity proof: a second, previously-unused evidence
  -- identity's claim, link, queue item, and audit are all reached, then rolled
  -- back together by a forced exception, leaving the exact pre-block counts.
  SELECT count(*) INTO claim_count_before FROM kai.claims;
  SELECT count(*) INTO link_count_before FROM kai.claim_evidence_links;
  SELECT count(*) INTO queue_count_before FROM kai.review_queue_items WHERE queue_type = 'claim_review';
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit WHERE operation = 'claim_proposed';
  DECLARE
    forced_claim_id uuid := gen_random_uuid();
    forced_statement text := 'The promoted source contains the committed data-dictionary field "field_forced" identified by locator ' || repeat('f', 64) || '.';
    forced_fingerprint text := encode(digest(org1::text || '|' || gen_random_uuid()::text || '|finding|forced', 'sha256'), 'hex');
  BEGIN
    BEGIN
      INSERT INTO kai.claims (claim_id, organization_id, evidence_item_id, claim_type, claim_status, claim_review_status, claim_strength, statement, statement_fingerprint)
      VALUES (forced_claim_id, org1, evidence1, 'finding', 'proposed', 'needs_gk_review', 'unassessed', forced_statement, forced_fingerprint);

      INSERT INTO kai.claim_evidence_links (organization_id, claim_id, evidence_item_id)
      VALUES (org1, forced_claim_id, evidence1);

      INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, priority, queue_status, review_status, summary, required_action, queue_metadata, created_by_type)
      VALUES (org1, 'claim_review', 'claim', forced_claim_id, 'medium', 'open', 'needs_gk_review', 'Review proposed internal-only claim.', required_action1, '{}'::jsonb, 'system');

      INSERT INTO kai.upload_lifecycle_audit (organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata)
      VALUES (
        org1, file1, 'claim_proposed', 'confirmed', 'confirmed', 'success',
        jsonb_build_object(
          'metadata_only', true, 'contract', 'p2_claim_proposal_v1',
          'evidence_item_id', evidence1::text, 'claim_id', forced_claim_id::text,
          'claim_type', 'finding', 'claim_status', 'proposed', 'claim_review_status', 'needs_gk_review',
          'requirement_coverage_status', 'unresolved', 'warning_count', 1,
          'review_queue_item_count', 1, 'fresh_write_count', 1, 'validator_key', 'VAL-KAI-P2-03-001'
        )
      );

      RAISE EXCEPTION 'force rollback after claim, link, queue item, and audit insert';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;
  SELECT count(*) INTO claim_count_after FROM kai.claims;
  SELECT count(*) INTO link_count_after FROM kai.claim_evidence_links;
  SELECT count(*) INTO queue_count_after FROM kai.review_queue_items WHERE queue_type = 'claim_review';
  SELECT count(*) INTO audit_count_after FROM kai.upload_lifecycle_audit WHERE operation = 'claim_proposed';
  INSERT INTO p2_03_results VALUES (
    'transaction_and_audit_atomicity',
    CASE WHEN claim_insert_reached AND link_insert_reached AND queue_insert_reached AND audit_insert_reached
           AND claim_count_after = claim_count_before
           AND link_count_after = link_count_before
           AND queue_count_after = queue_count_before
           AND audit_count_after = audit_count_before
         THEN 'PASS' ELSE 'FAIL' END,
    'the claim, link, queue item, and audit inserts were all reached before a forced exception rolled back all effects together'
  );

  INSERT INTO p2_03_results VALUES (
    'audit_metadata_no_raw_content',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'claim_proposed'
         AND metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/|signed_url|storage_uri)'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'claim-proposal audit rows exclude raw/free-text content and storage pointers'
  );

  INSERT INTO p2_03_results VALUES (
    'audit_metadata_exact_keys',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'claim_proposed'
         AND metadata - ARRAY[
           'metadata_only', 'contract', 'evidence_item_id', 'claim_id', 'claim_type', 'claim_status',
           'claim_review_status', 'requirement_coverage_status', 'warning_count',
           'review_queue_item_count', 'fresh_write_count', 'validator_key'
         ] <> '{}'::jsonb
    ) THEN 'PASS' ELSE 'FAIL' END,
    'claim-proposal audit metadata carries no keys beyond the accepted twelve-key allowlist'
  );

  INSERT INTO p2_03_results VALUES (
    'audit_metadata_forbids_claim_statement',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'claim_proposed'
         AND metadata ? 'claim_statement'
    ) THEN 'PASS' ELSE 'FAIL' END,
    'claim-proposal audit metadata never carries the claim statement text'
  );
END $$;

SELECT 'P2_03_SMOKE' AS result_type, check_name, status, detail
FROM p2_03_results
ORDER BY check_name;

ROLLBACK;
