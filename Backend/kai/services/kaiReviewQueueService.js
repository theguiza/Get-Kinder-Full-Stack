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
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import { createPostgresReviewQueueRepository } from "../dictionary/postgresReviewQueueRepository.js";
import { createProductionMetadataOnlyAuditForSensitivityReviewQueueItem } from "./kaiMetadataOnlyAuditComposition.js";

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

const SENSITIVITY_REVIEW_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNormalizedNow(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString() === value;
}

function isCreateSensitivityReviewQueueItemInput(value) {
  const allowedKeys = new Set(["organizationId", "intakeSensitivityProfileId", "actorContext", "now"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  return (
    isNonEmptyString(value.organizationId) &&
    isNonEmptyString(value.intakeSensitivityProfileId) &&
    isPlainObject(value.actorContext) &&
    isNormalizedNow(value.now)
  );
}

const SENSITIVITY_REVIEW_OPERATION = "create_sensitivity_review_queue_item";

/**
 * AUTH-KAI-003: a P1-06 'sensitivity_review' queue item may only be created by a
 * mapped human actor. Every non-human actor type (ai, system, import, code, or any
 * other generic-service actor) is rejected outright - there is no bypass. This is a
 * strictly narrower allowlist than the shared assistant-boundary validator's
 * recognized non-human actor-type set, so it is kept as an explicit pre-condition
 * rather than folded into `validateActorCanPerformOperation` below.
 */
function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

/**
 * KAI P1-06 dormant sensitivity-review queue-item creation seam.
 *
 * Idempotent creation of exactly one 'sensitivity_review' `kai.review_queue_items`
 * row for an existing, tenant-scoped, committed P1-05 `kai.intake_sensitivity_profiles`
 * row that satisfies the VAL-FUP-001-P0 creation-trigger predicate (human review
 * required and public/funder/LLM/product-learning use all still denied, retention
 * still restricted pending review). This reuses the existing canonical
 * `kai.review_queue_items` table via the injected P1-06 repository; it never writes
 * a queue_type other than
 * 'sensitivity_review', never transitions queue_status beyond null -> 'open', and
 * performs no resolution, approval, escalation, or promotion. It is not composed into
 * any route, listener, or production path, and it does not modify
 * `createReviewQueueItem` or `updateReviewQueueStatus` above.
 *
 * Contains no SQL and imports no database pool: persistence is delegated entirely to
 * the injected P1-06 review-queue repository. Authorization and tenant-membership
 * checks are delegated to the existing shared validator-group mechanisms
 * (`validateActorCanPerformOperation`, `validateTenantBoundaryConsistency`) rather
 * than reimplemented locally; their structured blockers are preserved on the
 * returned error.
 */
export async function createSensitivityReviewQueueItem(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCreateSensitivityReviewQueueItemInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    SENSITIVITY_REVIEW_OPERATION,
    input.organizationId,
    { allowedRoles: SENSITIVITY_REVIEW_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError("tenant_boundary_violation", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const reviewQueueRepository = dependencies.reviewQueueRepository || createPostgresReviewQueueRepository();

  const result = await reviewQueueRepository.createSensitivityReviewQueueItem({
    identity: {
      organizationId: input.organizationId,
      intakeSensitivityProfileId: input.intakeSensitivityProfileId,
    },
    actorUserId: actorContext.actorUserId,
    now: input.now,
    metadataOnlyAudit: dependencies.metadataOnlyAudit,
  });

  if (!result.ok) {
    return buildKaiError(result.error.code, { status: result.error.status });
  }
  return { ok: true, data: result.data, error: null };
}

/**
 * KAI B1A-2R: closes the one missing P1-05 -> P1-06 lifecycle edge. Normal
 * runtime creates a P1-05 `intake_sensitivity_profile`, but until this seam
 * existed there was no normal application path that created the corresponding
 * P1-06 'sensitivity_review' work item, which left B1A-2's already-built Phase-5
 * decision endpoint reachable only via manual/synthetic database seeding (it
 * requires an existing `review_queue_item_id`).
 *
 * This function implements no authorization, idempotency, replay, or
 * persistence logic of its own. It resolves the request's actor context using
 * the exact same seam `updateReviewQueueStatus` above already uses, then hands
 * the operation entirely to the existing, unmodified `createSensitivityReviewQueueItem`:
 * AUTH-KAI-003 (mapped-human-only, gk_admin/gk_operator/gk_reviewer,
 * active-membership), VAL-FUP-001-P0 (the fail-closed creation-trigger
 * predicate), and the partial-unique-index create/replay semantics all continue
 * to live there, untouched and not reimplemented. This creates no new queue
 * table, no new queue abstraction, and no parallel review-work service; it never
 * writes a queue_type other than 'sensitivity_review', never asserts a
 * queue_status, priority, summary, or required_action of its own, and records or
 * resolves no classification, consent, allowed-use, or Phase-5 decision of any
 * kind - ensuring the work item exists grants zero substantive authority.
 */
export async function ensureSensitivityReviewQueueItem(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = typeof input.organizationId === "string"
    ? input.organizationId.trim().toLowerCase()
    : "";
  const intakeSensitivityProfileId = typeof input.intakeSensitivityProfileId === "string"
    ? input.intakeSensitivityProfileId
    : "";
  if (
    !UUID_RE.test(organizationId)
    || !UUID_RE.test(intakeSensitivityProfileId)
    || intakeSensitivityProfileId !== intakeSensitivityProfileId.toLowerCase()
  ) {
    return buildKaiError("validation_blocker");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);
  const actorContext = actorResult.actorContext;

  const now = isNormalizedNow(input.now)
    ? input.now
    : (dependencies.now ? new Date(dependencies.now()) : new Date()).toISOString();

  const metadataOnlyAudit = dependencies.metadataOnlyAudit
    || createProductionMetadataOnlyAuditForSensitivityReviewQueueItem({
      organizationId,
      intakeSensitivityProfileId,
      actorContext,
      now,
    });

  // Named distinctly from the local `createSensitivityReviewQueueItem` binding
  // so a caller-supplied override never masks the fact that, by default, this
  // seam is the one and only P1-06 operation actually invoked below.
  const ensureQueueItem = dependencies.createSensitivityReviewQueueItem || createSensitivityReviewQueueItem;
  const result = await ensureQueueItem(
    { organizationId, intakeSensitivityProfileId, actorContext, now },
    {
      env: dependencies.env,
      ...(dependencies.reviewQueueRepository ? { reviewQueueRepository: dependencies.reviewQueueRepository } : {}),
      metadataOnlyAudit,
    },
  );

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      reviewQueueItem: result.data.reviewQueueItem,
      replayed: result.data.replayed,
    },
    error: null,
  };
}
