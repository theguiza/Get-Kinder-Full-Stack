BEGIN;

CREATE SCHEMA IF NOT EXISTS kai;

DO $$
BEGIN
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'public.organizations is required before the KAI organization tenant-binding migration';
  END IF;
END $$;

-- Scope: this migration adds exactly one new, additive relation - an
-- explicit, durable binding between an existing Get Kinder
-- public.organizations.id (integer) and a KAI tenant organization_id
-- (uuid). It fabricates no equality and infers no relationship from names
-- or any other attribute: every row must be created explicitly through the
-- controlled upsertGkOrganizationBinding repository helper
-- (Backend/kai/db/kaiOrganizationBindingQueries.js). It changes no existing
-- kai.* table, constraint, or authorization semantics; kai.user_roles and
-- kai.organization_memberships remain fully intact and authoritative for
-- existing internal/legacy KAI actors.
--
-- MVP cardinality: at most one ACTIVE binding may exist per Get Kinder
-- organization, and at most one ACTIVE binding may exist per KAI tenant, at
-- any one time. Both are enforced by partial unique indexes scoped to
-- status = 'active', so a conflicting or ambiguous active mapping is a
-- database-level constraint violation, not merely an application-level
-- check. Historical (inactive) rows are retained rather than deleted so a
-- binding can be deactivated and later re-bound without losing lifecycle
-- history.
CREATE TABLE IF NOT EXISTS kai.gk_organization_bindings (
  gk_organization_binding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gk_organization_id integer NOT NULL REFERENCES public.organizations (id),
  kai_organization_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gk_organization_bindings_status_check
    CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gk_organization_bindings_active_gk_org
  ON kai.gk_organization_bindings (gk_organization_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS ux_gk_organization_bindings_active_kai_org
  ON kai.gk_organization_bindings (kai_organization_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_gk_organization_bindings_gk_org
  ON kai.gk_organization_bindings (gk_organization_id);

CREATE INDEX IF NOT EXISTS ix_gk_organization_bindings_kai_org
  ON kai.gk_organization_bindings (kai_organization_id);

CREATE OR REPLACE FUNCTION kai.touch_gk_organization_bindings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gk_organization_bindings_touch_updated_at ON kai.gk_organization_bindings;
CREATE TRIGGER trg_gk_organization_bindings_touch_updated_at
BEFORE UPDATE ON kai.gk_organization_bindings
FOR EACH ROW
EXECUTE FUNCTION kai.touch_gk_organization_bindings_updated_at();

COMMIT;
