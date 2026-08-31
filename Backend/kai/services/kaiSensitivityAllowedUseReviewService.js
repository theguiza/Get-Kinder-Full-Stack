import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresSensitivityAllowedUseReviewRepository } from "../dictionary/postgresSensitivityAllowedUseReviewRepository.js";
import {
  SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES,
  SENSITIVITY_DECISION_ALLOWED_ROLES,
  sensitivityReviewedSnapshotRequired,
  validateSensitivityReviewedSnapshot,
} from "../dictionary/sensitivityAllowedUseDecisionContract.js";

/**
 * KAI B1A-2 Phase-5 sensitivity/allowed-use human-review service layer.
 *
 * Contains no SQL and imports no database pool: persistence, locking, the queue
 * compare-and-set, the append-only decision insert, and the required
 * same-transaction audit are all delegated to
 * Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js.
 *
 * Authorization mirrors the existing P1-06 sensitivity_review contract exactly
 * (SENSITIVITY_REVIEW_ALLOWED_ROLES in
 * Backend/kai/services/kaiReviewQueueService.js): a mapped HUMAN actor with an
 * active membership in the target organization holding gk_admin, gk_operator, or
 * gk_reviewer. Every non-human actor type (ai, assistant, system, import, code,
 * or any generic service actor) is rejected outright before any repository call -
 * there is no bypass, and the ledger's own created_by_type/decided_by_role CHECK
 * constraints independently restate the same restriction in SQL.
 *
 * Reviewer identity and organization are never taken from the caller's payload:
 * the organization comes from the route's own tenant scope and the actor identity
 * and role come from the authenticated actor context.
 */
const RECORD_SENSITIVITY_DECISION_ALLOWED_ROLES = new Set(SENSITIVITY_DECISION_ALLOWED_ROLES);
const RECORD_SENSITIVITY_DECISION_OPERATION = "record_sensitivity_allowed_use_decision";

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

/**
 * Derive the decided_by_role recorded on the ledger row: the actor's actual
 * org-scoped membership role if it is one of the allowed roles, else a matching
 * global KAI capability role, else gk_admin as the platform-superuser-bypass
 * fallback. Mirrors kaiHumanReviewService.js's resolveDecidedByRole exactly -
 * validateActorCanPerformOperation itself does not report which specific role
 * matched, so this is resolved independently, after authorization has passed.
 */
function resolveDecidedByRole(actorContext, auth) {
  const membershipMatch = (auth?.memberships || [])
    .find((membership) => RECORD_SENSITIVITY_DECISION_ALLOWED_ROLES.has(membership.role_name));
  if (membershipMatch) return membershipMatch.role_name;
  const globalMatch = (actorContext?.kaiRoles || [])
    .find((role) => RECORD_SENSITIVITY_DECISION_ALLOWED_ROLES.has(role));
  if (globalMatch) return globalMatch;
  return "gk_admin";
}

const RECORD_SENSITIVITY_DECISION_INPUT_KEYS = new Set([
  "organizationId",
  "intakeSensitivityProfileId",
  "reviewQueueItemId",
  "expectedUpdatedAt",
  "decision",
  "reviewedSnapshot",
  "actorContext",
  "now",
]);

function isRecordSensitivityAllowedUseDecisionInput(value) {
  if (!isPlainObject(value) || !Object.keys(value).every((key) => RECORD_SENSITIVITY_DECISION_INPUT_KEYS.has(key))) {
    return false;
  }
  if (
    !isNonEmptyString(value.organizationId)
    || !isNonEmptyString(value.intakeSensitivityProfileId)
    || !isNonEmptyString(value.reviewQueueItemId)
    || !isNormalizedNow(value.expectedUpdatedAt)
    || !Object.hasOwn(value, "actorContext")
    || !isNormalizedNow(value.now)
    || !SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES.includes(value.decision)
  ) {
    return false;
  }
  if (sensitivityReviewedSnapshotRequired(value.decision)) {
    return validateSensitivityReviewedSnapshot(value.reviewedSnapshot).ok;
  }
  return value.reviewedSnapshot === undefined || value.reviewedSnapshot === null;
}

/**
 * KAI B1A-2 Phase-5 sensitivity/allowed-use decision recording.
 *
 * See Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js for
 * the exact persisted-state contract. This service records authority only in the
 * new append-only ledger: it writes nothing to kai.intake_sensitivity_profiles
 * (every P1-05 pinned column stays exactly as the machine wrote it, so the P1-07
 * and P1-08 predicates are untouched), and it creates no claim, evidence,
 * generated-content, export, or release authority of any kind.
 */
export async function recordSensitivityAllowedUseDecision(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isRecordSensitivityAllowedUseDecisionInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isPlainObject(actorContext) || !actorContext?.actorUserId) {
    const auth = validateActorCanPerformOperation(
      actorContext,
      RECORD_SENSITIVITY_DECISION_OPERATION,
      input.organizationId,
      { allowedRoles: RECORD_SENSITIVITY_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
    );
    return buildKaiError(auth.error_code || "unauthorized", { blockers: auth.blockers });
  }
  // AUTH-KAI-003 discipline: only a mapped human actor may decide. No AI,
  // assistant, system, import, or generic service actor can ever reach the
  // repository below.
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    RECORD_SENSITIVITY_DECISION_OPERATION,
    input.organizationId,
    { allowedRoles: RECORD_SENSITIVITY_DECISION_ALLOWED_ROLES, combineGlobalRoles: true },
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

  const decidedByRole = resolveDecidedByRole(actorContext, auth);

  const repository =
    dependencies.sensitivityAllowedUseReviewRepository || createPostgresSensitivityAllowedUseReviewRepository();
  const result = await repository.recordSensitivityAllowedUseDecision({
    organizationId: input.organizationId,
    intakeSensitivityProfileId: input.intakeSensitivityProfileId,
    reviewQueueItemId: input.reviewQueueItemId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    decisionOutcome: input.decision,
    reviewedSnapshot: input.reviewedSnapshot ?? null,
    actorUserId: actorContext.actorUserId,
    actorRole: decidedByRole,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

export const __sensitivityAllowedUseReviewServiceContract = Object.freeze({
  RECORD_SENSITIVITY_DECISION_ALLOWED_ROLES,
  RECORD_SENSITIVITY_DECISION_OPERATION,
});

export const __sensitivityAllowedUseReviewServiceTestables = Object.freeze({
  isRecordSensitivityAllowedUseDecisionInput,
  isMappedHumanActor,
  resolveDecidedByRole,
});
