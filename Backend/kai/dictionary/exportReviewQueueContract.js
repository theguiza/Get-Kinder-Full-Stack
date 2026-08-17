export const EXPORT_REVIEW_QUEUE_STATIC_CONTRACT = Object.freeze({
  queueType: "export_review",
  targetObjectType: "generated_content_draft",
  priority: "medium",
  summary: "Generated draft requires export review.",
  requiredAction:
    "Review audience authority, current eligibility, citations, and the final export gate before any export.",
  assignedTo: null,
  dueAt: null,
  createdByType: "system",
});

export const EXPORT_REVIEW_LIFECYCLE_PROFILES = Object.freeze([
  Object.freeze({ queueStatus: "open", reviewStatus: "needs_gk_review" }),
  Object.freeze({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" }),
  Object.freeze({ queueStatus: "resolved", reviewStatus: "resolved" }),
]);

const EXPORT_REVIEW_QUEUE_ROW_KEYS = new Set([
  "review_queue_item_id",
  "organization_id",
  "queue_type",
  "target_object_type",
  "target_object_id",
  "priority",
  "queue_status",
  "review_status",
  "blocked_reason",
  "assigned_to",
  "due_at",
  "summary",
  "required_action",
  "queue_metadata",
  "created_by",
  "created_by_type",
  "updated_at",
]);

function hasOnlyAllowedKeys(value, allowedKeys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowedKeys.has(key));
}

export function isExportReviewQueueStaticContractRow(row, { organizationId, targetObjectId } = {}) {
  if (!hasOnlyAllowedKeys(row, EXPORT_REVIEW_QUEUE_ROW_KEYS)) return false;
  const contract = EXPORT_REVIEW_QUEUE_STATIC_CONTRACT;
  if (organizationId !== undefined && row.organization_id !== organizationId) return false;
  if (targetObjectId !== undefined && row.target_object_id !== targetObjectId) return false;
  return row.queue_type === contract.queueType
    && row.target_object_type === contract.targetObjectType
    && row.priority === contract.priority
    && row.blocked_reason === null
    && row.assigned_to === contract.assignedTo
    && row.due_at === contract.dueAt
    && row.summary === contract.summary
    && row.required_action === contract.requiredAction
    && row.created_by === null
    && row.created_by_type === contract.createdByType
    && Boolean(row.queue_metadata)
    && typeof row.queue_metadata === "object"
    && !Array.isArray(row.queue_metadata)
    && Object.keys(row.queue_metadata).length === 0;
}

export function isExportReviewQueueLifecycleState(row, allowedLifecycleProfiles = [EXPORT_REVIEW_LIFECYCLE_PROFILES[0]]) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  return allowedLifecycleProfiles.some(
    (profile) => row.queue_status === profile.queueStatus && row.review_status === profile.reviewStatus,
  );
}

export function isExportReviewQueueContractRow(row, {
  organizationId,
  targetObjectId,
  allowedLifecycleProfiles = [EXPORT_REVIEW_LIFECYCLE_PROFILES[0]],
} = {}) {
  return isExportReviewQueueStaticContractRow(row, { organizationId, targetObjectId })
    && isExportReviewQueueLifecycleState(row, allowedLifecycleProfiles);
}
