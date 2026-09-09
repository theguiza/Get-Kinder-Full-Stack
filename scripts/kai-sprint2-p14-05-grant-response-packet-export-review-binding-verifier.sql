DROP TABLE IF EXISTS p14_05_results;
DROP TABLE IF EXISTS p14_05_expected_checks;

CREATE TEMP TABLE p14_05_expected_checks (
  check_name text PRIMARY KEY
);

INSERT INTO p14_05_expected_checks (check_name)
VALUES
  ('export_review_contract_admits_both_target_object_types'),
  ('export_review_p3_13_contract_removed'),
  ('export_review_identity_unique_index_present'),
  ('single_draft_row_still_valid_under_widened_contract'),
  ('packet_candidate_row_valid_under_widened_contract'),
  ('packet_row_wrong_target_object_type_rejected'),
  ('packet_row_wrong_summary_rejected'),
  ('no_new_queue_type_introduced'),
  ('no_polymorphic_fk_on_target_object_id');

CREATE TEMP TABLE p14_05_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

INSERT INTO p14_05_results
SELECT 'export_review_contract_admits_both_target_object_types',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p14_05_export_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the widened export_review contract admits both generated_content_draft and grant_response_packet_export_candidate targets';

INSERT INTO p14_05_results
SELECT 'export_review_p3_13_contract_removed',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p3_13_export_review_contract_check'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the single-target P3-13 contract check is replaced (not duplicated) by the P14-05 two-target check';

INSERT INTO p14_05_results
SELECT 'export_review_identity_unique_index_present',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_indexes
               WHERE schemaname = 'kai'
                 AND indexname = 'ux_review_queue_items_p3_05_export_review_identity'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the P3-05 partial unique index enforcing at most one export_review row per organization/target is preserved unchanged';

DO $$
DECLARE
  org_id uuid := '00000000-0000-4000-8000-0000000000f1';
  other_org_id uuid := '00000000-0000-4000-8000-0000000000f2';
  draft_target uuid := '00000000-0000-4000-8000-0000000000f3';
  packet_candidate_target uuid := '00000000-0000-4000-8000-0000000000f4';
  ok boolean;
BEGIN
  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action,
      created_by, created_by_type
    ) VALUES (
      org_id, 'export_review', 'generated_content_draft', draft_target,
      'medium', 'open', 'needs_gk_review',
      'Generated draft requires export review.',
      'Review audience authority, current eligibility, citations, and the final export gate before any export.',
      NULL, 'system'
    );
    ok := TRUE;
  EXCEPTION WHEN OTHERS THEN
    ok := FALSE;
  END;
  INSERT INTO p14_05_results
    VALUES ('single_draft_row_still_valid_under_widened_contract',
            CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
            'an existing-shape generated_content_draft export_review row is still admitted after widening');

  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action,
      created_by, created_by_type
    ) VALUES (
      org_id, 'export_review', 'grant_response_packet_export_candidate', packet_candidate_target,
      'medium', 'open', 'needs_gk_review',
      'Grant Response Packet export candidate requires export review.',
      'Review packet membership, funder audience, and export authority before any export.',
      NULL, 'system'
    );
    ok := TRUE;
  EXCEPTION WHEN OTHERS THEN
    ok := FALSE;
  END;
  INSERT INTO p14_05_results
    VALUES ('packet_candidate_row_valid_under_widened_contract',
            CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
            'a grant_response_packet_export_candidate export_review row using the packet static contract is admitted');

  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action,
      created_by, created_by_type
    ) VALUES (
      other_org_id, 'export_review', 'some_other_object_type', packet_candidate_target,
      'medium', 'open', 'needs_gk_review',
      'Grant Response Packet export candidate requires export review.',
      'Review packet membership, funder audience, and export authority before any export.',
      NULL, 'system'
    );
    ok := TRUE;
  EXCEPTION WHEN OTHERS THEN
    ok := FALSE;
  END;
  INSERT INTO p14_05_results
    VALUES ('packet_row_wrong_target_object_type_rejected',
            CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END,
            'an export_review row with an unrecognized target_object_type is still rejected by the widened contract');

  BEGIN
    INSERT INTO kai.review_queue_items (
      organization_id, queue_type, target_object_type, target_object_id,
      priority, queue_status, review_status, summary, required_action,
      created_by, created_by_type
    ) VALUES (
      other_org_id, 'export_review', 'grant_response_packet_export_candidate', packet_candidate_target,
      'medium', 'open', 'needs_gk_review',
      'wrong summary',
      'Review packet membership, funder audience, and export authority before any export.',
      NULL, 'system'
    );
    ok := TRUE;
  EXCEPTION WHEN OTHERS THEN
    ok := FALSE;
  END;
  INSERT INTO p14_05_results
    VALUES ('packet_row_wrong_summary_rejected',
            CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END,
            'a packet export_review row with anything other than the pinned static summary/required_action is rejected');
END $$;

INSERT INTO p14_05_results
SELECT 'no_new_queue_type_introduced',
       CASE WHEN EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p1_06_queue_type_check'
                 AND pg_get_constraintdef(oid) LIKE '%''export_review''%'
            )
            AND NOT EXISTS (
              SELECT 1
                FROM pg_constraint
               WHERE conname = 'review_queue_items_p1_06_queue_type_check'
                 AND (
                   pg_get_constraintdef(oid) LIKE '%packet_export_review%'
                   OR pg_get_constraintdef(oid) LIKE '%grant_packet_review%'
                 )
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'the queue_type enum is unchanged: the existing export_review value is reused, no new queue_type value was added';

INSERT INTO p14_05_results
SELECT 'no_polymorphic_fk_on_target_object_id',
       CASE WHEN NOT EXISTS (
              SELECT 1
                FROM pg_constraint c
               WHERE c.conrelid = 'kai.review_queue_items'::regclass
                 AND c.contype = 'f'
                 AND pg_get_constraintdef(c.oid) LIKE '%target_object_id%'
            )
            THEN 'PASS' ELSE 'FAIL' END,
       'no table-wide foreign key was added on the polymorphic target_object_id column - tenant/existence binding stays an application-layer transactional proof, per the existing P1-06 convention';

DO $$
DECLARE
  expected_count integer := 9;
BEGIN
  IF (SELECT COUNT(*) FROM p14_05_expected_checks) <> expected_count
     OR (SELECT COUNT(*) FROM p14_05_results) <> expected_count
     OR EXISTS (
          SELECT 1
            FROM p14_05_results r
           GROUP BY r.check_name
          HAVING COUNT(*) <> 1
        )
     OR EXISTS (
          SELECT 1
            FROM p14_05_expected_checks e
            LEFT JOIN p14_05_results r ON r.check_name = e.check_name
           WHERE r.check_name IS NULL
        )
     OR EXISTS (
          SELECT 1
            FROM p14_05_results r
            LEFT JOIN p14_05_expected_checks e ON e.check_name = r.check_name
           WHERE e.check_name IS NULL
        ) THEN
    RAISE EXCEPTION 'P14-05 grant-response-packet-export-review-binding verifier result construction failed';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_05_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-05 grant-response-packet-export-review-binding verifier failed';
  END IF;
END $$;

SELECT
  check_name,
  status,
  detail
FROM p14_05_results
ORDER BY check_name;
