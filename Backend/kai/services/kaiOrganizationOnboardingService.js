import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { resolveOrgScopeForUserId } from "../../../services/orgScopeService.js";
import { selectLatestOwnOrganizationApplication } from "../db/gkOrganizationApplicationQueries.js";
import { listAuthorizedOrganizations } from "./kaiOrganizationContextService.js";
import { getKaiEnablementStatusForOrganization } from "./kaiOrganizationEnablementService.js";

export const KAI_ORGANIZATION_ONBOARDING_STATUSES = Object.freeze({
  NO_REQUEST: "NO_REQUEST",
  PENDING: "PENDING",
  DECLINED: "DECLINED",
  APPROVED_NOT_KAI_ENABLED: "APPROVED_NOT_KAI_ENABLED",
  KAI_AVAILABLE: "KAI_AVAILABLE",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

function normalizeOrganizationName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * public.org_applications stores no organization id. The admin approval
 * route (routes/orgApplyApi.js) resolves the approved organization by the
 * same whitespace/case-normalized name, lowest public.organizations.id
 * first, and grants the applicant an admin membership in it. This mirrors
 * that rule against the applicant's own active admin memberships only, so
 * it can never resolve an organization the caller does not already hold.
 */
function findApprovedGkOrganizationId(application, memberships) {
  const applicationOrgName = normalizeOrganizationName(application?.org_name);
  if (!applicationOrgName) return null;
  const candidateIds = (Array.isArray(memberships) ? memberships : [])
    .filter(
      (membership) =>
        membership?.role === "admin" &&
        membership?.is_active !== false &&
        normalizeOrganizationName(membership?.org_name) === applicationOrgName,
    )
    .map((membership) => Number(membership?.orgId))
    .filter((orgId) => Number.isInteger(orgId) && orgId > 0)
    .sort((a, b) => a - b);
  return candidateIds[0] || null;
}

function safeApplicationFields(application) {
  if (!application) return null;
  return {
    application_id: application.id,
    org_name: application.org_name || "",
    submitted_at: application.submitted_at || null,
    reviewed_at: application.reviewed_at || null,
  };
}

/**
 * User-scoped Impact Library onboarding status. This is deliberately a read
 * facade over existing authority:
 * - organization availability still comes from listAuthorizedOrganizations
 *   (surfaced only as has_authorized_organizations, never as request state);
 * - request lifecycle comes from the caller's latest own public.org_applications
 *   row via Backend/kai/db/gkOrganizationApplicationQueries.js;
 * - KAI setup availability still comes from the existing enablement service.
 */
export async function getMyOrganizationOnboardingStatus(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isPlainObject(input) || !isPlainObject(input.req)) {
    return buildKaiError("validation_blocker");
  }

  const resolveActor = dependencies.resolveKaiActorContext || resolveKaiActorContext;
  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveActor(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const { actorContext } = actorResult;
  const legacyPublicUserdataId = Number(actorContext?.legacyPublicUserdataId);
  if (actorContext?.actorType !== "human" || !Number.isInteger(legacyPublicUserdataId) || legacyPublicUserdataId <= 0) {
    return buildKaiError("authorization_denied");
  }

  const listOrganizations = dependencies.listAuthorizedOrganizations || listAuthorizedOrganizations;
  const authorizedOrganizations = await listOrganizations({ actorContext }, dependencies);
  if (!authorizedOrganizations.ok) return authorizedOrganizations;
  // Organization availability (what the user can use now) and request state
  // (the latest own application) are reported independently: an unrelated
  // authorized organization never masks another request's lifecycle.
  const authorizedOrganizationIds = new Set(
    (authorizedOrganizations.data?.items || [])
      .map((item) => item?.organization_id)
      .filter((organizationId) => typeof organizationId === "string" && organizationId.length > 0),
  );
  const respond = (status, { application = null, canEnableKai = false, gkOrganizationId = null, kaiOrganizationId = null } = {}) => ({
    ok: true,
    data: {
      status,
      application: safeApplicationFields(application),
      has_authorized_organizations: authorizedOrganizationIds.size > 0,
      can_enable_kai: canEnableKai,
      gk_organization_id: gkOrganizationId,
      kai_organization_id: kaiOrganizationId,
    },
    error: null,
  });

  const selectApplication =
    dependencies.selectLatestOwnOrganizationApplication || selectLatestOwnOrganizationApplication;
  const application = await selectApplication(legacyPublicUserdataId, dependencies.publicDb);
  if (!application) return respond(KAI_ORGANIZATION_ONBOARDING_STATUSES.NO_REQUEST);
  if (application.status === "pending") {
    return respond(KAI_ORGANIZATION_ONBOARDING_STATUSES.PENDING, { application });
  }
  if (application.status === "declined") {
    return respond(KAI_ORGANIZATION_ONBOARDING_STATUSES.DECLINED, { application });
  }
  if (application.status !== "approved") return respond(KAI_ORGANIZATION_ONBOARDING_STATUSES.NO_REQUEST);

  const resolveScope = dependencies.resolveOrgScopeForUserId || resolveOrgScopeForUserId;
  const scope = await resolveScope(legacyPublicUserdataId, { includeOrgMembersForOrgRep: false });
  const gkOrganizationId = findApprovedGkOrganizationId(application, scope?.memberships);
  if (!gkOrganizationId) {
    return respond(KAI_ORGANIZATION_ONBOARDING_STATUSES.APPROVED_NOT_KAI_ENABLED, { application });
  }

  const getEnablementStatus = dependencies.getKaiEnablementStatusForOrganization || getKaiEnablementStatusForOrganization;
  const enablement = await getEnablementStatus({ gkOrganizationId, req: input.req }, dependencies);
  const enablementData = enablement.ok === true ? enablement.data : null;
  // KAI_AVAILABLE only when the existing GK<->KAI binding for THIS approved
  // organization resolves to a KAI organization the caller is authorized
  // for through the existing organization-authority path.
  if (
    enablementData?.kai_enabled === true &&
    typeof enablementData.kai_organization_id === "string" &&
    authorizedOrganizationIds.has(enablementData.kai_organization_id)
  ) {
    return respond(KAI_ORGANIZATION_ONBOARDING_STATUSES.KAI_AVAILABLE, {
      application,
      kaiOrganizationId: enablementData.kai_organization_id,
    });
  }
  const canEnableKai = enablementData?.kai_enabled === false;
  return respond(KAI_ORGANIZATION_ONBOARDING_STATUSES.APPROVED_NOT_KAI_ENABLED, {
    application,
    canEnableKai,
    gkOrganizationId: canEnableKai ? gkOrganizationId : null,
  });
}

export const __organizationOnboardingTestables = Object.freeze({
  findApprovedGkOrganizationId,
  normalizeOrganizationName,
});
