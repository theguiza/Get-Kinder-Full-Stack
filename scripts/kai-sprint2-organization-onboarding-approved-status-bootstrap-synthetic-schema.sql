BEGIN;

-- Organization-onboarding approved-status reproduction: synthetic
-- production-shaped additions applied after
-- scripts/kai-sprint2-p2-access-administration-bootstrap-synthetic-schema.sql
-- and migrations/kai_sprint2_gk_organization_tenant_binding.sql. Only the
-- columns/constraints that the real approval route (routes/orgApplyApi.js
-- POST /admin/org-applications/:id/approve) writes and the real onboarding
-- status read path (services/orgScopeService.js, gkOrganizationApplicationQueries.js)
-- reads are mirrored here.

ALTER TABLE public.organizations
  ADD COLUMN description text,
  ADD COLUMN website text,
  ADD COLUMN rep_user_id integer,
  ADD COLUMN rep_role text,
  ADD COLUMN status text,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by text;

-- The approval route's ON CONFLICT (user_id, org_id) upsert requires this.
ALTER TABLE public.user_org_memberships
  ADD COLUMN added_by_user_id integer,
  ADD CONSTRAINT user_org_memberships_user_org_unique UNIQUE (user_id, org_id);

CREATE TABLE public.org_applications (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES public.userdata (id),
  org_name        text NOT NULL,
  org_description text,
  org_website     text,
  rep_role        text,
  status          text NOT NULL DEFAULT 'pending',
  submitted_at    timestamptz DEFAULT now(),
  reviewed_at     timestamptz,
  reviewed_by     text
);

-- Only the keys the read-only enablement status path
-- (Backend/kai/db/kaiOrganizationEnablementQueries.js selectKaiOrganizationRow /
-- selectInitialEngagementForOrganization) reads, so the KAI_AVAILABLE case can
-- run the real enablement read.
CREATE TABLE kai.organizations (
  organization_id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE kai.engagements (
  engagement_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES kai.organizations (organization_id),
  engagement_code text NOT NULL
);

COMMIT;
