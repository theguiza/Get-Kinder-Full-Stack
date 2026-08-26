import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { listAuthorizedOrganizations } from "./kaiOrganizationContextService.js";
import { listAuthorizedEngagements } from "./kaiEngagementContextService.js";

/**
 * Composes the trusted, server-side KAI request context - actor, authorized
 * organization, authorized engagement - that the KAI assistant runtime
 * resolves once, before model/tool execution, and hands down instead of
 * letting the model or a tool pick its own tenant scope.
 *
 * This is pure orchestration over the existing Sprint 2 actor resolver
 * (kaiActorContext.js#resolveKaiActorContext) and the existing organization/
 * engagement authorization services (kaiOrganizationContextService.js,
 * kaiEngagementContextService.js). It never queries the database directly,
 * never re-implements membership/role checks, and never accepts a requested
 * organization or engagement id as authoritative on its own: a requested id
 * is only ever accepted after it is found in the actor's own authorized-list
 * result from those existing services, which is where tenant/role
 * authorization already lives.
 */

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export async function resolveKaiRequestContext(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const resolveActor = dependencies.resolveKaiActorContext || resolveKaiActorContext;
  const listOrganizations = dependencies.listAuthorizedOrganizations || listAuthorizedOrganizations;
  const listEngagements = dependencies.listAuthorizedEngagements || listAuthorizedEngagements;

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveActor(input.req, dependencies);
  if (!actorResult.ok) {
    return buildKaiError(actorResult.error_code || "unauthorized");
  }
  const { actorContext } = actorResult;

  let organizationContext = null;
  const requestedOrganizationId = input.requestedOrganizationId;
  if (requestedOrganizationId !== undefined && requestedOrganizationId !== null) {
    if (!isNonEmptyString(requestedOrganizationId)) {
      return buildKaiError("validation_blocker");
    }

    const organizations = await listOrganizations({ actorContext }, dependencies);
    if (!organizations.ok) return organizations;

    const isAuthorized = (organizations.data?.items || []).some(
      (item) => item.organization_id === requestedOrganizationId,
    );
    if (!isAuthorized) {
      return buildKaiError("authorization_denied");
    }
    organizationContext = { organizationId: requestedOrganizationId };
  }

  let engagementContext = null;
  const requestedEngagementId = input.requestedEngagementId;
  if (requestedEngagementId !== undefined && requestedEngagementId !== null) {
    if (!isNonEmptyString(requestedEngagementId)) {
      return buildKaiError("validation_blocker");
    }
    if (!organizationContext) {
      return buildKaiError("validation_blocker", {
        message: "An authorized organization is required to resolve an engagement.",
      });
    }

    const engagements = await listEngagements(
      { organizationId: organizationContext.organizationId, actorContext },
      dependencies,
    );
    if (!engagements.ok) return engagements;

    const match = (engagements.data?.items || []).find(
      (item) => item.engagement_id === requestedEngagementId,
    );
    const belongsToAuthorizedOrganization =
      Boolean(match) && match.organization_id === organizationContext.organizationId;
    if (!belongsToAuthorizedOrganization) {
      return buildKaiError("authorization_denied");
    }
    engagementContext = {
      engagementId: requestedEngagementId,
      organizationId: organizationContext.organizationId,
    };
  }

  return {
    ok: true,
    data: { actorContext, organizationContext, engagementContext },
    error: null,
  };
}

export const __kaiContextServiceTestables = Object.freeze({
  isNonEmptyString,
});
