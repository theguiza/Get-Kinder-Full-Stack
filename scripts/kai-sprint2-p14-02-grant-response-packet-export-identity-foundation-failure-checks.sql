DROP TABLE IF EXISTS p14_02_failure_results;
CREATE TEMP TABLE p14_02_failure_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

BEGIN;

DO $$
DECLARE
  rejected boolean;
BEGIN
  -- A fabricated engagement_id (no matching kai.engagements row at all) must
  -- be rejected by the tenant-safe composite FK.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_identities (
      organization_id, engagement_id, packet_audience, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000001',
      'funder',
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_02_failure_results
  VALUES ('fabricated_engagement_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'an engagement_id with no matching kai.engagements row is rejected by the composite FK');

  -- A real engagement that belongs to a DIFFERENT organization must be
  -- rejected: the composite FK requires both engagement_id and
  -- organization_id to match the same kai.engagements row.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_identities (
      organization_id, engagement_id, packet_audience, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000002',
      '14020000-0000-4000-8000-000000000001',
      'funder',
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_02_failure_results
  VALUES ('cross_tenant_engagement_organization_pair_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'an engagement_id that exists but belongs to a different organization_id is rejected by the composite FK');

  -- packet_audience is pinned to the single existing supported value;
  -- anything else must be rejected by the CHECK constraint.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_identities (
      organization_id, engagement_id, packet_audience, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '14020000-0000-4000-8000-000000000001',
      'internal',
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_02_failure_results
  VALUES ('non_funder_audience_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'packet_audience values other than funder are rejected by the audience CHECK constraint');

  -- A NULL engagement_id must be rejected: unlike P14-01's optional lineage
  -- column, this identity table's engagement_id is NOT NULL - a packet is
  -- never identified without an engagement.
  rejected := false;
  BEGIN
    INSERT INTO kai.grant_response_packet_export_identities (
      organization_id, engagement_id, packet_audience, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      NULL,
      'funder',
      '00000000-0000-4000-8000-000000000901'
    );
  EXCEPTION WHEN not_null_violation THEN
    rejected := true;
  END;
  INSERT INTO p14_02_failure_results
  VALUES ('null_engagement_rejected', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'a NULL engagement_id is rejected - this identity is always engagement-scoped');
END $$;

ROLLBACK;

-- Immutability must be proven against a row that actually persists, so this
-- part runs outside the rolled-back probe transaction above, against the
-- real seeded row from the smoke-seed script.
DO $$
DECLARE
  rejected boolean;
BEGIN
  rejected := false;
  BEGIN
    UPDATE kai.grant_response_packet_export_identities
       SET created_by = '00000000-0000-4000-8000-000000000999'
     WHERE grant_response_packet_export_identity_id = '14020000-0000-4000-8000-000000000301';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_02_failure_results
  VALUES ('update_rejected_append_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'UPDATE on an existing identity row is rejected by the append-only trigger');

  rejected := false;
  BEGIN
    DELETE FROM kai.grant_response_packet_export_identities
     WHERE grant_response_packet_export_identity_id = '14020000-0000-4000-8000-000000000301';
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO p14_02_failure_results
  VALUES ('delete_rejected_append_only', CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END, 'DELETE on an existing identity row is rejected by the append-only trigger');
END $$;

SELECT * FROM p14_02_failure_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM p14_02_failure_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'P14-02 grant-response-packet-export-identity-foundation failure-checks verifier failed';
  END IF;
END $$;
