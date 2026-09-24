BEGIN;

-- JOIN-1 synthetic prerequisite, applied after
-- scripts/kai-sprint2-organization-enablement-bootstrap-synthetic-schema.sql
-- (which already mirrors kai.organizations). kai.users is externally owned -
-- no repository migration creates it - so this mirrors only the
-- USER_CONFIRMED column shape already used by
-- scripts/kai-sprint2-p2-access-administration-bootstrap-synthetic-schema.sql.
-- JOIN-1 depends only on kai.users (user_id) being its primary key.
CREATE TABLE kai.users (
  user_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_identity_source     text NOT NULL,
  legacy_public_userdata_id  integer,
  status                     text NOT NULL DEFAULT 'active',
  email                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

COMMIT;
