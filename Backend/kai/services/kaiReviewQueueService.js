import { insertReviewQueueItem } from "../db/kaiIntakeQueries.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError, validationBlocked } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateReviewQueueType } from "../validators/intakeValidators.js";

export async function createReviewQueueItem(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const queueTypeValidation = validateReviewQueueType({ queueType: input.queueType });
  if (queueTypeValidation.severity === "blocker") {
    return validationBlocked([queueTypeValidation]);
  }

  const auth = validateActorCanPerformOperation(
    input.actorContext,
    "create_review_queue_item",
    input.organizationId,
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code, { blockers: auth.blockers });
  }

  const insertQueueItem = dependencies.insertReviewQueueItem || insertReviewQueueItem;
  const row = await insertQueueItem({
    organizationId: input.organizationId,
    engagementId: input.engagementId || null,
    queueType: input.queueType,
    targetObjectType: input.targetObjectType,
    targetObjectId: input.targetObjectId,
    queueStatus: input.queueStatus || "open",
    blockedReason: input.blockedReason || null,
    summary: input.summary,
    requiredAction: input.requiredAction || null,
    queueMetadata: input.queueMetadata || {},
    createdBy: input.actorContext?.actorUserId || null,
    createdByType: input.actorContext?.actorType || "system",
  });

  return { ok: true, reviewQueueItem: row };
}
