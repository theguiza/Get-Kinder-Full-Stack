BEGIN;

CREATE TEMP TABLE p1_06_failure_results (
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  org1 uuid := '00000000-0000-4000-8000-000000000001';
  file1 uuid := '20000000-0000-4000-8000-000000000001';
  sensitivity1 uuid := '80000000-0000-4000-8000-000000000001';
  bogus_sensitivity uuid := '80000000-0000-4000-8000-000000000998';
  fabricated_target_row_id uuid;
BEGIN
  -- queue_type vocabulary rejection.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'not_a_real_queue_type', 'intake_sensitivity_profile', sensitivity1, 'x');
    INSERT INTO p1_06_failure_results VALUES ('queue_type_vocabulary_enforced', 'FAIL', 'unsupported queue_type unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('queue_type_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- queue_status vocabulary rejection.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, queue_status)
    VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity1, 'x', 'not_a_real_status');
    INSERT INTO p1_06_failure_results VALUES ('queue_status_vocabulary_enforced', 'FAIL', 'unsupported queue_status unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('queue_status_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- priority vocabulary rejection.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, priority)
    VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity1, 'x', 'not_a_real_priority');
    INSERT INTO p1_06_failure_results VALUES ('priority_vocabulary_enforced', 'FAIL', 'unsupported priority unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('priority_vocabulary_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- target_object_id NOT NULL enforcement.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', NULL, 'x');
    INSERT INTO p1_06_failure_results VALUES ('target_object_id_not_null_enforced', 'FAIL', 'null target_object_id unexpectedly accepted');
  EXCEPTION WHEN not_null_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('target_object_id_not_null_enforced', 'PASS', 'safe not-null-violation failure');
  END;

  -- summary non-empty enforcement.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity1, '');
    INSERT INTO p1_06_failure_results VALUES ('summary_non_empty_enforced', 'FAIL', 'empty summary unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('summary_non_empty_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- summary bounded-length enforcement.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity1, repeat('x', 2001));
    INSERT INTO p1_06_failure_results VALUES ('summary_bounded_length_enforced', 'FAIL', 'over-length summary unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('summary_bounded_length_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- required_action, when present, must be non-empty and bounded.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary, required_action)
    VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', sensitivity1, 'x', '');
    INSERT INTO p1_06_failure_results VALUES ('required_action_non_empty_enforced', 'FAIL', 'empty required_action unexpectedly accepted');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('required_action_non_empty_enforced', 'PASS', 'safe check-violation failure');
  END;

  -- unique-identity enforcement (organization_id, queue_type, target_object_type, target_object_id)
  -- for the sensitivity_review partial unique index.
  fabricated_target_row_id := gen_random_uuid();
  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
  VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', fabricated_target_row_id, 'x');
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', fabricated_target_row_id, 'y');
    INSERT INTO p1_06_failure_results VALUES ('sensitivity_review_identity_unique_enforced', 'FAIL', 'duplicate sensitivity_review identity unexpectedly accepted');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('sensitivity_review_identity_unique_enforced', 'PASS', 'safe unique-violation failure');
  END;

  -- Other queue_types are NOT deduplicated by the sensitivity_review partial unique
  -- index: a second 'intake_file_review' row for the same target succeeds, proving the
  -- P1-06 idempotency identity did not become a table-wide constraint that would break
  -- an existing queue_type's legitimate multi-row-per-target behavior.
  INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
  VALUES (org1, 'intake_file_review', 'intake_file', file1, 'first review');
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'intake_file_review', 'intake_file', file1, 'second review');
    INSERT INTO p1_06_failure_results VALUES ('other_queue_types_not_deduplicated', 'PASS', 'a second intake_file_review row for the same target was correctly not rejected');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO p1_06_failure_results VALUES ('other_queue_types_not_deduplicated', 'FAIL', 'the sensitivity_review-only partial unique index unexpectedly rejected an unrelated queue_type');
  END;

  -- No table-wide foreign key exists on target_object_id (documented in the migration):
  -- a fabricated, never-committed intake_sensitivity_profile_id is NOT rejected by the
  -- database at the raw-SQL level, because enforcement for the 'sensitivity_review'
  -- lineage is authoritative and application-level, inside the P1-06 repository
  -- transaction (see readScopedSensitivityProfile in
  -- Backend/kai/dictionary/postgresReviewQueueRepository.js), not a DB constraint.
  BEGIN
    INSERT INTO kai.review_queue_items (organization_id, queue_type, target_object_type, target_object_id, summary)
    VALUES (org1, 'sensitivity_review', 'intake_sensitivity_profile', bogus_sensitivity, 'x');
    INSERT INTO p1_06_failure_results VALUES (
      'fabricated_target_no_db_level_fk_by_design', 'PASS',
      'the database itself does not reject a fabricated intake_sensitivity_profile_id; the P1-06 repository enforces this authoritatively inside its own transaction instead'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO p1_06_failure_results VALUES (
      'fabricated_target_no_db_level_fk_by_design', 'FAIL',
      'an unexpected foreign-key violation was raised; the migration intentionally adds no FK on the shared target_object_id column'
    );
  END;
END $$;

SELECT 'P1_06_READ_ONLY_FAILURE_CHECKS' AS result_type, check_name, 'kai.review_queue_items' AS object_name, status, detail
FROM p1_06_failure_results
ORDER BY check_name;

ROLLBACK;
