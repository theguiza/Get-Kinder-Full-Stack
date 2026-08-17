import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { GK_ORGANIZATION_ADMIN_ROLE } from "../auth/gkOrganizationBindingAuthority.js";
import { resolveOrgScopeForUserId } from "../../../services/orgScopeService.js";
import { listActiveGkOrganizationBindingsForGkOrganizationIds } from "../db/kaiOrganizationBindingQueries.js";
import {
  DEFAULT_INITIAL_ENGAGEMENT_CODE,
  findOrCreateActiveKaiOrganizationBindingForGkOrganization,
  findOrCreateInitialEngagementForOrganization,
  selectGkOrganizationRow,
} from "../db/kaiOrganizationEnablementQueries.js";
import { createProductionMetadataOnlyAuditForOrganizationKaiEnablement } from "./kaiMetadataOnlyAuditComposition.js";

/**
 * Get Kinder organization -> KAI provisioning. Authorizes against the
 * CURRENT Get Kinder organization-admin authorization mechanism
 * (public.user_org_memberships.role === 'admin' for the requested
 * organization, resolved via services/orgScopeService.js#resolveOrgScopeForUserId) -
 * exactly the same role gkOrganizationBindingAuthority.js already treats as
 * authoritative for deriving client_admin, but checked directly here because
 * that derivation itself depends on a binding existing, which is not yet true
 * on a first enablement request.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeGkOrganizationId(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

async function resolveAuthorizedGkOrganizationAdminActor(input, dependencies) {
  if (!isPlainObject(input) || !isPlainObject(input.req)) {
    return { ok: false, error: buildKaiError("validation_blocker") };
  }
  const gkOrganizationId = normalizeGkOrganizationId(input.gkOrganizationId);
  if (!gkOrganizationId) {
    return { ok: false, error: buildKaiError("validation_blocker") };
  }

  const resolveActor = dependencies.resolveKaiActorContext || resolveKaiActorContext;
  const actorResult = await resolveActor(input.req, dependencies);
  if (!actorResult.ok) return { ok: false, error: actorError(actorResult) };
  const { actorContext } = actorResult;

  const resolveScope = dependencies.resolveOrgScopeForUserId || resolveOrgScopeForUserId;
  const scope = await resolveScope(actorContext.legacyPublicUserdataId);
  const isGkOrganizationAdmin = (Array.isArray(scope?.memberships) ? scope.memberships : []).some(
    (membership) =>
      Number(membership?.orgId) === gkOrganizationId &&
      membership?.role === GK_ORGANIZATION_ADMIN_ROLE &&
      membership?.is_active !== false,
  );
  if (!isGkOrganizationAdmin) {
    return { ok: false, error: buildKaiError("authorization_denied") };
  }

  return { ok: true, actorContext, gkOrganizationId };
}

/**
 * Read-only KAI-enablement status for a Get Kinder organization. Never
 * creates or mutates anything - used by the organization-admin UI to decide
 * between "Not enabled" / "Enable KAI" and "Enabled" / "Open KAI".
 */
export async function getKaiEnablementStatusForOrganization(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const authorized = await resolveAuthorizedGkOrganizationAdminActor(input, dependencies);
  if (!authorized.ok) return authorized.error;
  const { gkOrganizationId } = authorized;

  const listBindings =
    dependencies.listActiveGkOrganizationBindingsForGkOrganizationIds ||
    listActiveGkOrganizationBindingsForGkOrganizationIds;
  const bindings = await listBindings([gkOrganizationId]);
  const binding = bindings[0] || null;
  if (!binding) {
    return { ok: true, data: { kai_enabled: false, kai_organization_id: null }, error: null };
  }

  const findEngagement = dependencies.findOrCreateInitialEngagementForOrganization
    || findOrCreateInitialEngagementForOrganization;
  const engagementResult = await findEngagement({
    organizationId: binding.kai_organization_id,
    engagementCode: DEFAULT_INITIAL_ENGAGEMENT_CODE,
  });

  return {
    ok: true,
    data: {
      kai_enabled: true,
      kai_organization_id: binding.kai_organization_id,
      engagement_id: engagementResult.ok ? engagementResult.engagement.engagement_id : null,
      engagement_code: engagementResult.ok ? engagementResult.engagement.engagement_code : null,
    },
    error: null,
  };
}

/**
 * Get Kinder organization -> KAI provisioning write path. Creates or reuses:
 * one active kai.gk_organization_bindings row, and one initial
 * kai.engagements row for the resulting KAI organization. Idempotent and
 * concurrency-safe (see kaiOrganizationEnablementQueries.js for the
 * mechanism); repeated calls for the same Get Kinder organization always
 * converge on the same kai_organization_id/engagement_id.
 */
export async function enableKaiForOrganization(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const authorized = await resolveAuthorizedGkOrganizationAdminActor(input, dependencies);
  if (!authorized.ok) return authorized.error;
  const { actorContext, gkOrganizationId } = authorized;

  const selectOrganization = dependencies.selectGkOrganizationRow || selectGkOrganizationRow;
  const gkOrganization = await selectOrganization(gkOrganizationId);
  if (!gkOrganization) {
    return buildKaiError("not_found");
  }

  const findOrCreateBinding =
    dependencies.findOrCreateActiveKaiOrganizationBindingForGkOrganization ||
    findOrCreateActiveKaiOrganizationBindingForGkOrganization;
  const bindingResult = await findOrCreateBinding({ gkOrganizationId });
  if (!bindingResult.ok) {
    return buildKaiError(bindingResult.error_code === "conflicting_binding" ? "conflict" : "system_error");
  }
  const kaiOrganizationId = bindingResult.binding.kai_organization_id;

  const findOrCreateEngagement =
    dependencies.findOrCreateInitialEngagementForOrganization || findOrCreateInitialEngagementForOrganization;
  const engagementResult = await findOrCreateEngagement({
    organizationId: kaiOrganizationId,
    engagementCode: DEFAULT_INITIAL_ENGAGEMENT_CODE,
    createdByUserId: actorContext.actorUserId,
  });
  if (!engagementResult.ok) {
    return buildKaiError("system_error");
  }

  if (bindingResult.created || engagementResult.created) {
    const buildAudit =
      dependencies.createProductionMetadataOnlyAuditForOrganizationKaiEnablement ||
      createProductionMetadataOnlyAuditForOrganizationKaiEnablement;
    const audit = buildAudit({ kaiOrganizationId, actorContext, now: new Date().toISOString() });
    const prepared = audit.prepareMetadataOnlyAudit({
      payload: {
        attempted_operation: "enable_kai_for_organization",
        engagement_id: engagementResult.engagement.engagement_id,
      },
    });
    if (prepared.ok) {
      await prepared.publish();
    }
  }

  return {
    ok: true,
    data: {
      kai_enabled: true,
      kai_organization_id: kaiOrganizationId,
      engagement_id: engagementResult.engagement.engagement_id,
      engagement_code: engagementResult.engagement.engagement_code,
    },
    error: null,
  };
}

export const __organizationEnablementServiceTestables = Object.freeze({
  resolveAuthorizedGkOrganizationAdminActor,
});
