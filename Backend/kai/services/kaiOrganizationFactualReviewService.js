import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorIsOrganizationAdministrator } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

/**
 * The organization administrator's factual-review view of one claim (owner
 * authorization 2026-10-24): an active client_admin of this exact
 * organization only (validateActorIsOrganizationAdministrator). Read-only;
 * it grants nothing. The three decisions it offers are recorded through the
 * existing evidence-review, claim-review, and internal coverage-acceptance
 * routes, each of which re-checks its own authorization and admission.
 */
const ORGANIZATION_FACTUAL_REVIEW_READ_OPERATION = "read_organization_factual_review";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

async function createDefaultRepository() {
  const { createPostgresOrganizationFactualReviewRepository } = await import("../dictionary/postgresOrganizationFactualReviewRepository.js");
  return createPostgresOrganizationFactualReviewRepository();
}

export async function getOrganizationFactualReview(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) return buildKaiError("feature_disabled");
  const allowedKeys = new Set(["organizationId", "claimId", "actorContext"]);
  if (
    !isPlainObject(input)
    || !Object.keys(input).every((key) => allowedKeys.has(key))
    || !isNonEmptyString(input.organizationId)
    || !isNonEmptyString(input.claimId)
  ) {
    return buildKaiError("validation_blocker");
  }
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied");
  const auth = validateActorIsOrganizationAdministrator(
    input.actorContext,
    ORGANIZATION_FACTUAL_REVIEW_READ_OPERATION,
    input.organizationId,
  );
  if (!auth.ok) return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });

  const repository = dependencies.organizationFactualReviewRepository || (await createDefaultRepository());
  const result = await repository.getOrganizationFactualReview({ organizationId: input.organizationId, claimId: input.claimId });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status });
  return { ok: true, data: result.data, error: null };
}

export const __organizationFactualReviewServiceContract = Object.freeze({
  ORGANIZATION_FACTUAL_REVIEW_READ_OPERATION,
});
