import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { buildDerivedImpactAnalysis } from "./kaiImpactEvaluationInterpretation.js";

const IMPACT_EVALUATION_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const EVALUATE_IMPACT_OUTCOME_CONTEXT_OPERATION = "evaluate_impact_outcome_context";
const CREATE_IMPACT_EVALUATION_OPERATION = "create_impact_evaluation";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const AUDIENCES = new Set(["internal", "funder", "public"]);

function hasExactKeys(value, allowed) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function isEvaluateImpactOutcomeContextInput(input) {
  if (!hasExactKeys(input, new Set([
    "organizationId",
    "impactOutcomeContextId",
    "frameworkVersionId",
    "requestedAudience",
    "claimIds",
    "actorContext",
  ]))) return false;
  return UUID_PATTERN.test(input.organizationId)
    && UUID_PATTERN.test(input.impactOutcomeContextId)
    && UUID_PATTERN.test(input.frameworkVersionId)
    && AUDIENCES.has(input.requestedAudience)
    && Array.isArray(input.claimIds)
    && input.claimIds.length >= 1
    && input.claimIds.length <= 50
    && input.claimIds.every((claimId) => typeof claimId === "string" && UUID_PATTERN.test(claimId))
    && input.claimIds.length === new Set(input.claimIds).size
    && input.claimIds.every((claimId, index, arr) => index === 0 || arr[index - 1] < claimId)
    && Boolean(input.actorContext)
    && typeof input.actorContext === "object"
    && !Array.isArray(input.actorContext);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human"
    && typeof actorContext?.actorUserId === "string"
    && actorContext.actorUserId.length > 0;
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  let normalized = null;
  try {
    normalized = new Date(value).toISOString();
  } catch {
    return false;
  }
  return normalized === value;
}

function isCreateImpactEvaluationInput(input) {
  if (!isEvaluateImpactOutcomeContextInput({
    organizationId: input?.organizationId,
    impactOutcomeContextId: input?.impactOutcomeContextId,
    frameworkVersionId: input?.frameworkVersionId,
    requestedAudience: input?.requestedAudience,
    claimIds: input?.claimIds,
    actorContext: input?.actorContext,
  })) return false;
  if (!hasExactKeys(input, new Set([
    "organizationId",
    "impactOutcomeContextId",
    "frameworkVersionId",
    "requestedAudience",
    "claimIds",
    "actorContext",
    "now",
  ]))) return false;
  return isCanonicalUtcTimestamp(input.now);
}

async function createDefaultImpactEvaluationRepository() {
  const { createPostgresImpactEvaluationRepository } = await import(
    "../dictionary/postgresImpactEvaluationRepository.js"
  );
  return createPostgresImpactEvaluationRepository();
}

async function createDefaultImpactEvaluationGenerator() {
  const { createProductionImpactEvaluationGenerator } = await import("./kaiImpactEvaluationGenerator.js");
  return createProductionImpactEvaluationGenerator();
}

async function createDefaultImpactEvaluationAudit({ organizationId, impactOutcomeContextId, actorContext, now }) {
  const { createProductionMetadataOnlyAuditForImpactEvaluation } = await import(
    "./kaiMetadataOnlyAuditComposition.js"
  );
  return createProductionMetadataOnlyAuditForImpactEvaluation({
    organizationId,
    impactOutcomeContextId,
    actorContext,
    now,
  });
}

/**
 * A2.1 — Impact Evaluation service foundation.
 *
 * organization + engagement (via the A1.1 outcome context) + a selected
 * A1.2 framework version + its persisted criteria + eligible governed
 * evidence/claims -> one bounded AI evaluation -> validated structured
 * criterion results. This function only gates and delegates: the AI
 * invocation, id-authorization revalidation, and result validation all live
 * in postgresImpactEvaluationRepository.js / kaiImpactEvaluationValidators.js.
 * It does not persist an evaluation snapshot, result, or provenance link
 * (A1.3/A1.4 write paths are out of scope for A2.1) and it never approves
 * anything.
 */
export async function evaluateImpactOutcomeContext(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
  if (!isEvaluateImpactOutcomeContextInput(input)) return buildKaiError("validation_blocker");
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied");

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    EVALUATE_IMPACT_OUTCOME_CONTEXT_OPERATION,
    input.organizationId,
    { allowedRoles: IMPACT_EVALUATION_ALLOWED_ROLES },
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

  const repository =
    dependencies.impactEvaluationRepository || (await createDefaultImpactEvaluationRepository());
  const generator =
    dependencies.impactEvaluationGenerator || (await createDefaultImpactEvaluationGenerator());

  const result = await repository.evaluateImpactOutcomeContext(
    {
      organizationId: input.organizationId,
      impactOutcomeContextId: input.impactOutcomeContextId,
      frameworkVersionId: input.frameworkVersionId,
      requestedAudience: input.requestedAudience,
      claimIds: input.claimIds,
    },
    { generator },
  );
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status });
  return { ok: true, data: result.data, error: null };
}

/**
 * A2.2 — Persist governed Impact Evaluation results.
 *
 * Gates identically to evaluateImpactOutcomeContext (A2.1, unchanged above),
 * then delegates to postgresImpactEvaluationRepository.js#createImpactEvaluationSnapshot,
 * which performs the full validate -> transaction -> write evaluation ->
 * write criterion results -> write A1.4 provenance -> post-write validation
 * -> audit -> commit sequence and persists nothing if any step before the
 * write fails. This function does not itself touch the database; it only
 * gates, delegates, and -- on success -- attaches a purely derived, advisory
 * interpretation/gap/recommendation view over the persisted results (never
 * persisted, never a gap_log_items row, never a review/approval decision).
 */
export async function createImpactEvaluation(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
  if (!isCreateImpactEvaluationInput(input)) return buildKaiError("validation_blocker");
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied");

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    CREATE_IMPACT_EVALUATION_OPERATION,
    input.organizationId,
    { allowedRoles: IMPACT_EVALUATION_ALLOWED_ROLES },
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

  const repository =
    dependencies.impactEvaluationRepository || (await createDefaultImpactEvaluationRepository());
  const generator =
    dependencies.impactEvaluationGenerator || (await createDefaultImpactEvaluationGenerator());
  const metadataOnlyAudit =
    dependencies.metadataOnlyAudit || (await createDefaultImpactEvaluationAudit({
      organizationId: input.organizationId,
      impactOutcomeContextId: input.impactOutcomeContextId,
      actorContext: input.actorContext,
      now: input.now,
    }));

  const result = await repository.createImpactEvaluationSnapshot(
    {
      organizationId: input.organizationId,
      impactOutcomeContextId: input.impactOutcomeContextId,
      frameworkVersionId: input.frameworkVersionId,
      requestedAudience: input.requestedAudience,
      claimIds: input.claimIds,
      createdBy: input.actorContext.actorUserId,
      now: input.now,
    },
    { generator, metadataOnlyAudit },
  );
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status });

  const analysis = buildDerivedImpactAnalysis(result.data.results);
  return {
    ok: true,
    data: {
      ...result.data,
      classification: analysis.classification,
      interpretations: analysis.interpretations,
      gaps: analysis.gaps,
      recommendations: analysis.recommendations,
    },
    error: null,
  };
}

export const __impactEvaluationServiceContract = Object.freeze({
  IMPACT_EVALUATION_ALLOWED_ROLES,
  EVALUATE_IMPACT_OUTCOME_CONTEXT_OPERATION,
  CREATE_IMPACT_EVALUATION_OPERATION,
});
