import { randomUUID } from "crypto";

import {
  getScopedIntakeFileReviewQueueItem,
  getScopedReviewQueueLinkedIntakeFile,
  insertReviewQueueItem,
  updateReviewQueueItemStatusIfCurrent,
} from "../db/kaiIntakeQueries.js";
import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import {
  KAI_SPRINT2_P0_PATTERNS,
  KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES,
} from "../config/kaiSprint2P0Contract.js";
import { buildKaiError, validationBlocked } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { withTransaction } from "../db/kaiDb.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import {
  RequiredAuditPersistenceError,
  orchestrateMutationWithRequiredAudit,
} from "../internal/kaiMutationOrchestration.js";
import { validateReviewQueueType } from "../validators/intakeValidators.js";
import { validateReviewQueueStatusRequest } from "../validators/kaiSprint2RequestSchemas.js";

const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const REVIEW_QUEUE_STATUS_SET = new Set(KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES);
const REVIEW_QUEUE_STATUS_VALIDATOR_KEYS = Object.freeze([
  "VAL-AUT-001",
  "VAL-AUT-002",
  "VAL-AUT-003",
  "VAL-AUT-004",
  "VAL-AST-001",
  "VAL-STA-001",
]);
const CANONICAL_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REVIEW_QUEUE_PRIORITY_RE = /^[a-z0-9_]{1,64}$/;
const DISALLOWED_TEXT_CONTROLS_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;
const BIDI_FORMATTING_CONTROLS_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

class KaiReviewQueueMutationError extends Error {
  constructor(code) {
    super(code);
    this.name = "KaiReviewQueueMutationError";
    this.code = code;
  }
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError("unauthorized");
}

function canonicalUuid(value) {
  return typeof value === "string"
    && value === value.toLowerCase()
    && UUID_RE.test(value);
}

function canonicalTimestamp(value, { nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP_RE.test(value)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? undefined : value;
}

function normalizedReviewQueueText(value, maximumCodePoints) {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const normalized = value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (
    normalized.length === 0
    || [...normalized].length > maximumCodePoints
    || DISALLOWED_TEXT_CONTROLS_RE.test(normalized)
    || BIDI_FORMATTING_CONTROLS_RE.test(normalized)
  ) {
    return { ok: false };
  }
  return { ok: true, value: normalized };
}

function responseReviewQueueItem(row, organizationId) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (
    !canonicalUuid(row.review_queue_item_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || row.queue_type !== "intake_file_review"
    || row.target_object_type !== "intake_file"
    || !canonicalUuid(row.target_object_id)
    || !REVIEW_QUEUE_STATUS_SET.has(row.queue_status)
    || typeof row.priority !== "string"
    || !REVIEW_QUEUE_PRIORITY_RE.test(row.priority)
  ) {
    return null;
  }

  const dueAt = canonicalTimestamp(row.due_at, { nullable: true });
  const createdAt = canonicalTimestamp(row.created_at);
  const updatedAt = canonicalTimestamp(row.updated_at);
  const summary = normalizedReviewQueueText(row.summary, 200);
  const requiredAction = normalizedReviewQueueText(row.required_action, 1000);
  if (
    dueAt === undefined
    || createdAt === undefined
    || updatedAt === undefined
    || !summary.ok
    || !requiredAction.ok
  ) {
    return null;
  }

  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    priority: row.priority,
    queue_status: row.queue_status,
    due_at: dueAt,
    summary: summary.value,
    required_action: requiredAction.value,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function validateStoredReviewQueueRow(row, { organizationId, reviewQueueItemId }) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "not_found";
  if (
    row.organization_id !== organizationId
    || row.review_queue_item_id !== reviewQueueItemId
    || row.queue_type !== "intake_file_review"
    || row.target_object_type !== "intake_file"
  ) {
    return "not_found";
  }
  return responseReviewQueueItem(row, organizationId) ? null : "system_error";
}

function validateLinkedIntakeFile(row, { organizationId, intakeFileId }) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  return row.organization_id === organizationId && row.intake_file_id === intakeFileId;
}

function didProtectedQueueFieldsRemainUnchanged(before, after) {
  return [
    "review_queue_item_id",
    "organization_id",
    "queue_type",
    "target_object_type",
    "target_object_id",
    "priority",
    "due_at",
    "summary",
    "required_action",
    "created_at",
  ].every((field) => before[field] === after[field]);
}

function routeName(inputRoute, fallback) {
  return inputRoute || fallback;
}

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

export async function updateReviewQueueStatus(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = String(input.organizationId || "").trim().toLowerCase();
  const reviewQueueItemId = typeof input.reviewQueueItemId === "string" ? input.reviewQueueItemId : "";
  if (
    !UUID_RE.test(organizationId)
    || !UUID_RE.test(reviewQueueItemId)
    || reviewQueueItemId !== reviewQueueItemId.toLowerCase()
  ) {
    return buildKaiError("validation_blocker");
  }

  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
    ? input.payload
    : {
      expected_queue_status: input.expectedQueueStatus,
      new_queue_status: input.newQueueStatus,
    };
  const bodyValidation = validateReviewQueueStatusRequest(payload);
  if (!bodyValidation.ok) return validationBlocked(bodyValidation.blockers);

  const expectedQueueStatus = payload.expected_queue_status;
  const newQueueStatus = payload.new_queue_status;
  if (expectedQueueStatus !== "open" || newQueueStatus !== "in_progress") {
    return buildKaiError("state_transition_denied");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const actorContext = actorResult.actorContext;
  if (actorContext.actorType !== "human") return buildKaiError("authorization_denied");
  const auth = validateActorCanPerformOperation(
    actorContext,
    "update_review_queue_status",
    organizationId,
  );
  if (!auth.ok) return buildKaiError(auth.error_code, { blockers: auth.blockers });

  const readQueueItem = dependencies.getScopedIntakeFileReviewQueueItem || getScopedIntakeFileReviewQueueItem;
  const readLinkedFile = dependencies.getScopedReviewQueueLinkedIntakeFile || getScopedReviewQueueLinkedIntakeFile;
  const writeStatus = dependencies.updateReviewQueueItemStatusIfCurrent || updateReviewQueueItemStatusIfCurrent;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;
  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const requestId = input.requestId || randomUUID();
  const auditCreatedAt = (dependencies.now ? new Date(dependencies.now()) : new Date()).toISOString();
  const route = routeName(input.route, "/api/kai/sprint2/intake/admin/review-queue/:reviewQueueItemId/status");

  try {
    return await orchestrateMutationWithRequiredAudit(
      {
        mutation: {
          organizationId,
          reviewQueueItemId,
          expectedQueueStatus,
          newQueueStatus,
        },
        requiredAuditMetadata: {
          operation: "update_review_queue_status",
          actor_user_id: actorContext.actorUserId,
          actor_type: actorContext.actorType,
          organization_id: organizationId,
          object_type: "review_queue_item",
          target_object_type: "review_queue_item",
          object_id: reviewQueueItemId,
          validator_keys: REVIEW_QUEUE_STATUS_VALIDATOR_KEYS,
          request_id: requestId,
          route,
          from_state: expectedQueueStatus,
          to_state: newQueueStatus,
          prior_status: expectedQueueStatus,
          new_status: newQueueStatus,
          created_at: auditCreatedAt,
        },
        bestEffortMetricMetadata: {
          metric_name: "kai.review_queue.status_updated",
          operation: "update_review_queue_status",
          actor_type: actorContext.actorType,
          object_type: "review_queue_item",
          outcome: "success",
          from_state: expectedQueueStatus,
          to_state: newQueueStatus,
        },
      },
      {
        async persistMutation(_mutation, transactionContext) {
          const storedRow = await readQueueItem(organizationId, reviewQueueItemId, transactionContext);
          const storedRowError = validateStoredReviewQueueRow(storedRow, {
            organizationId,
            reviewQueueItemId,
          });
          if (storedRowError) throw new KaiReviewQueueMutationError(storedRowError);

          if (storedRow.queue_status !== expectedQueueStatus) {
            throw new KaiReviewQueueMutationError("conflict_current_state_changed");
          }

          const linkedFile = await readLinkedFile(
            organizationId,
            storedRow.target_object_id,
            transactionContext,
          );
          if (!validateLinkedIntakeFile(linkedFile, {
            organizationId,
            intakeFileId: storedRow.target_object_id,
          })) {
            throw new KaiReviewQueueMutationError("not_found");
          }

          const updatedRow = await writeStatus({
            organizationId,
            reviewQueueItemId,
            expectedQueueStatus,
            newQueueStatus,
          }, transactionContext);
          if (!updatedRow) throw new KaiReviewQueueMutationError("conflict_current_state_changed");

          const updatedItem = responseReviewQueueItem(updatedRow, organizationId);
          if (
            !updatedItem
            || updatedItem.review_queue_item_id !== reviewQueueItemId
            || updatedItem.queue_status !== newQueueStatus
            || !didProtectedQueueFieldsRemainUnchanged(storedRow, updatedRow)
          ) {
            throw new KaiReviewQueueMutationError("system_error");
          }

          return {
            ok: true,
            data: updatedItem,
            warnings: [],
          };
        },
        async persistRequiredAudit(metadata, transactionContext) {
          return await insertAudit(metadata, transactionContext);
        },
        ...(typeof dependencies.emitBestEffortMetric === "function"
          ? { emitBestEffortMetric: dependencies.emitBestEffortMetric }
          : {}),
      },
      (callback) => runInTransaction(callback),
    );
  } catch (error) {
    if (error instanceof KaiReviewQueueMutationError) return buildKaiError(error.code);
    if (error instanceof RequiredAuditPersistenceError) return buildKaiError("system_error");
    return buildKaiError("system_error");
  }
}
