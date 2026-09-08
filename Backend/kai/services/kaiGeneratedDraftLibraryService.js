import { isKaiSprint2Enabled, isKaiGenerationEnabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { listGeneratedDraftLibraryIndex as readGeneratedDraftLibraryIndex } from "../db/kaiGeneratedDraftLibraryReadModels.js";
import { __generatedContentServiceContract } from "./kaiGeneratedContentService.js";
import { __exportReviewServiceContract } from "./kaiExportReviewService.js";
import { EXPORT_REVIEW_LIFECYCLE_PROFILES } from "../dictionary/exportReviewQueueContract.js";

const {
  GET_GENERATED_DRAFT_REVIEW_PACKET_OPERATION: GENERATED_DRAFT_LIBRARY_READ_OPERATION,
  GENERATED_CONTENT_REVIEW_ALLOWED_ROLES: GENERATED_DRAFT_LIBRARY_READ_ROLES,
  PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION,
} = __generatedContentServiceContract;
const { EXPORT_REVIEW_ALLOWED_ROLES } = __exportReviewServiceContract;

const GENERATED_DRAFT_LIBRARY_DEFAULT_LIMIT = 25;
const GENERATED_DRAFT_LIBRARY_MAX_LIMIT = 25;
const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const REVIEW_QUEUE_STATUSES = new Set(["open", "in_progress", "resolved", "blocked"]);
const REVIEW_STATUSES = new Set(["needs_gk_review", "resolved"]);
const LIBRARY_CONTENT_TYPES = new Set(["evidence_summary", "impact_narrative"]);

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
  const limit = value ?? GENERATED_DRAFT_LIBRARY_DEFAULT_LIMIT;
  return Number.isInteger(limit) && limit >= 1 && limit <= GENERATED_DRAFT_LIBRARY_MAX_LIMIT ? limit : null;
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

// Same 0-or-1-row shape validateExportReviewQueueRows enforces on the
// single-draft read path: no export_review row is null/null, exactly one
// is a genuine EXPORT_REVIEW_LIFECYCLE_PROFILES member - never a pick among
// several, since the batched LEFT JOIN can return at most one such row per
// draft by the same unique-index invariant.
function isValidExportReviewRowFields(row) {
  if (row.export_review_queue_item_id === null) {
    return row.export_review_queue_status === null && row.export_review_status === null;
  }
  return canonicalUuid(row.export_review_queue_item_id)
    && EXPORT_REVIEW_LIFECYCLE_PROFILES.some(
      (profile) => row.export_review_queue_status === profile.queueStatus && row.export_review_status === profile.reviewStatus,
    );
}

function responseDraftSummary(row, organizationId, exportReviewVisible) {
  if (
    !isPlainObject(row)
    || !canonicalUuid(row.generated_content_draft_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !LIBRARY_CONTENT_TYPES.has(row.content_type)
    || row.requested_audience !== "internal"
    || row.draft_status !== "draft"
    || !canonicalUuid(row.review_queue_item_id)
    || !REVIEW_QUEUE_STATUSES.has(row.queue_status)
    || !REVIEW_STATUSES.has(row.review_status)
    || !isCanonicalUtcTimestamp(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at)
    || !isValidExportReviewRowFields(row)
  ) {
    return null;
  }
  return {
    generatedContentDraftId: row.generated_content_draft_id,
    contentType: row.content_type,
    requestedAudience: row.requested_audience,
    draftStatus: row.draft_status,
    reviewQueueItemId: row.review_queue_item_id,
    queueStatus: row.queue_status,
    reviewStatus: row.review_status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    // Same restricted/existing distinction e890a8c established for the
    // single-draft packet, projected per row here instead: an actor without
    // export-review authority gets exportReviewVisible=false and every
    // export-review field forced null, never conflated with the genuine
    // "no export review requested yet" absence (visible=true, id=null).
    exportReviewVisible,
    exportReviewQueueItemId: exportReviewVisible ? row.export_review_queue_item_id : null,
    exportReviewQueueStatus: exportReviewVisible ? row.export_review_queue_status : null,
    exportReviewStatus: exportReviewVisible ? row.export_review_status : null,
  };
}

export async function listGeneratedDraftLibraryIndex(input = {}, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
  if (!isKaiGenerationEnabled(env)) return buildKaiError("feature_disabled");

  const organizationId = typeof input.organizationId === "string" ? input.organizationId.trim().toLowerCase() : "";
  const limit = normalizeLimit(input.limit);
  const afterGeneratedContentDraftId = input.afterGeneratedContentDraftId ?? null;
  if (
    !canonicalUuid(organizationId)
    || !limit
    || (afterGeneratedContentDraftId !== null && !canonicalUuid(afterGeneratedContentDraftId))
  ) {
    return buildKaiError("validation_blocker");
  }
  if (!isMappedHumanActor(input.actorContext)) return buildKaiError("authorization_denied");

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    GENERATED_DRAFT_LIBRARY_READ_OPERATION,
    organizationId,
    {
      allowedRoles: GENERATED_DRAFT_LIBRARY_READ_ROLES,
      combineGlobalRoles: true,
    },
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

  // Identical export-review authority gate e890a8c enforces on the
  // single-draft packet read (kaiExportReviewService.js's own
  // EXPORT_REVIEW_ALLOWED_ROLES, gk_admin only, no combineGlobalRoles) -
  // evaluated once for the whole page, not per row, since actor authority
  // never varies per draft.
  const exportReviewAuth = validateActorCanPerformOperation(
    input.actorContext,
    PROJECT_EXPORT_REVIEW_VISIBILITY_OPERATION,
    organizationId,
    { allowedRoles: EXPORT_REVIEW_ALLOWED_ROLES },
  );
  const exportReviewVisible = exportReviewAuth.ok;

  const readIndex = dependencies.listGeneratedDraftLibraryIndex || readGeneratedDraftLibraryIndex;
  const rows = await readIndex(organizationId, { limit, afterGeneratedContentDraftId });
  if (!Array.isArray(rows) || rows.length > limit + 1) return buildKaiError("system_error");

  const summaries = [];
  for (const row of rows) {
    const summary = responseDraftSummary(row, organizationId, exportReviewVisible);
    if (!summary) return buildKaiError("system_error");
    summaries.push(summary);
  }
  const items = summaries.slice(0, limit);
  const hasNext = summaries.length > limit;

  return {
    ok: true,
    data: {
      items,
      limit,
      afterGeneratedContentDraftId,
      truncated: hasNext,
      nextAfterGeneratedContentDraftId: hasNext ? items.at(-1).generatedContentDraftId : null,
    },
    warnings: [],
  };
}

export const __generatedDraftLibraryServiceContract = Object.freeze({
  GENERATED_DRAFT_LIBRARY_READ_OPERATION,
  GENERATED_DRAFT_LIBRARY_READ_ROLES,
  GENERATED_DRAFT_LIBRARY_DEFAULT_LIMIT,
  GENERATED_DRAFT_LIBRARY_MAX_LIMIT,
});

export const __testables = Object.freeze({
  responseDraftSummary,
});
