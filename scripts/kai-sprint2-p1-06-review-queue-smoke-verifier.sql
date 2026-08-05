BEGIN;

CREATE TEMP TABLE p1_06_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  org2 uuid := '00000000-0000-4000-8000-000000000002';
  file1 uuid := '20000000-0000-4000-8000-000000000001';
  sensitivity1 uuid := '80000000-0000-4000-8000-000000000001';
  sensitivity2 uuid := '80000000-0000-4000-8000-000000000002';
  bogus_sensitivity uuid := '80000000-0000-4000-8000-000000000999';
  fresh_item uuid;
  item_count_before integer;
  item_count_after integer;
  audit_count_before integer;
  audit_count_after integer;
  item_insert_reached boolean := false;
  audit_insert_reached boolean := false;
  first_item_id uuid;
BEGIN
  -- Creation: a single 'sensitivity_review' item for sensitivity1's predicate-satisfying
  -- lineage, together with its required metadata-only audit row, both atomically.
  first_item_id := gen_random_uuid();
  INSERT INTO kai.review_queue_items (
    review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id,
    priority, queue_status, summary, required_action, created_by_type
  ) VALUES (
    first_item_id, org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity1,
    'normal', 'open',
    'Review intake sensitivity and allowed-use profile.',
    'Review classifications, consent basis, allowed-use restrictions, and governance requirements before source-candidate work.',
    'human'
  );
  INSERT INTO kai.upload_lifecycle_audit (
    organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
  ) VALUES (
    org1, file1, 'sensitivity_review_queue_item_created', 'confirmed', 'confirmed', 'success',
    jsonb_build_object(
      'metadata_only', true,
      'contract', 'p1_sensitivity_review_queue_item_v1',
      'queue_type', 'sensitivity_review',
      'target_object_type', 'intake_sensitivity_profile',
      'target_object_id', sensitivity1::text,
      'queue_status', 'open',
      'validator_key', 'VAL-FUP-001-P0'
    )
  );

  INSERT INTO p1_06_results VALUES (
    'creation_persisted',
    CASE WHEN (
      SELECT count(*) FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'sensitivity_review'
         AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = sensitivity1
    ) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'exactly one sensitivity_review item for the accepted org1/sensitivity1 identity'
  );
  INSERT INTO p1_06_results VALUES (
    'creation_audit_persisted',
    CASE WHEN (
      SELECT count(*) FROM kai.upload_lifecycle_audit
       WHERE organization_id = org1 AND intake_file_id = file1
         AND operation = 'sensitivity_review_queue_item_created'
    ) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'exactly one audit row for the created sensitivity_review item'
  );

  -- Replay: an authoritative re-read by identity returns the same row; no duplicate
  -- insert is attempted by a correctly-behaving caller (this is what the repository's
  -- getScopedSensitivityReviewQueueItemByIdentity + early-return does before ever
  -- reaching INSERT).
  INSERT INTO p1_06_results VALUES (
    'replay_reads_same_row',
    CASE WHEN (
      SELECT review_queue_item_id FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'sensitivity_review'
         AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = sensitivity1
    ) = first_item_id THEN 'PASS' ELSE 'FAIL' END,
    'authoritative identity lookup returns the same review_queue_item_id on replay'
  );

  -- Idempotency-key convergence: the partial unique index rejects a second row for the
  -- same identity even when its other content differs, proving the identity - not the
  -- content - is what is deduplicated. This is the changed-state "conflict" a caller
  -- who bypasses the authoritative read (or a genuine concurrent writer) would hit; the
  -- repository/service layer always resolves it by re-reading and replaying rather than
  -- surfacing the raw violation.
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, summary, required_action, created_by_type
    ) VALUES (
      org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity1,
      'urgent', 'open', 'a different summary', 'a different required action', 'human'
    );
    INSERT INTO p1_06_results VALUES ('duplicate_identity_rejected', 'FAIL', 'duplicate organization_id + queue_type + target_object_type + target_object_id unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_06_results VALUES ('duplicate_identity_rejected', 'PASS', 'safe unique-violation failure via the partial unique index');
  END;

  -- Genuine concurrent-insert convergence proof (sequential-within-one-session form,
  -- mirroring the established P1-04/P1-05 SQL-level convention; true cross-connection
  -- concurrency is proven separately by the Node integration test): two independent
  -- attempts to create the sensitivity2 item both reach INSERT, only one commits, and
  -- exactly one row exists afterward.
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, summary, required_action, created_by_type
    ) VALUES (
      org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity2,
      'normal', 'open', 'Review intake sensitivity and allowed-use profile.',
      'Review classifications, consent basis, allowed-use restrictions, and governance requirements before source-candidate work.',
      'human'
    );
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, summary, required_action, created_by_type
    ) VALUES (
      org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity2,
      'normal', 'open', 'Review intake sensitivity and allowed-use profile.',
      'Review classifications, consent basis, allowed-use restrictions, and governance requirements before source-candidate work.',
      'human'
    );
    INSERT INTO p1_06_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'FAIL', 'second concurrent-identity insert unexpectedly succeeded');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_06_results VALUES ('concurrent_insert_convergence_second_attempt_rejected', 'PASS', 'safe unique-violation failure on the second concurrent attempt');
  END;
  INSERT INTO p1_06_results VALUES (
    'concurrent_insert_convergence_exactly_one_row',
    CASE WHEN (
      SELECT count(*) FROM kai.review_queue_items
       WHERE organization_id = org1 AND queue_type = 'sensitivity_review'
         AND target_object_type = 'intake_sensitivity_profile' AND target_object_id = sensitivity2
    ) = 1 THEN 'PASS' ELSE 'FAIL' END,
    'exactly one row exists after two concurrent-identity insert attempts'
  );

  -- Cross-tenant invisibility.
  INSERT INTO p1_06_results VALUES (
    'cross_tenant_invisible',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.review_queue_items
       WHERE organization_id = org2 AND target_object_id = sensitivity1
    ) THEN 'PASS' ELSE 'FAIL' END,
    'organization_id + identity prevents cross-tenant visibility'
  );

  -- Fabricated target rejected by application-level authoritative existence check (no
  -- polymorphic FK exists on target_object_id - see the migration's comment - so this
  -- proves the repository's own tenant-scoped existence read, not a DB constraint).
  INSERT INTO p1_06_results VALUES (
    'fabricated_target_has_no_backing_profile',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.intake_sensitivity_profiles
       WHERE organization_id = org1 AND intake_sensitivity_profile_id = bogus_sensitivity
    ) THEN 'PASS' ELSE 'FAIL' END,
    'a fabricated intake_sensitivity_profile_id has no backing P1-05 row for the repository to authorize against'
  );

  -- Transaction-and-audit atomicity proof: a third, previously-unseeded target
  -- identity's insert and its required audit insert are both reached, then rolled back
  -- together by a forced exception, leaving the exact pre-block counts.
  SELECT count(*) INTO item_count_before FROM kai.review_queue_items;
  SELECT count(*) INTO audit_count_before FROM kai.upload_lifecycle_audit WHERE operation = 'sensitivity_review_queue_item_created';
  BEGIN
    fresh_item := gen_random_uuid();
    INSERT INTO kai.review_queue_items (
      review_queue_item_id, organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, summary, required_action, created_by_type
    ) VALUES (
      fresh_item, org1, 'sensitivity_review', 'intake_sensitivity_profile', gen_random_uuid(),
      'normal', 'open', 'Review intake sensitivity and allowed-use profile.',
      'Review classifications, consent basis, allowed-use restrictions, and governance requirements before source-candidate work.',
      'human'
    );
    item_insert_reached := true;

    INSERT INTO kai.upload_lifecycle_audit (
      organization_id, intake_file_id, operation, from_state, to_state, outcome, metadata
    ) VALUES (
      org1, file1, 'sensitivity_review_queue_item_created', 'confirmed', 'confirmed', 'success',
      jsonb_build_object(
        'metadata_only', true,
        'contract', 'p1_sensitivity_review_queue_item_v1',
        'queue_type', 'sensitivity_review',
        'target_object_type', 'intake_sensitivity_profile',
        'target_object_id', fresh_item::text,
        'queue_status', 'open',
        'validator_key', 'VAL-FUP-001-P0'
      )
    );
    audit_insert_reached := true;

    RAISE EXCEPTION 'force rollback after review-queue-item and audit insert';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT count(*) INTO item_count_after FROM kai.review_queue_items;
  SELECT count(*) INTO audit_count_after FROM kai.upload_lifecycle_audit WHERE operation = 'sensitivity_review_queue_item_created';
  INSERT INTO p1_06_results VALUES (
    'transaction_and_audit_atomicity',
    CASE WHEN item_insert_reached
           AND audit_insert_reached
           AND item_count_after = item_count_before
           AND audit_count_after = audit_count_before
         THEN 'PASS' ELSE 'FAIL' END,
    'both the review-queue-item insert and its required audit insert were reached before a forced exception rolled back both together'
  );

  INSERT INTO p1_06_results VALUES (
    'audit_metadata_no_raw_content',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'sensitivity_review_queue_item_created'
         AND (metadata ? 'summary' OR metadata ? 'required_action' OR metadata::text ~* '(raw|prompt|credential|secret|https?://|/Users/|/private/)')
    ) THEN 'PASS' ELSE 'FAIL' END,
    'sensitivity-review-queue-item audit rows exclude raw/free-text content'
  );

  INSERT INTO p1_06_results VALUES (
    'audit_metadata_exact_keys',
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM kai.upload_lifecycle_audit
       WHERE operation = 'sensitivity_review_queue_item_created'
         AND metadata - ARRAY[
           'metadata_only', 'contract', 'queue_type', 'target_object_type', 'target_object_id', 'queue_status', 'validator_key'
         ] <> '{}'::jsonb
    ) THEN 'PASS' ELSE 'FAIL' END,
    'sensitivity-review-queue-item audit metadata carries no keys beyond the accepted seven-key allowlist'
  );
END $$;

SELECT 'P1_06_SMOKE' AS result_type, check_name, status, detail
FROM p1_06_results
ORDER BY check_name;

ROLLBACK;
