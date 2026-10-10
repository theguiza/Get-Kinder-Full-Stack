import { buildKaiError } from "../errors/kaiErrors.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresP1DownstreamRecoveryRepository } from "../parsing/postgresP1DownstreamRecoveryRepository.js";

/**
 * Authorized operator read of one intake file's P1 recovery state: the
 * durable P1-04/P1-05 attempt rows (including exhausted and
 * operator-attention outcomes) and its parser runs, as states, counters,
 * timestamps, and safe codes only. Read-only; it never retries, resets, or
 * approves anything, and is not mounted on any route. Same mapped-human GK
 * authorization as the P1-04 data-dictionary entry read.
 */
const RECOVERY_STATUS_READ_OPERATION = "read_intake";
const RECOVERY_STATUS_READ_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export async function getKaiP1RecoveryStatus(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  if (
    !isPlainObject(input)
    || !Object.keys(input).every((key) => ["organizationId", "intakeFileId", "actorContext"].includes(key))
    || !isNonEmptyString(input.organizationId)
    || !isNonEmptyString(input.intakeFileId)
    || !isPlainObject(input.actorContext)
  ) {
    return buildKaiError("validation_blocker");
  }
  if (input.actorContext.actorType !== "human" || !isNonEmptyString(input.actorContext.actorUserId)) {
    return buildKaiError("authorization_denied");
  }

  const genericAuth = validateActorCanPerformOperation(input.actorContext, RECOVERY_STATUS_READ_OPERATION, input.organizationId);
  if (!genericAuth.ok) return buildKaiError(genericAuth.error_code || "authorization_denied", { blockers: genericAuth.blockers });
  const roleAuth = validateActorCanPerformOperation(
    input.actorContext,
    RECOVERY_STATUS_READ_OPERATION,
    input.organizationId,
    { allowedRoles: RECOVERY_STATUS_READ_ROLES },
  );
  if (!roleAuth.ok) return buildKaiError(roleAuth.error_code || "authorization_denied", { blockers: roleAuth.blockers });

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });

  const repository = dependencies.p1DownstreamRecoveryRepository || createPostgresP1DownstreamRecoveryRepository();
  const result = await repository.readP1RecoveryStatus({
    organizationId: input.organizationId,
    intakeFileId: input.intakeFileId,
  });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status });
  return { ok: true, data: result.data, error: null };
}

export const __p1RecoveryStatusServiceContract = Object.freeze({
  RECOVERY_STATUS_READ_OPERATION,
  RECOVERY_STATUS_READ_ROLES,
});
