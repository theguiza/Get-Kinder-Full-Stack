import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorIsOrganizationAdministrator } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { canRecordEvidenceReviewDecision } from "./kaiHumanReviewService.js";

/**
 * The finding-review view of one claim: the organization administrator's
 * factual review (owner authorization 2026-10-24), an active client_admin of
 * this exact organization (validateActorIsOrganizationAdministrator), and the
 * same view for a Get Kinder reviewer who may record this organization's
 * evidence review decision (canRecordEvidenceReviewDecision: gk_reviewer or
 * gk_admin with active membership), checked first as the decisions do.
 * Read-only; it grants nothing. `viewer` says which of the two read it. Every
 * decision is recorded through the existing evidence-review, claim-review,
 * and coverage-acceptance routes, each of which re-checks its own
 * authorization and admission.
 */
const ORGANIZATION_FACTUAL_REVIEW_READ_OPERATION = "read_organization_factual_review";
const FINDING_REVIEW_VIEWERS = Object.freeze({
  getKinderReviewer: "get_kinder_reviewer",
  organizationAdministrator: "organization_administrator",
});

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
  const getKinderReviewer = canRecordEvidenceReviewDecision({ actorContext: input.actorContext, organizationId: input.organizationId });
  if (!getKinderReviewer) {
    const auth = validateActorIsOrganizationAdministrator(
      input.actorContext,
      ORGANIZATION_FACTUAL_REVIEW_READ_OPERATION,
      input.organizationId,
    );
    if (!auth.ok) return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }
  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });

  const repository = dependencies.organizationFactualReviewRepository || (await createDefaultRepository());
  const result = await repository.getOrganizationFactualReview({ organizationId: input.organizationId, claimId: input.claimId });
  if (!result.ok) return buildKaiError(result.error.code, { status: result.error.status });
  return {
    ok: true,
    data: { ...result.data, viewer: getKinderReviewer ? FINDING_REVIEW_VIEWERS.getKinderReviewer : FINDING_REVIEW_VIEWERS.organizationAdministrator },
    error: null,
  };
}

export const __organizationFactualReviewServiceContract = Object.freeze({
  ORGANIZATION_FACTUAL_REVIEW_READ_OPERATION,
  FINDING_REVIEW_VIEWERS,
});
