import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresClientFollowupCompletionRepository } from "../dictionary/postgresClientFollowupCompletionRepository.js";

/**
 * KAI P2-11 client-followup-completion service: the only route allowed to
 * resolve a CURRENT `client_followup` review-queue workflow. Exactly one
 * organization-scoped role - `client_reviewer` (the exact literal already
 * established for org-scoped client read/review access by
 * KAI_SPRINT2_P0_OPERATION_ROLES.read_intake in
 * Backend/kai/config/kaiSprint2P0Contract.js) - may perform this operation.
 * `gk_admin`, `gk_operator`, `gk_reviewer`, `client_admin`,
 * `client_contributor`, `system`, `assistant`, import, and code actors are all
 * denied by construction of `COMPLETE_CLIENT_FOLLOWUP_ALLOWED_ROLES` never
 * including any of them - this is a workflow disposition an authorized client
 * reviewer performs, not a GK internal-review action and not a broadened
 * client-write authority.
 */
const COMPLETE_CLIENT_FOLLOWUP_ALLOWED_ROLES = new Set(["client_reviewer"]);
const COMPLETE_CLIENT_FOLLOWUP_OPERATION = "complete_client_followup";
const COMPLETE_CLIENT_FOLLOWUP_ACTOR_ROLE = "client_reviewer";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isCompleteClientFollowupInput(value) {
  const allowedKeys = new Set(["organizationId", "claimId", "clientFollowupItemId", "expectedUpdatedAt", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.claimId) &&
    isNonEmptyString(value.clientFollowupItemId) &&
    isNormalizedNow(value.expectedUpdatedAt) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

/**
 * KAI P2-11 client-followup completion. See
 * Backend/kai/dictionary/postgresClientFollowupCompletionRepository.js for the
 * exact persisted-state contract this reuses. Never invokes P2-06/P2-08 or any
 * other mutation - completing a client-followup workflow triggers no
 * automatic downstream chaining.
 */
export async function completeClientFollowup(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCompleteClientFollowupInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    COMPLETE_CLIENT_FOLLOWUP_OPERATION,
    input.organizationId,
    { allowedRoles: COMPLETE_CLIENT_FOLLOWUP_ALLOWED_ROLES },
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

  const repository = dependencies.clientFollowupCompletionRepository || createPostgresClientFollowupCompletionRepository();
  const result = await repository.completeClientFollowup({
    organizationId: input.organizationId,
    claimId: input.claimId,
    clientFollowupItemId: input.clientFollowupItemId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    actorUserId: actorContext.actorUserId,
    actorRole: COMPLETE_CLIENT_FOLLOWUP_ACTOR_ROLE,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __clientFollowupCompletionServiceContract = Object.freeze({
  COMPLETE_CLIENT_FOLLOWUP_ALLOWED_ROLES,
  COMPLETE_CLIENT_FOLLOWUP_OPERATION,
  COMPLETE_CLIENT_FOLLOWUP_ACTOR_ROLE,
});

export const __clientFollowupCompletionServiceTestables = Object.freeze({
  isCompleteClientFollowupInput,
  isMappedHumanActor,
});
