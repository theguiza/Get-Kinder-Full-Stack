import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listEngagementsForOrganization } from "../db/kaiQueries.js";

/**
 * KAI intake-context read: lets the Web Intake UI select an EXISTING
 * tenant-authoritative organization/engagement pair instead of the caller
 * fabricating one. Gated by exactly the same roles as `create_intake_batch`
 * (Backend/kai/config/kaiSprint2P0Contract.js) - the only actors who can ever
 * use an engagement id here are the ones already authorized to create a
 * batch with it. Read-only: never creates an engagement row.
 */
const LIST_ENGAGEMENTS_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator"]);
const LIST_ENGAGEMENTS_OPERATION = "list_engagement_contexts";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isListEngagementsInput(value) {
  const allowedKeys = new Set(["organizationId", "actorContext"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return isNonEmptyString(value.organizationId) && isPlainObject(value.actorContext);
}

export async function listAuthorizedEngagements(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isListEngagementsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    LIST_ENGAGEMENTS_OPERATION,
    input.organizationId,
    { allowedRoles: LIST_ENGAGEMENTS_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const listEngagements = dependencies.listEngagementsForOrganization || listEngagementsForOrganization;
  const rows = await listEngagements({ organizationId: input.organizationId });

  return {
    ok: true,
    data: {
      items: rows.map((row) => ({ engagement_id: row.engagement_id, organization_id: row.organization_id })),
    },
    error: null,
  };
}

export const __engagementContextServiceContract = Object.freeze({
  LIST_ENGAGEMENTS_ALLOWED_ROLES,
  LIST_ENGAGEMENTS_OPERATION,
});

export const __engagementContextServiceTestables = Object.freeze({
  isListEngagementsInput,
  isMappedHumanActor,
});
