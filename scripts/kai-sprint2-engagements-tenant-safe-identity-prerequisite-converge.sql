BEGIN;

-- OWNERSHIP MODEL (read this before touching this file):
--
-- kai.engagements is externally owned - it is not created by any repository
-- migration (confirmed by repository-wide search; see
-- scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql's
-- own comment to the same effect). Repository precedent
-- (migrations/kai_sprint2_gk_organization_tenant_binding.sql, which only
-- checks `to_regclass('public.organizations') IS NULL` and never issues
-- ALTER TABLE against public.organizations; migrations/kai_sprint2_p3_19_export_manifest_foundation.sql,
-- whose own comment states "kai.audit_events, an externally-owned table, ...
-- no schema change to it is needed or made here") establishes that a
-- repository KAI package never owns a schema mutation against an
-- externally-established table. The mechanism this repository already uses
-- for such external preconditions is a fail-closed, semantic (not
-- name-hardcoded) existence check - exactly the pattern already committed in
-- migrations/kai_sprint2_br_02_board_reporting_candidate_foundation.sql,
-- which already refuses to proceed unless a UNIQUE (engagement_id,
-- organization_id) constraint is present on kai.engagements.
--
-- Because of that, this file is deliberately NOT a migrations/*.sql file and
-- must never be added to migrations/ or run against a real/shared/production
-- database. It exists only to let this repository's own local/ephemeral
-- synthetic-Postgres test runners (which build a synthetic kai.engagements
-- table from scratch - see
-- scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql)
-- converge to the same USER_CONFIRMED-in-production prerequisite BR-02's
-- precondition check requires, without ever asserting ownership over the
-- real, externally-owned production table. In production the prerequisite
-- is already established (USER_CONFIRMED), so this file has nothing to do
-- there and is never invoked outside a runner-owned synthetic database.
--
-- Detected and created semantically - by column set, not by a specific
-- constraint name - so this converges to a no-op wherever a compatible
-- UNIQUE (engagement_id, organization_id) constraint already exists under
-- any name (including a synthetic double built to mirror a real production
-- shape). Only ever adds a constraint under its own fixed name; never
-- replaces or renames an existing one.

DO $$
BEGIN
  IF to_regclass('kai.engagements') IS NULL THEN
    RAISE EXCEPTION 'kai.engagements is required before the engagements tenant-safe-identity prerequisite convergence script';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'kai.engagements'::regclass
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname ORDER BY a.attname)
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = k.attnum
      ) = ARRAY['engagement_id', 'organization_id']::name[]
  ) THEN
    ALTER TABLE kai.engagements
      ADD CONSTRAINT kai_engagements_tenant_safe_identity_prerequisite_unique
      UNIQUE (engagement_id, organization_id);
  END IF;
END $$;

COMMIT;
