BEGIN;

-- JOIN-3 synthetic prerequisite, applied after the JOIN-2 bootstrap and the
-- real migrations/kai_sprint2_gk_organization_tenant_binding.sql. Mirrors
-- only the public.userdata columns the derived GK->KAI client_admin roster
-- fallback reads (Backend/kai/auth/gkOrganizationAdminQueries.js
-- #listActiveGkOrganizationAdminLegacyUserIds when public.user_org_memberships
-- is not detected), matching
-- scripts/kai-sprint2-p2-access-administration-bootstrap-synthetic-schema.sql.
CREATE TABLE public.userdata (
  id      SERIAL PRIMARY KEY,
  org_id  INTEGER,
  org_rep BOOLEAN DEFAULT false
);

COMMIT;
