BEGIN;

-- KAI Package 4 assembled proof: minimal additive auth-table mirror needed
-- so the REAL resolveKaiActorContext (Backend/kai/auth/kaiActorContext.js)
-- can run unmocked against a real actor, exactly as it does in production.
-- Applied AFTER scripts/kai-sprint2-organization-enablement-bootstrap-
-- synthetic-schema.sql (which already creates public.organizations,
-- kai.organizations, kai.engagements, kai.object_type_enum, and
-- kai.audit_events) - this file never recreates any of those. Columns are
-- the minimal synthetic mirror already used by
-- scripts/kai-sprint2-p2-access-administration-bootstrap-synthetic-schema.sql
-- for the same externally-managed tables; only public.organizations is
-- skipped here since the organization-enablement bootstrap already created
-- it.

CREATE TABLE public.userdata (
  id SERIAL PRIMARY KEY,
  org_id  INTEGER,
  org_rep BOOLEAN DEFAULT false
);

CREATE TABLE public.user_org_memberships (
  user_org_membership_id SERIAL PRIMARY KEY,
  org_id    INTEGER NOT NULL REFERENCES public.organizations (id),
  user_id   INTEGER NOT NULL REFERENCES public.userdata (id),
  role      VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true
);

CREATE OR REPLACE FUNCTION kai.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TABLE kai.users (
  user_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_identity_source     text NOT NULL,
  legacy_public_userdata_id  integer,
  status                     text NOT NULL DEFAULT 'active',
  email                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kai.roles (
  role_id   SERIAL PRIMARY KEY,
  role_name text NOT NULL UNIQUE
);
INSERT INTO kai.roles (role_name) VALUES
  ('gk_admin'), ('gk_operator'), ('gk_reviewer'),
  ('client_reviewer'), ('client_viewer'), ('funder_viewer');

CREATE TABLE kai.organization_memberships (
  organization_id   uuid NOT NULL,
  user_id           uuid NOT NULL REFERENCES kai.users (user_id),
  role_name         text NOT NULL,
  membership_status text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_memberships_status_check
    CHECK (membership_status IN ('active', 'inactive', 'revoked', 'invited')),
  CONSTRAINT organization_memberships_org_user_role_unique
    UNIQUE (organization_id, user_id, role_name)
);

CREATE TRIGGER trg_organization_memberships_updated_at
BEFORE UPDATE ON kai.organization_memberships
FOR EACH ROW
EXECUTE FUNCTION kai.set_updated_at();

CREATE TABLE kai.user_roles (
  user_role_id    bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES kai.users (user_id),
  role_id         integer NOT NULL REFERENCES kai.roles (role_id),
  organization_id uuid,
  engagement_id   uuid,
  active          boolean NOT NULL DEFAULT true,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  assigned_by     uuid,
  revoked_at      timestamptz,
  CONSTRAINT user_roles_user_role_org_engagement_unique
    UNIQUE (user_id, role_id, organization_id, engagement_id)
);

COMMIT;
