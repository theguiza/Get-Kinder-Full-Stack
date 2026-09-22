DROP TABLE IF EXISTS package_g_failure_results;
CREATE TEMP TABLE package_g_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    INSERT INTO kai.improvement_practices (
      organization_id, engagement_id, title, rationale, status, cadence
    )
    VALUES (
      '17060000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000001',
      'Fabricated engagement practice',
      'Must be rejected.',
      'recommended',
      'monthly'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO package_g_failure_results VALUES ('fabricated_engagement_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'practice must FK to a real same-tenant engagement');

  rejected := false;
  BEGIN
    INSERT INTO kai.improvement_practices (
      organization_id, gap_log_item_id, title, rationale, status, cadence
    )
    VALUES (
      '17060000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000002',
      'Fabricated gap-origin practice',
      'Must be rejected.',
      'recommended',
      'monthly'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO package_g_failure_results VALUES ('fabricated_gap_log_item_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'practice must FK to a real same-tenant gap_log_item when an origin is given');

  rejected := false;
  BEGIN
    INSERT INTO kai.improvement_practices (
      organization_id, title, rationale, status, cadence
    )
    VALUES (
      '17060000-0000-4000-8000-000000000001',
      'Invalid status practice',
      'Must be rejected.',
      'invented_status',
      'monthly'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO package_g_failure_results VALUES ('invalid_status_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'status must be one of the four approved values');

  rejected := false;
  BEGIN
    INSERT INTO kai.improvement_practices (
      organization_id, title, rationale, status, cadence
    )
    VALUES (
      '17060000-0000-4000-8000-000000000001',
      'Invalid cadence practice',
      'Must be rejected.',
      'recommended',
      'invented_cadence'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO package_g_failure_results VALUES ('invalid_cadence_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'cadence must be one of the approved cadence values');

  rejected := false;
  BEGIN
    INSERT INTO kai.improvement_practices (
      organization_id, title, rationale, status, cadence
    )
    VALUES (
      '17060000-0000-4000-8000-000000000001',
      '   ',
      'Must be rejected.',
      'recommended',
      'monthly'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO package_g_failure_results VALUES ('blank_title_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'title must be non-blank');

  rejected := false;
  BEGIN
    INSERT INTO kai.improvement_practices (
      organization_id, title, rationale, status, cadence, created_by_type
    )
    VALUES (
      '17060000-0000-4000-8000-000000000001',
      'Invented created_by_type practice',
      'Must be rejected.',
      'recommended',
      'monthly',
      'assistant'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO package_g_failure_results VALUES ('invented_created_by_type_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'created_by_type must be human or system');
END $$;

ROLLBACK;

-- Positive control: unlike this schema's append-only ledgers, an ordinary
-- in-place status UPDATE on an existing practice IS permitted (proven fully
-- in the smoke verifier); no negative append-only-rejection check belongs
-- here, since this table is intentionally mutable.

SELECT * FROM package_g_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM package_g_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'Package G improvement-practices-foundation failure checks failed';
  END IF;
END $$;
