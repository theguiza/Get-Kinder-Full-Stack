BEGIN;

-- Minimal synthetic mirror of the non-KAI table the enablement operation
-- reads from (public.organizations.id/name), plus the KAI-side tables/enum
-- this correction's transaction touches. This is not the full application
-- schema and does not assert completeness of any production enum - only
-- what is required to prove the verified organization-enablement contract:
-- public.organizations, kai.organizations, kai.engagements, and the minimal
-- kai.audit_events/kai.object_type_enum required-audit target.
-- kai.gk_organization_bindings is NOT created here - the real repository
-- migration (migrations/kai_sprint2_gk_organization_tenant_binding.sql) is
-- applied separately by the runner, exactly as the existing
-- gk-organization-tenant-binding local-postgres script does.

CREATE TABLE public.organizations (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

CREATE SCHEMA IF NOT EXISTS kai;

-- Minimal synthetic subset of the production enum kai.organizations.status
-- and kai.engagements.engagement_status share (per the owner-supplied
-- schema contract). Only the two labels this correction's default values
-- require are declared; this does not assert the enum's full production
-- label set.
CREATE TYPE kai.engagement_status_enum AS ENUM ('active', 'draft');

-- Synthetic mirror of the owner-supplied, USER_CONFIRMED production
-- kai.organizations schema. Not created by any repository migration -
-- kai.organizations remains externally owned; this DDL exists only to prove
-- the verified column list/defaults against real PostgreSQL.
CREATE TABLE kai.organizations (
  organization_id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                                text NOT NULL CHECK (length(trim(name)) > 0),
  organization_code                   text UNIQUE,
  organization_type                   text NOT NULL DEFAULT 'nonprofit',
  status                              kai.engagement_status_enum NOT NULL DEFAULT 'active',
  jurisdiction                        text,
  contract_ref                        text,
  dpa_ref                             text,
  legacy_public_organization_id       integer,
  legacy_public_organization_source   text,
  import_status_label                 text,
  created_by                          uuid,
  created_by_type                     text NOT NULL DEFAULT 'human',
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  updated_by                          uuid,
  last_audit_event_id                 bigint
);

-- USER_CONFIRMED: legacy_public_organization_id is NON-UNIQUE.
CREATE INDEX ix_kai_organizations_legacy_public_organization_id
  ON kai.organizations (legacy_public_organization_id);

-- kai.engagements is not created by any repository migration either
-- (confirmed by repository-wide search). Synthetic mirror of the
-- USER_CONFIRMED production column list this correction depends on.
CREATE TABLE kai.engagements (
  engagement_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES kai.organizations (organization_id),
  engagement_code    text NOT NULL,
  engagement_type    text NOT NULL DEFAULT 'pilot_assessment',
  engagement_status  kai.engagement_status_enum NOT NULL DEFAULT 'draft',
  created_by         uuid,
  created_by_type    text NOT NULL DEFAULT 'human',
  project_metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, engagement_code)
);

-- Minimal required-audit target: only the columns
-- Backend/kai/db/kaiAuditQueries.js#REQUIRED_AUDIT_INSERT_COLUMNS actually
-- reads/writes, plus a single-label object_type enum sufficient for this
-- package's "other" fallback (Backend/kai/db/kaiAuditQueries.js#resolveAuditObjectType).
CREATE TYPE kai.object_type_enum AS ENUM ('other');

CREATE TABLE kai.audit_events (
  audit_event_id    bigserial PRIMARY KEY,
  organization_id   uuid,
  actor_user_id     uuid,
  actor_type        text NOT NULL,
  action            text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_type       kai.object_type_enum NOT NULL,
  reason_code       text,
  reason_text       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMIT;
