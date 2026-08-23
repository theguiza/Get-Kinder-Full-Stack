BEGIN;

-- Minimal synthetic mirror of the owner-supplied, USER_CONFIRMED production
-- catalog evidence (pgAdmin Query 1-6) this Package 2 closure reconciles
-- against. kai.users, kai.roles, kai.organization_memberships,
-- kai.user_roles, and kai.audit_events are all externally managed - no
-- CREATE TABLE for any of them exists elsewhere in this repository (see
-- Backend/kai/db/kaiAccessAdministrationQueries.js) - so this DDL exists
-- only to prove the reconciled Package 2 SQL against the relevant deployed
-- columns/types/defaults/nullability/constraints/indexes/enum
-- values/triggers. It is not the full application schema and does not
-- assert completeness beyond what this closure's verifier cases require.

CREATE TABLE public.userdata (
  id SERIAL PRIMARY KEY,
  org_id  INTEGER,
  org_rep BOOLEAN DEFAULT false
);

CREATE TABLE public.organizations (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

-- Primary derived-client_admin roster path
-- (Backend/kai/auth/gkOrganizationAdminQueries.js#listActiveGkOrganizationAdminLegacyUserIds)
-- when this table exists.
CREATE TABLE public.user_org_memberships (
  user_org_membership_id SERIAL PRIMARY KEY,
  org_id    INTEGER NOT NULL REFERENCES public.organizations (id),
  user_id   INTEGER NOT NULL REFERENCES public.userdata (id),
  role      VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true
);

CREATE SCHEMA IF NOT EXISTS kai;

-- USER_CONFIRMED: kai.set_updated_at() has no authorization, tenant, audit,
-- or state-transition side effects - it only touches updated_at.
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

-- USER_CONFIRMED production global-role vocabulary. client_admin and
-- client_contributor are deliberately NOT rows here: this package never
-- creates a global client_admin, and organization client roles are managed
-- through kai.organization_memberships, not kai.roles/kai.user_roles.
CREATE TABLE kai.roles (
  role_id   SERIAL PRIMARY KEY,
  role_name text NOT NULL UNIQUE
);
INSERT INTO kai.roles (role_name) VALUES
  ('gk_admin'), ('gk_operator'), ('gk_reviewer'),
  ('client_reviewer'), ('client_viewer'), ('funder_viewer');

-- USER_CONFIRMED: membership_status permits active/inactive/revoked/invited;
-- UNIQUE (organization_id, user_id, role_name) - NOT (organization_id,
-- user_id) - so more than one stored role row per user+organization is
-- permitted by PostgreSQL itself. Has an updated_at trigger using
-- kai.set_updated_at().
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

-- USER_CONFIRMED: organization_id/engagement_id nullable (NULL = global
-- scope); UNIQUE (user_id, role_id, organization_id, engagement_id) does
-- NOT by itself prevent duplicate NULL-scoped (global) rows for the same
-- user+role, since PostgreSQL treats each NULL as distinct for uniqueness.
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

-- USER_CONFIRMED existing object_type_enum labels this closure depends on
-- (organization/user/role/audit_event/other); action is non-null text
-- constrained only to be nonblank; metadata is jsonb with a safe default.
CREATE TYPE kai.object_type_enum AS ENUM ('organization', 'user', 'role', 'audit_event', 'other');

CREATE TABLE kai.audit_events (
  audit_event_id  bigserial PRIMARY KEY,
  organization_id uuid,
  actor_user_id   uuid,
  actor_type      text NOT NULL,
  action          text NOT NULL CHECK (length(trim(action)) > 0),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type     kai.object_type_enum NOT NULL,
  reason_code     text,
  reason_text     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMIT;
