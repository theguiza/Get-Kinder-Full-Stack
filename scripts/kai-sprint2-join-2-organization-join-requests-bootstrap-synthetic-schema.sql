BEGIN;

-- JOIN-2 synthetic prerequisite, applied after the JOIN-1 bootstrap.
-- kai.organization_memberships is externally owned; this mirrors only the
-- USER_CONFIRMED shape already used by
-- scripts/kai-sprint2-p2-access-administration-bootstrap-synthetic-schema.sql
-- (status vocabulary and UNIQUE (organization_id, user_id, role_name)).
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

COMMIT;
