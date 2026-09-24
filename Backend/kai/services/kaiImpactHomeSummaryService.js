import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  CLIENT_FOLLOWUP_QUEUE_STATUS,
  CLIENT_FOLLOWUP_REVIEW_STATUS,
} from "../validators/kaiClaimGapFollowupValidators.js";
import { __claimTraceabilityServiceContract } from "./kaiClaimTraceabilityService.js";
import {
  __clientFollowupReadServiceContract,
  listClientFollowupWorkflows,
} from "./kaiClientFollowupReadService.js";

/**
 * Client-safe Impact Home summary. Impact Home previously read the
 * GK-review-internal claim-library index and organization Review Queue
 * directly, so a client organization member got 403 (and those reads would
 * disclose unreviewed claims, verbatim internal-only evidence, lineage, and
 * GK review workflow if they were widened). This read returns only the
 * aggregates Home needs:
 *
 * - reviewedImpactFactCount: the number of this organization's claims the
 *   existing P2-08 governed evaluator marks eligible for the internal
 *   audience (the same evaluator and `eligible` verdict behind
 *   eligible-claims). Only the integer leaves this service - never a claim,
 *   evidence, source, or review-queue field, and never a count of claims
 *   that are not eligible.
 * - clientActions: completable client follow-ups, only for an actor the
 *   existing P2-11 client-followup read policy admits (client_reviewer),
 *   through that same service and its client-safe DTO. client_admin and
 *   client_contributor are not client reviewers and get none.
 * - internalReviewAvailable: whether the actor passes the existing
 *   organization Review Queue policy, so Home calls that GK-internal read
 *   only for actors it already authorizes.
 * - isFirstTime: derived only from the client-visible values above.
 *
 * Admission reuses the existing read_intake role set; no role, membership,
 * or review authority is granted here.
 */
const IMPACT_HOME_SUMMARY_OPERATION = "read_impact_home_summary";
const IMPACT_HOME_SUMMARY_ALLOWED_ROLES = new Set(KAI_SPRINT2_P0_OPERATION_ROLES.read_intake);
const IMPACT_FACT_AUDIENCE = "internal";
const IMPACT_FACT_PAGE_LIMIT = 100;
const IMPACT_FACT_MAX_PAGES = 10;
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

const { REVIEW_QUEUE_ALLOWED_ROLES, REVIEW_QUEUE_OPERATION } = __claimTraceabilityServiceContract;
const { LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES, LIST_CLIENT_FOLLOWUP_WORKFLOWS_OPERATION } =
  __clientFollowupReadServiceContract;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && typeof actorContext?.actorUserId === "string" && actorContext.actorUserId.length > 0;
}

function isImpactHomeSummaryInput(value) {
  const allowedKeys = new Set(["organizationId", "actorContext"]);
  return (
    isPlainObject(value)
    && Object.keys(value).every((key) => allowedKeys.has(key))
    && typeof value.organizationId === "string"
    && value.organizationId === value.organizationId.toLowerCase()
    && UUID_RE.test(value.organizationId)
    && isPlainObject(value.actorContext)
  );
}

// A follow-up still awaiting the client: the state claim-gap generation
// creates and P2-11 completion accepts (the same rule as the client
// follow-up review UI's canCompleteClientFollowup).
function isClientActionableFollowup(item) {
  return item?.queue_status === CLIENT_FOLLOWUP_QUEUE_STATUS && item?.review_status === CLIENT_FOLLOWUP_REVIEW_STATUS;
}

async function createDefaultEligibleClaimsForAudienceRepository() {
  const { createPostgresEligibleClaimsForAudienceRepository } = await import(
    "../dictionary/postgresEligibleClaimsForAudienceRepository.js"
  );
  return createPostgresEligibleClaimsForAudienceRepository();
}

async function countEligibleImpactFacts(organizationId, dependencies) {
  const repository =
    dependencies.eligibleClaimsForAudienceRepository || (await createDefaultEligibleClaimsForAudienceRepository());
  let count = 0;
  let afterClaimId = null;
  for (let page = 0; page < IMPACT_FACT_MAX_PAGES; page += 1) {
    const result = await repository.listEligibleClaimsForAudience({
      organizationId,
      requestedAudience: IMPACT_FACT_AUDIENCE,
      limit: IMPACT_FACT_PAGE_LIMIT,
      afterClaimId,
    });
    if (!result?.ok) return { ok: false, error: result?.error };
    const eligibleClaims = Array.isArray(result.data?.eligibleClaims) ? result.data.eligibleClaims : null;
    if (!eligibleClaims) return { ok: false, error: { code: "system_error" } };
    count += eligibleClaims.length;
    if (result.data.truncated !== true) return { ok: true, count, isLowerBound: false };
    afterClaimId = result.data.nextAfterClaimId;
    if (typeof afterClaimId !== "string") return { ok: false, error: { code: "system_error" } };
  }
  return { ok: true, count, isLowerBound: true };
}

export async function getImpactHomeSummary(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isImpactHomeSummaryInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext, organizationId } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    IMPACT_HOME_SUMMARY_OPERATION,
    organizationId,
    { allowedRoles: IMPACT_HOME_SUMMARY_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const impactFacts = await countEligibleImpactFacts(organizationId, dependencies);
  if (!impactFacts.ok) {
    return buildKaiError(impactFacts.error?.code || "system_error");
  }

  const internalReviewAvailable = validateActorCanPerformOperation(
    actorContext,
    REVIEW_QUEUE_OPERATION,
    organizationId,
    { allowedRoles: REVIEW_QUEUE_ALLOWED_ROLES },
  ).ok;

  const isClientReviewer = validateActorCanPerformOperation(
    actorContext,
    LIST_CLIENT_FOLLOWUP_WORKFLOWS_OPERATION,
    organizationId,
    { allowedRoles: LIST_CLIENT_FOLLOWUP_WORKFLOWS_ALLOWED_ROLES },
  ).ok;

  let clientActions = [];
  if (isClientReviewer) {
    const listFollowups = dependencies.listClientFollowupWorkflows || listClientFollowupWorkflows;
    const followups = await listFollowups({ organizationId, actorContext }, dependencies);
    if (!followups.ok) return followups;
    clientActions = (Array.isArray(followups.data?.items) ? followups.data.items : [])
      .filter(isClientActionableFollowup)
      .filter((item) => typeof item.client_followup_item_id === "string" && typeof item.question_text === "string")
      .map((item) => ({ clientFollowupItemId: item.client_followup_item_id, questionText: item.question_text }));
  }

  return {
    ok: true,
    data: {
      reviewedImpactFactCount: impactFacts.count,
      reviewedImpactFactCountIsLowerBound: impactFacts.isLowerBound,
      clientActionCount: clientActions.length,
      clientActions,
      internalReviewAvailable,
      isFirstTime: impactFacts.count === 0 && clientActions.length === 0,
    },
    error: null,
  };
}

export const __impactHomeSummaryServiceContract = Object.freeze({
  IMPACT_HOME_SUMMARY_OPERATION,
  IMPACT_HOME_SUMMARY_ALLOWED_ROLES,
  IMPACT_FACT_AUDIENCE,
  IMPACT_FACT_PAGE_LIMIT,
  IMPACT_FACT_MAX_PAGES,
});
