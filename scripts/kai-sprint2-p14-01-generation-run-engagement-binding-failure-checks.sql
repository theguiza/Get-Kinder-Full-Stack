DROP TABLE IF EXISTS p14_01_failure_results;
CREATE TEMP TABLE p14_01_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  rejected boolean;
BEGIN
  -- A fabricated engagement_id (no such row in kai.engagements at all) must
  -- be rejected by the tenant-safe composite FK.
  rejected := false;
  BEGIN
    INSERT INTO kai.generation_runs (
      organization_id,
      engagement_id,
      idempotency_key,
      request_fingerprint,
      content_type,
      requested_audience,
      created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000001',
      'p14-01-invalid-fabricated-engagement',
      repeat('7', 64),
      'evidence_summary',
      'internal',
      'system'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_01_failure_results
  VALUES ('fabricated_engagement_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a generation_runs.engagement_id with no matching kai.engagements row is rejected by the composite FK');

  -- A real engagement that belongs to a DIFFERENT organization than the one
  -- named on the generation_runs row must be rejected: the composite FK
  -- (engagement_id, organization_id) requires both to match the same
  -- kai.engagements row, so an engagement can never be attached
  -- cross-tenant.
  rejected := false;
  BEGIN
    INSERT INTO kai.generation_runs (
      organization_id,
      engagement_id,
      idempotency_key,
      request_fingerprint,
      content_type,
      requested_audience,
      created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000002',
      '14010000-0000-4000-8000-000000000001',
      'p14-01-invalid-cross-tenant-engagement',
      repeat('8', 64),
      'evidence_summary',
      'internal',
      'system'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_01_failure_results
  VALUES ('cross_tenant_engagement_organization_pair_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'an engagement_id that exists but belongs to a different organization_id is rejected by the composite FK');

  -- A NULL engagement_id (the legacy/historical shape) must remain accepted:
  -- MATCH SIMPLE exempts a NULL column from FK enforcement, and this
  -- migration deliberately does not tighten engagement_id to NOT NULL.
  rejected := false;
  BEGIN
    INSERT INTO kai.generation_runs (
      organization_id,
      engagement_id,
      idempotency_key,
      request_fingerprint,
      content_type,
      requested_audience,
      created_by_type
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      NULL,
      'p14-01-valid-null-engagement',
      repeat('9', 64),
      'evidence_summary',
      'internal',
      'system'
    );
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_01_failure_results
  VALUES ('historical_null_engagement_accepted', CASE WHEN NOT rejected THEN 'PASS' ELSE 'FAIL' END, 'a NULL engagement_id is accepted (legacy/historical state is valid, not an error)');
END $$;

ROLLBACK;

SELECT * FROM p14_01_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_01_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-01 generation-run engagement-binding failure-checks verifier failed';
  END IF;
END $$;
