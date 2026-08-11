import { resolveOrgScopeForUserId } from "../../../services/orgScopeService.js";
import { listActiveGkOrganizationBindingsForGkOrganizationIds } from "../db/kaiOrganizationBindingQueries.js";

// Existing Get Kinder organization role -> effective KAI role translation.
// Deliberately narrow for this package: only the existing org-admin role
// (public.user_org_memberships.role === 'admin') derives a KAI role, and it
// derives exactly one role (client_admin). No other Get Kinder role value is
// translated.
export const GK_ORGANIZATION_ADMIN_ROLE = "admin";
export const EFFECTIVE_KAI_ROLE_FOR_GK_ORGANIZATION_ADMIN = "client_admin";

/**
 * Pure derivation: given the caller's existing Get Kinder organization
 * memberships (already filtered active by services/orgScopeService.js) and
 * the active kai.gk_organization_bindings rows keyed by Get Kinder
 * organization id, produce the read-only "effective" KAI organization
 * memberships this actor should be treated as holding. Nothing here is
 * persisted - it is recomputed on every actor-context resolution, so a
 * later membership or binding change (or deactivation) takes effect
 * immediately without any write to kai.organization_memberships.
 */
export function deriveEffectiveClientOrganizationMemberships({
  gkMemberships = [],
  activeBindingsByGkOrganizationId = new Map(),
} = {}) {
  const memberships = [];
  for (const membership of gkMemberships) {
    if (!membership || membership.role !== GK_ORGANIZATION_ADMIN_ROLE) continue;
    if (membership.is_active === false) continue;
    const gkOrganizationId = Number(membership.orgId);
    if (!Number.isInteger(gkOrganizationId) || gkOrganizationId <= 0) continue;
    const binding = activeBindingsByGkOrganizationId.get(gkOrganizationId);
    if (!binding || binding.status !== "active") continue;
    memberships.push({
      organization_id: binding.kai_organization_id,
      role_name: EFFECTIVE_KAI_ROLE_FOR_GK_ORGANIZATION_ADMIN,
      membership_status: "active",
      source: "gk_organization_binding",
      gk_organization_id: gkOrganizationId,
    });
  }
  return memberships;
}

/**
 * Orchestration: authenticated Get Kinder user -> existing Get Kinder
 * organization scope (services/orgScopeService.js#resolveOrgScopeForUserId,
 * reused as-is - no admin-preview/session impersonation path, since it is
 * called with a raw legacy user id rather than a request/session) -> active
 * explicit binding(s) for those organizations -> effective KAI tenant
 * membership. Returns [] (fail closed) whenever the user has no active Get
 * Kinder organization-admin membership or no active binding exists for it -
 * never grants access from authentication alone.
 */
export async function resolveEffectiveClientOrganizationMembershipsForLegacyUser(
  legacyPublicUserdataId,
  dependencies = {},
) {
  const resolveScope = dependencies.resolveOrgScopeForUserId || resolveOrgScopeForUserId;
  const listBindings =
    dependencies.listActiveGkOrganizationBindingsForGkOrganizationIds ||
    listActiveGkOrganizationBindingsForGkOrganizationIds;

  const scope = await resolveScope(legacyPublicUserdataId);
  const gkMemberships = Array.isArray(scope?.memberships) ? scope.memberships : [];

  const adminGkOrganizationIds = gkMemberships
    .filter((membership) => membership?.role === GK_ORGANIZATION_ADMIN_ROLE && membership?.is_active !== false)
    .map((membership) => Number(membership.orgId))
    .filter((orgId) => Number.isInteger(orgId) && orgId > 0);

  if (adminGkOrganizationIds.length === 0) return [];

  const bindings = await listBindings(adminGkOrganizationIds);
  const activeBindingsByGkOrganizationId = new Map(
    (Array.isArray(bindings) ? bindings : [])
      .filter((binding) => binding?.status === "active")
      .map((binding) => [Number(binding.gk_organization_id), binding]),
  );

  return deriveEffectiveClientOrganizationMemberships({ gkMemberships, activeBindingsByGkOrganizationId });
}
