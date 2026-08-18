export const GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT = Object.freeze({
  queueType: "generated_content_review",
  targetObjectType: "generated_content_draft",
  priority: "medium",
  summary: "Generated draft requires human review.",
  requiredAction:
    "Review citations, audience eligibility, limitations, unsupported claims, and numeric or causal assertions before any use.",
  assignedTo: null,
  dueAt: null,
  createdByType: "system",
});

export const GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES = Object.freeze([
  Object.freeze({ queueStatus: "open", reviewStatus: "needs_gk_review" }),
  Object.freeze({ queueStatus: "in_progress", reviewStatus: "needs_gk_review" }),
  Object.freeze({ queueStatus: "resolved", reviewStatus: "resolved" }),
]);

export const GENERATED_CONTENT_REVIEW_QUEUE_CONTRACT = Object.freeze({
  ...GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT,
  queueStatus: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[0].queueStatus,
  reviewStatus: GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[0].reviewStatus,
});

export function isGeneratedContentReviewStaticContractRow(row, {
  organizationId,
  targetObjectId,
  requireCreatedByType = false,
} = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const contract = GENERATED_CONTENT_REVIEW_QUEUE_STATIC_CONTRACT;
  if (organizationId !== undefined && row.organization_id !== organizationId) return false;
  if (targetObjectId !== undefined && row.target_object_id !== targetObjectId) return false;
  if (row.queue_type !== contract.queueType) return false;
  if (row.target_object_type !== contract.targetObjectType) return false;
  if (row.priority !== contract.priority) return false;
  if (row.summary !== contract.summary) return false;
  if (row.required_action !== contract.requiredAction) return false;
  if (row.assigned_to !== contract.assignedTo) return false;
  if (row.due_at !== contract.dueAt) return false;
  return !requireCreatedByType || row.created_by_type === contract.createdByType;
}

export function isGeneratedContentReviewLifecycleState(row, allowedLifecycleProfiles = [GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[0]]) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  return allowedLifecycleProfiles.some(
    (profile) => row.queue_status === profile.queueStatus && row.review_status === profile.reviewStatus,
  );
}

export function isGeneratedContentReviewQueueRow(row, {
  organizationId,
  targetObjectId,
  requireCreatedByType = false,
  allowedLifecycleProfiles = [GENERATED_CONTENT_REVIEW_LIFECYCLE_PROFILES[0]],
} = {}) {
  return isGeneratedContentReviewStaticContractRow(row, { organizationId, targetObjectId, requireCreatedByType })
    && isGeneratedContentReviewLifecycleState(row, allowedLifecycleProfiles);
}
