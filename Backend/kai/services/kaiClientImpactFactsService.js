import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_OPERATION_ROLES, KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

/**
 * Client-safe reviewed Impact Facts. The Impact Library list and Knowledge
 * Studio's Evidence/Claims views read the GK-internal claim-library and
 * evidence-library indexes, which enumerate every claim and evidence item
 * (unreviewed, in GK review, verbatim evidence text, review status, source
 * lineage). Those reads stay GK-only. This read returns only what an
 * ordinary same-organization client member may see:
 *
 * - only claims the existing P2-08 governed evaluator marks eligible for the
 *   internal audience (the same evaluator and verdict behind eligible-claims
 *   and the Impact Home count), so audience gates, sensitivity/allowed-use,
 *   review completeness, and open client follow-ups/conflicts all still
 *   decide what appears;
 * - per fact: its claim id, governed claim statement, claim type, and the
 *   coverage dimensions accepted as limitations for internal use. Never the
 *   evidence item's own statement, source/locator/version ids, review-queue
 *   state, reviewer decisions, validator keys, or any ineligible claim.
 *
 * Paging is internal and bounded; no cursor leaves this service, because the
 * P2-08 scan cursor can name an ineligible claim.
 *
 * Admission reuses the existing read_intake role set; no role, membership,
 * or review authority is granted here.
 */
const CLIENT_IMPACT_FACTS_OPERATION = "list_client_impact_facts";
const CLIENT_IMPACT_FACTS_ALLOWED_ROLES = new Set(KAI_SPRINT2_P0_OPERATION_ROLES.read_intake);
const CLIENT_IMPACT_FACT_AUDIENCE = "internal";
const CLIENT_IMPACT_FACT_PAGE_LIMIT = 100;
const CLIENT_IMPACT_FACT_MAX_ITEMS = 100;
const CLIENT_IMPACT_FACT_MAX_PAGES = 10;
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && typeof actorContext?.actorUserId === "string" && actorContext.actorUserId.length > 0;
}

function isClientImpactFactsInput(value) {
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

function acceptedLimitationDimensionKeys(dimensions) {
  if (!isPlainObject(dimensions)) return [];
  return Object.keys(dimensions)
    .filter((dimensionKey) => (
      dimensions[dimensionKey]?.assessment_status === "unresolved"
      && dimensions[dimensionKey]?.internal_limitation_accepted === true
    ))
    .sort();
}

// Projection handed to the P2-08 repository: it runs only for evaluations
// already marked eligible, and copies only client-safe claim fields.
function toClientImpactFact(evaluation) {
  return {
    claimId: evaluation?.claim?.claim_id,
    statement: typeof evaluation?.claim?.statement === "string" ? evaluation.claim.statement : null,
    claimType: typeof evaluation?.claim?.claim_type === "string" ? evaluation.claim.claim_type : null,
    limitationDimensionKeys: acceptedLimitationDimensionKeys(evaluation?.dimensions),
  };
}

function isClientImpactFact(item) {
  return (
    isPlainObject(item)
    && typeof item.claimId === "string"
    && UUID_RE.test(item.claimId)
    && (item.statement === null || typeof item.statement === "string")
    && (item.claimType === null || typeof item.claimType === "string")
    && Array.isArray(item.limitationDimensionKeys)
  );
}

// The P2-08 repository with the client-safe projection. `runInTransaction`
// and `claimTraceabilityEvaluator` are test seams only; omitted, the real
// transaction and P2-06 evaluator are used.
async function createClientImpactFactsRepository(dependencies) {
  const { createPostgresEligibleClaimsForAudienceRepository } = await import(
    "../dictionary/postgresEligibleClaimsForAudienceRepository.js"
  );
  return createPostgresEligibleClaimsForAudienceRepository({
    runInTransaction: dependencies.runInTransaction,
    evaluator: dependencies.claimTraceabilityEvaluator,
    projectEligibleClaim: toClientImpactFact,
  });
}

async function readClientImpactFacts(organizationId, dependencies) {
  const repository = await createClientImpactFactsRepository(dependencies);
  const facts = [];
  let afterClaimId = null;
  for (let page = 0; page < CLIENT_IMPACT_FACT_MAX_PAGES; page += 1) {
    const result = await repository.listEligibleClaimsForAudience({
      organizationId,
      requestedAudience: CLIENT_IMPACT_FACT_AUDIENCE,
      limit: CLIENT_IMPACT_FACT_PAGE_LIMIT,
      afterClaimId,
    });
    if (!result?.ok) return { ok: false, error: result?.error };
    const items = Array.isArray(result.data?.eligibleClaims) ? result.data.eligibleClaims : null;
    if (!items || !items.every(isClientImpactFact)) return { ok: false, error: { code: "system_error" } };
    for (const item of items) {
      if (facts.length === CLIENT_IMPACT_FACT_MAX_ITEMS) return { ok: true, facts, truncated: true };
      facts.push({
        claimId: item.claimId,
        statement: item.statement,
        claimType: item.claimType,
        limitationDimensionKeys: [...item.limitationDimensionKeys],
      });
    }
    if (result.data.truncated !== true) return { ok: true, facts, truncated: false };
    afterClaimId = result.data.nextAfterClaimId;
    if (typeof afterClaimId !== "string") return { ok: false, error: { code: "system_error" } };
  }
  return { ok: true, facts, truncated: true };
}

export async function listClientImpactFacts(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isClientImpactFactsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext, organizationId } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    CLIENT_IMPACT_FACTS_OPERATION,
    organizationId,
    { allowedRoles: CLIENT_IMPACT_FACTS_ALLOWED_ROLES },
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

  const read = await readClientImpactFacts(organizationId, dependencies);
  if (!read.ok) {
    return buildKaiError(read.error?.code || "system_error");
  }

  return {
    ok: true,
    data: {
      items: read.facts,
      truncated: read.truncated,
    },
    error: null,
  };
}

export const __clientImpactFactsServiceContract = Object.freeze({
  CLIENT_IMPACT_FACTS_OPERATION,
  CLIENT_IMPACT_FACTS_ALLOWED_ROLES,
  CLIENT_IMPACT_FACT_AUDIENCE,
  CLIENT_IMPACT_FACT_MAX_ITEMS,
});

export const __testables = Object.freeze({
  toClientImpactFact,
});
