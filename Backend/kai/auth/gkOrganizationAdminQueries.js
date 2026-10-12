import pool from "../../db/pg.js";
import { hasUserOrgMembershipTable } from "../../../services/orgScopeService.js";

/**
 * Reverse of Backend/kai/db/kaiOrganizationBindingQueries.js's
 * gk-organization-id-keyed lookups: given a KAI organization id, find the
 * active Get Kinder organization bound to it (if any). Read-only; only
 * status='active' bindings count, matching the same fail-closed rule the
 * forward lookup already enforces.
 */
export async function getActiveGkOrganizationIdForKaiOrganization(kaiOrganizationId, db = pool) {
  const { rows } = await db.query(
    `SELECT gk_organization_id
       FROM kai.gk_organization_bindings
      WHERE kai_organization_id = $1
        AND status = 'active'
      LIMIT 1`,
    [kaiOrganizationId],
  );
  const value = rows[0]?.gk_organization_id;
  return Number.isInteger(value) ? value : null;
}

/**
 * Existing Get Kinder org-admin membership, read the same way
 * gkOrganizationBindingAuthority.js's per-user derivation already trusts
 * (services/orgScopeService.js#hasUserOrgMembershipTable), but listing every
 * admin for one organization rather than one user's own memberships - used
 * only to compute whether an organization's derived client_admin authority
 * is non-empty (roster display, last-admin protection). Never creates or
 * changes a row.
 */
export async function listActiveGkOrganizationAdminLegacyUserIds(gkOrganizationId, db = pool) {
  if (!Number.isInteger(gkOrganizationId) || gkOrganizationId <= 0) return [];

  if (await hasUserOrgMembershipTable()) {
    const { rows } = await db.query(
      `SELECT user_id
         FROM public.user_org_memberships
        WHERE org_id = $1
          AND role = 'admin'
          AND COALESCE(is_active, true) = true`,
      [gkOrganizationId],
    );
    return rows.map((row) => Number(row.user_id)).filter((id) => Number.isInteger(id) && id > 0);
  }

  const { rows } = await db.query(
    `SELECT id FROM public.userdata WHERE org_id = $1 AND org_rep = true`,
    [gkOrganizationId],
  );
  return rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Whether an organization currently has at least one derived client_admin
 * who can actually exercise it: an active Get Kinder org-admin for the GK
 * organization actively bound to this KAI organization, whose
 * public.userdata identity is mapped to kai.users and every such mapping is
 * active. resolveKaiActorContext refuses an actor whose mapping is not
 * active (it never resurrects one), so an org-admin row alone - a
 * deactivated KAI account, or one never provisioned yet - is not counted.
 * Used by last-admin protection alongside the stored-membership count;
 * never persisted.
 */
export async function hasActiveDerivedClientAdminForOrganization(kaiOrganizationId, db = pool) {
  const gkOrganizationId = await getActiveGkOrganizationIdForKaiOrganization(kaiOrganizationId, db);
  if (!gkOrganizationId) return false;
  const adminIds = await listActiveGkOrganizationAdminLegacyUserIds(gkOrganizationId, db);
  if (adminIds.length === 0) return false;
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1
         FROM kai.users
        WHERE legacy_identity_source = 'public.userdata'
          AND legacy_public_userdata_id = ANY($1::int[])
        GROUP BY legacy_public_userdata_id
       HAVING bool_and(status = 'active')
     ) AS has_effective_admin`,
    [adminIds],
  );
  return rows[0]?.has_effective_admin === true;
}
