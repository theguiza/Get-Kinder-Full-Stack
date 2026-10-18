import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import {
  validateActorCanPerformOperation,
  validateActorIsBoundOrganizationAdministrator,
} from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresSourcePromotionRepository } from "../dictionary/postgresSourcePromotionRepository.js";

const SOURCE_PROMOTION_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const SOURCE_PROMOTION_OPERATION = "create_source_promotion_decision";

/**
 * Diagnostic-only exact_verification_phase token for the one validation_blocker
 * branch this service returns directly (before ever calling the repository).
 * Rides the same non-sensitive data-propagation convention the repository uses;
 * changes no error.code, blockers, or HTTP status.
 */
const SOURCE_PROMOTION_SERVICE_INPUT_SHAPE_PHASE = "source_promotion_service_input_shape";

/**
 * P1-08 CORRECTION: the decision outcome vocabulary the service accepts as
 * `outcome`. reviewedSourceType is required only for 'promoted' and must be
 * entirely absent otherwise (see isReviewedSourceTypeShapeValidForOutcome
 * below) - it is never silently accepted-and-ignored on a non-promotion outcome.
 */
const ALLOWED_DECISION_OUTCOMES = new Set(["needs_more_information", "rejected", "promoted"]);

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

function isReviewedSourceTypeShapeValidForOutcome(outcome, reviewedSourceType) {
  if (outcome === "promoted") return isNonEmptyString(reviewedSourceType);
  return reviewedSourceType === undefined;
}

function isCreateSourcePromotionDecisionInput(value) {
  const allowedKeys = new Set(["organizationId", "intakeSourceCandidateId", "outcome", "reviewedSourceType", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!ALLOWED_DECISION_OUTCOMES.has(value.outcome)) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.intakeSourceCandidateId) &&
    isReviewedSourceTypeShapeValidForOutcome(value.outcome, value.reviewedSourceType) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

/**
 * AUTH-KAI-003 (reapplied from P1-06/P1-07): a P1-08 promotion decision may only
 * be created by a mapped human actor. Every non-human actor type (ai, system,
 * import, code, or any other generic-service actor) is rejected outright - there
 * is no bypass. A resolved review item is never itself promotion authority: this
 * gate, plus the shared tenant-membership/role check below, is what establishes
 * that an eligible decision was made by an authorized mapped human with active
 * tenant membership, before the repository's own fail-closed validators run.
 */
function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * The P1-08 decision authority, read-only: mapped human, then the shared
 * tenant-membership/role check, then tenant consistency. It is the exact
 * predicate createSourcePromotionDecision enforces, exported so a read surface
 * can report whether this actor may decide without reconstructing the role
 * policy. A refusal keeps the validator's own error code and blockers (a role
 * refusal is authorization_denied/role_not_allowed, never a tenant violation).
 *
 * Owner decision (2026-10-18), a scoped departure from Backend Contract
 * section 22's GK source-candidate ownership: when the GK check fails, an
 * active, binding-derived client_admin of this exact organization with an
 * active KAI account may decide (`organizationAdminAuthorized`). The GK role
 * set and its organization-membership mode are unchanged, so a global GK role
 * over a client membership still does not satisfy the GK half, and a stored
 * client_admin, client_reviewer, or client_contributor satisfies neither.
 * Every repository validator (candidate/review completeness, lineage,
 * VAL-KAI-P1-08-002 permission predicate, reviewed-source-type vocabulary),
 * the transaction, the audit, and replay are identical for both halves.
 */
export function authorizeSourcePromotionDecision(actorContext, organizationId) {
  if (!isMappedHumanActor(actorContext)) {
    return { ok: false, error: buildKaiError("authorization_denied") };
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    SOURCE_PROMOTION_OPERATION,
    organizationId,
    { allowedRoles: SOURCE_PROMOTION_ALLOWED_ROLES },
  );
  let organizationAdminAuthorized = false;
  if (!auth.ok) {
    const adminAuth = validateActorIsBoundOrganizationAdministrator(actorContext, SOURCE_PROMOTION_OPERATION, organizationId);
    if (!adminAuth.ok || actorContext.kaiUserStatus !== "active") {
      return { ok: false, error: buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers }) };
    }
    organizationAdminAuthorized = true;
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") {
    return { ok: false, error: buildKaiError("tenant_boundary_violation", { blockers: [tenant] }) };
  }

  return { ok: true, organizationAdminAuthorized };
}

/**
 * KAI P1-08 dormant source-promotion seam.
 *
 * Human-authorized creation of exactly one `kai.intake_promotion_decisions` row
 * for a complete, immutable P1-07 candidate/review pair, compounded atomically
 * with deterministic `kai.sources`/`kai.source_versions` creation-or-authoritative-
 * replay and the candidate's/review item's required transitions. Requires
 * `KAI_SPRINT2_ENABLED` before any repository read, lock, validator side effect,
 * or audit activity - if disabled, this returns the canonical `feature_disabled`
 * result with zero repository calls.
 *
 * Contains no SQL and imports no database pool: persistence, lineage re-reads, and
 * every fail-closed validator are delegated entirely to the injected P1-08
 * repository. Authorization and tenant-membership checks are delegated to the
 * existing shared validator-group mechanisms (`validateActorCanPerformOperation`,
 * `validateTenantBoundaryConsistency`) rather than reimplemented locally; their
 * structured blockers are preserved on the returned error.
 */
export async function createSourcePromotionDecision(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCreateSourcePromotionDecisionInput(input)) {
    return buildKaiError("validation_blocker", {
      data: { exact_verification_phase: SOURCE_PROMOTION_SERVICE_INPUT_SHAPE_PHASE },
    });
  }

  const { actorContext } = input;
  const authorization = authorizeSourcePromotionDecision(actorContext, input.organizationId);
  if (!authorization.ok) return authorization.error;

  const sourcePromotionRepository = dependencies.sourcePromotionRepository || createPostgresSourcePromotionRepository();

  const result = await sourcePromotionRepository.createSourcePromotionDecision({
    identity: {
      organizationId: input.organizationId,
      intakeSourceCandidateId: input.intakeSourceCandidateId,
    },
    outcome: input.outcome,
    ...(input.outcome === "promoted" ? { reviewedSourceType: input.reviewedSourceType } : {}),
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, {
      status: result.error.status,
      ...(result.data ? { data: result.data } : {}),
    });
  }
  return { ok: true, data: result.data, error: null };
}

export const __sourcePromotionServiceContract = Object.freeze({
  SOURCE_PROMOTION_OPERATION,
  SOURCE_PROMOTION_ALLOWED_ROLES,
  ALLOWED_DECISION_OUTCOMES: Object.freeze([...ALLOWED_DECISION_OUTCOMES]),
  SOURCE_PROMOTION_SERVICE_INPUT_SHAPE_PHASE,
});
