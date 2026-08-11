DROP TABLE IF EXISTS gk_org_binding_smoke_results;
CREATE TEMP TABLE gk_org_binding_smoke_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
);

DO $$
DECLARE
  seeded_active_kai_org uuid;
  seeded_active_status text;
  rejected boolean;
BEGIN
  -- 1. The seeded active binding reads back exactly as seeded.
  SELECT kai_organization_id, status INTO seeded_active_kai_org, seeded_active_status
    FROM kai.gk_organization_bindings WHERE gk_organization_id = 1;
  INSERT INTO gk_org_binding_smoke_results VALUES (
    'seeded_active_binding_reads_back',
    CASE WHEN seeded_active_kai_org = 'a5d17c5a-c55f-43af-9b21-fe63aafe733f' AND seeded_active_status = 'active'
         THEN 'PASS' ELSE 'FAIL' END,
    'the seeded org-1 active binding is readable exactly as written'
  );

  -- 2. Org 2's existing binding is inactive, so a NEW active binding for org
  --    2 to a DIFFERENT KAI tenant must succeed (an inactive row must not
  --    create an ambiguous active mapping).
  rejected := false;
  BEGIN
    INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
    VALUES (2, 'c5d17c5a-c55f-43af-9b21-fe63aafe733f', 'active');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO gk_org_binding_smoke_results VALUES (
    'inactive_row_does_not_block_new_active_binding',
    CASE WHEN NOT rejected THEN 'PASS' ELSE 'FAIL' END,
    'org 2''s pre-existing inactive binding does not prevent a new active binding for org 2'
  );

  -- 3. Org 2 now HAS an active binding (from step 2). A second active
  --    binding for org 2 (to yet another KAI tenant) must fail closed -
  --    active one-to-one uniqueness on the Get Kinder side.
  rejected := false;
  BEGIN
    INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
    VALUES (2, 'd5d17c5a-c55f-43af-9b21-fe63aafe733f', 'active');
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO gk_org_binding_smoke_results VALUES (
    'second_active_binding_for_same_gk_org_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a Get Kinder organization cannot have two simultaneously active bindings'
  );

  -- 4. Org 3 attempting to actively bind to org 1's already-active KAI
  --    tenant must fail closed - active one-to-one uniqueness on the KAI
  --    side.
  rejected := false;
  BEGIN
    INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
    VALUES (3, 'a5d17c5a-c55f-43af-9b21-fe63aafe733f', 'active');
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  INSERT INTO gk_org_binding_smoke_results VALUES (
    'conflicting_active_binding_for_same_kai_org_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a KAI tenant cannot be actively bound to two Get Kinder organizations at once'
  );

  -- 5. Once org 1's binding is explicitly deactivated, org 3 CAN actively
  --    bind to the now-freed KAI tenant - deactivation genuinely frees both
  --    sides, it is not a permanent lock.
  UPDATE kai.gk_organization_bindings SET status = 'inactive' WHERE gk_organization_id = 1;
  rejected := false;
  BEGIN
    INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
    VALUES (3, 'a5d17c5a-c55f-43af-9b21-fe63aafe733f', 'active');
  EXCEPTION WHEN OTHERS THEN
    rejected := true;
  END;
  INSERT INTO gk_org_binding_smoke_results VALUES (
    'deactivation_frees_kai_org_for_new_active_binding',
    CASE WHEN NOT rejected THEN 'PASS' ELSE 'FAIL' END,
    'deactivating a binding frees its KAI tenant id for a new active binding elsewhere'
  );

  -- 7. The foreign key to public.organizations is enforced - a binding for
  --    a nonexistent Get Kinder organization id is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
    VALUES (999999, 'f5d17c5a-c55f-43af-9b21-fe63aafe733f', 'active');
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  INSERT INTO gk_org_binding_smoke_results VALUES (
    'nonexistent_gk_organization_id_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'a binding cannot reference a Get Kinder organization id that does not exist'
  );

  -- 8. An invalid status value is rejected.
  rejected := false;
  BEGIN
    INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
    VALUES (5, '11111111-1111-4111-8111-111111111111', 'pending');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  INSERT INTO gk_org_binding_smoke_results VALUES (
    'invalid_status_value_rejected',
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END,
    'status accepts only active or inactive'
  );
END $$;

-- 6. updated_at is touched automatically on UPDATE. now()/updated_at only
-- advance between separate transactions (now() is fixed for the duration of
-- one transaction), so this must be three separate top-level statements
-- rather than one PL/pgSQL block.
DROP TABLE IF EXISTS gk_org_binding_timing;
CREATE TEMP TABLE gk_org_binding_timing AS
  SELECT NULL::timestamptz AS before_updated_at, NULL::timestamptz AS after_updated_at;

INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status)
VALUES (4, 'e5d17c5a-c55f-43af-9b21-fe63aafe733f', 'active');

UPDATE gk_org_binding_timing
   SET before_updated_at = (SELECT updated_at FROM kai.gk_organization_bindings WHERE gk_organization_id = 4);

SELECT pg_sleep(0.01);

UPDATE kai.gk_organization_bindings SET status = 'inactive' WHERE gk_organization_id = 4;

UPDATE gk_org_binding_timing
   SET after_updated_at = (SELECT updated_at FROM kai.gk_organization_bindings WHERE gk_organization_id = 4);

INSERT INTO gk_org_binding_smoke_results
SELECT 'updated_at_changes_on_update',
       CASE WHEN after_updated_at > before_updated_at THEN 'PASS' ELSE 'FAIL' END,
       'updated_at advances automatically when a binding row is updated'
  FROM gk_org_binding_timing;

SELECT * FROM gk_org_binding_smoke_results ORDER BY check_name;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gk_org_binding_smoke_results WHERE status <> 'PASS') THEN
    RAISE EXCEPTION 'gk_organization_tenant_binding smoke verifier failed';
  END IF;
END $$;
