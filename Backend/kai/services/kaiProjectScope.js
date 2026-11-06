import { buildKaiError } from "../errors/kaiErrors.js";
import { getEngagementForOrganization } from "../db/kaiQueries.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

/**
 * Optional Project (engagement) scope for the organization's Sources,
 * Evidence and Claims reads (owner direction 2026-11-06). Called after the
 * read's own role and tenant checks: an engagement must belong to the same
 * organization, exactly as generation checks it. No engagement keeps the
 * organization-wide library read, with its read-model arguments unchanged.
 */
export async function resolveProjectScope({ organizationId, engagementId }, dependencies = {}) {
  if (engagementId === null || engagementId === undefined) return { readOptions: {} };
  const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
  const engagementRecord = await readEngagement({ organizationId, engagementId });
  if (!engagementRecord) return { error: buildKaiError("not_found") };
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId, engagement_id: engagementId },
    engagementRecord,
  });
  if (tenant.severity === "blocker") return { error: buildKaiError("tenant_boundary_violation", { blockers: [tenant] }) };
  return { readOptions: { engagementId } };
}
