import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS, KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listClaimLibraryReviewCandidates as readClaimLibraryReviewCandidates } from "../db/kaiClaimLibraryReadModels.js";

const CLAIM_LIBRARY_READ_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const CLAIM_LIBRARY_READ_OPERATION = "read_intake";
const CLAIM_LIBRARY_DEFAULT_LIMIT = 25;
const CLAIM_LIBRARY_MAX_LIMIT = 25;
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const MACHINE_TOKEN_RE = /^[a-z0-9_]{1,64}$/;
const REVIEW_QUEUE_STATUSES = new Set(KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES);
const REVIEW_QUEUE_TYPES = new Set(["claim_review", "evidence_review", "client_followup", "conflict_resolution"]);
const TARGET_OBJECT_TYPES = new Set(["claim", "evidence_item", "client_followup_item", "conflict_group"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalUuid(value) {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && typeof actorContext?.actorUserId === "string" && actorContext.actorUserId.length > 0;
}

function normalizeLimit(value) {
  const limit = value ?? CLAIM_LIBRARY_DEFAULT_LIMIT;
  return Number.isInteger(limit) && limit >= 1 && limit <= CLAIM_LIBRARY_MAX_LIMIT ? limit : null;
}

function responseQueueItem(row) {
  if (
    !isPlainObject(row)
    || !canonicalUuid(row.review_queue_item_id)
    || !REVIEW_QUEUE_TYPES.has(row.queue_type)
    || !TARGET_OBJECT_TYPES.has(row.target_object_type)
    || !canonicalUuid(row.target_object_id)
    || !REVIEW_QUEUE_STATUSES.has(row.queue_status)
  ) {
    return null;
  }
  const reviewStatus = row.review_status ?? null;
  if (reviewStatus !== null && (typeof reviewStatus !== "string" || !MACHINE_TOKEN_RE.test(reviewStatus))) return null;
  return {
    review_queue_item_id: row.review_queue_item_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    queue_status: row.queue_status,
    review_status: reviewStatus,
  };
}

function responseClaimCandidate(row, organizationId) {
  if (
    !isPlainObject(row)
    || !canonicalUuid(row.claim_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.evidence_item_id)
    || typeof row.claim_type !== "string"
    || !MACHINE_TOKEN_RE.test(row.claim_type)
    || typeof row.claim_status !== "string"
    || !MACHINE_TOKEN_RE.test(row.claim_status)
    || typeof row.claim_review_status !== "string"
    || !MACHINE_TOKEN_RE.test(row.claim_review_status)
    || typeof row.claim_strength !== "string"
    || !MACHINE_TOKEN_RE.test(row.claim_strength)
    || !Array.isArray(row.review_queue_items)
  ) {
    return null;
  }
  const reviewQueueItems = row.review_queue_items.map(responseQueueItem);
  if (reviewQueueItems.some((item) => !item)) return null;
  return {
    claimId: row.claim_id,
    evidenceItemId: row.evidence_item_id,
    claimType: row.claim_type,
    claimStatus: row.claim_status,
    claimReviewStatus: row.claim_review_status,
    claimStrength: row.claim_strength,
    reviewQueueItems,
  };
}

export async function listClaimLibraryCandidates(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = typeof input.organizationId === "string" ? input.organizationId.trim().toLowerCase() : "";
  const limit = normalizeLimit(input.limit);
  const afterClaimId = input.afterClaimId ?? null;
  if (!canonicalUuid(organizationId) || !limit || (afterClaimId !== null && !canonicalUuid(afterClaimId))) {
    return buildKaiError("validation_blocker");
  }
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied");

  const genericAuth = validateActorCanPerformOperation(input.actorContext, CLAIM_LIBRARY_READ_OPERATION, organizationId);
  if (!genericAuth.ok) {
    return buildKaiError(genericAuth.error_code || "authorization_denied", { blockers: genericAuth.blockers });
  }
  const roleAuth = validateActorCanPerformOperation(
    input.actorContext,
    CLAIM_LIBRARY_READ_OPERATION,
    organizationId,
    { allowedRoles: CLAIM_LIBRARY_READ_ROLES },
  );
  if (!roleAuth.ok) {
    return buildKaiError(roleAuth.error_code || "authorization_denied", { blockers: roleAuth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const readCandidates = dependencies.listClaimLibraryReviewCandidates || readClaimLibraryReviewCandidates;
  const rows = await readCandidates(organizationId, { limit, afterClaimId });
  if (!Array.isArray(rows) || rows.length > limit + 1) return buildKaiError("system_error");

  const candidates = [];
  for (const row of rows) {
    const candidate = responseClaimCandidate(row, organizationId);
    if (!candidate) return buildKaiError("system_error");
    candidates.push(candidate);
  }
  const items = candidates.slice(0, limit);
  const hasNext = candidates.length > limit;

  return {
    ok: true,
    data: {
      items,
      limit,
      afterClaimId,
      truncated: hasNext,
      nextAfterClaimId: hasNext ? items.at(-1).claimId : null,
    },
    warnings: [],
  };
}

export const __claimLibraryServiceContract = Object.freeze({
  CLAIM_LIBRARY_READ_OPERATION,
  CLAIM_LIBRARY_READ_ROLES,
  CLAIM_LIBRARY_DEFAULT_LIMIT,
  CLAIM_LIBRARY_MAX_LIMIT,
});

export const __testables = Object.freeze({
  responseClaimCandidate,
});
