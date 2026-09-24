import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS, KAI_SPRINT2_P0_STRING_LIMITS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  insertImprovementPractice,
  getImprovementPracticeForOrganization,
  listImprovementPracticesForOrganization,
  updateImprovementPracticeFields,
  updateImprovementPracticeStatus,
} from "../db/kaiImprovementPracticeQueries.js";
import { withTransaction } from "../db/kaiDb.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";

/**
 * Package G (Improvement Plan / Improvement Practices). Same allowed-role
 * set as every other organization-scoped engagement operation
 * (kaiEngagementContextService.js) - a client_admin actor may manage
 * practices for its own bound organization, the same as it may create or
 * list a Project.
 */
const IMPROVEMENT_PRACTICE_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "client_admin"]);
// Reading the plan (list/get) is ordinary client visibility: the practice
// DTO (serializePractice) is the organization's own plan - title, rationale,
// cadence, status, dates, and bare ids - with no gap, evidence, claim, or
// review content. Same-org client_reviewer and client_contributor members
// may read it; create, field edits, and status changes keep
// IMPROVEMENT_PRACTICE_ALLOWED_ROLES.
const IMPROVEMENT_PRACTICE_READ_ROLES = new Set([
  ...IMPROVEMENT_PRACTICE_ALLOWED_ROLES,
  "client_reviewer",
  "client_contributor",
]);
const CREATE_IMPROVEMENT_PRACTICE_OPERATION = "create_improvement_practice";
const LIST_IMPROVEMENT_PRACTICES_OPERATION = "list_improvement_practices";
const GET_IMPROVEMENT_PRACTICE_OPERATION = "get_improvement_practice";
const UPDATE_IMPROVEMENT_PRACTICE_FIELDS_OPERATION = "update_improvement_practice_fields";
const UPDATE_IMPROVEMENT_PRACTICE_STATUS_OPERATION = "update_improvement_practice_status";

const TITLE_MAX_LENGTH = KAI_SPRINT2_P0_STRING_LIMITS.displayLabelMaxLength;
const RATIONALE_MAX_LENGTH = KAI_SPRINT2_P0_STRING_LIMITS.operatorTextMaxLength;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const IMPROVEMENT_PRACTICE_STATUSES = Object.freeze(["recommended", "active", "paused", "completed"]);
export const IMPROVEMENT_PRACTICE_CADENCES = Object.freeze([
  "one_time",
  "every_session",
  "weekly",
  "monthly",
  "quarterly",
  "annually",
  "ongoing",
]);
const STATUS_SET = new Set(IMPROVEMENT_PRACTICE_STATUSES);
const CADENCE_SET = new Set(IMPROVEMENT_PRACTICE_CADENCES);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isUuid(value) {
  return typeof value === "string" && KAI_SPRINT2_P0_PATTERNS.uuid.test(value);
}

function isIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function validationBlocker(blockingReason, objectCode, requiredFix) {
  return {
    validator_key: "VAL-KAI-IMPROVEMENT-PRACTICE-001",
    severity: "blocker",
    object_type: "improvement_practice",
    object_code: objectCode,
    object_id: null,
    message: "Improvement Practice fields are invalid.",
    blocking_reason: blockingReason,
    required_fix: requiredFix || "Send only the approved Improvement Practice fields with valid controlled values.",
    evidence: {},
  };
}

function validatePracticeFields({ title, rationale, cadence, nextDueDate, responsibleActorUserId }, { requireAll }) {
  if (requireAll || title !== undefined) {
    if (!isNonEmptyString(title) || title.trim() !== title || title.length > TITLE_MAX_LENGTH) {
      return { ok: false, blocker: validationBlocker("practice_title_invalid", "title") };
    }
  }
  if (requireAll || rationale !== undefined) {
    if (!isNonEmptyString(rationale) || rationale.trim() !== rationale || rationale.length > RATIONALE_MAX_LENGTH) {
      return { ok: false, blocker: validationBlocker("practice_rationale_invalid", "rationale") };
    }
  }
  if (requireAll || cadence !== undefined) {
    if (!CADENCE_SET.has(cadence)) {
      return { ok: false, blocker: validationBlocker("practice_cadence_invalid", "cadence") };
    }
  }
  if (nextDueDate !== undefined && nextDueDate !== null && !isIsoDate(nextDueDate)) {
    return { ok: false, blocker: validationBlocker("practice_next_due_date_invalid", "next_due_date") };
  }
  if (responsibleActorUserId !== undefined && responsibleActorUserId !== null && !isUuid(responsibleActorUserId)) {
    return { ok: false, blocker: validationBlocker("practice_responsible_actor_invalid", "responsible_actor_user_id") };
  }
  return { ok: true };
}

function serializePractice(row = {}) {
  return {
    improvement_practice_id: row.improvement_practice_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id || null,
    gap_log_item_id: row.gap_log_item_id || null,
    title: row.title,
    rationale: row.rationale,
    status: row.status,
    cadence: row.cadence,
    next_due_date: row.next_due_date || null,
    responsible_actor_user_id: row.responsible_actor_user_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function resolveAuthorizedActor(input, dependencies, operation, allowedRoles = IMPROVEMENT_PRACTICE_ALLOWED_ROLES) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return { ok: false, error: buildKaiError("feature_disabled") };
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) {
    return { ok: false, error: buildKaiError(actorResult.error_code || "authorization_denied", { blockers: actorResult.blockers }) };
  }

  const { actorContext } = actorResult;
  if (!isMappedHumanActor(actorContext)) {
    return { ok: false, error: buildKaiError("authorization_denied") };
  }

  const auth = validateActorCanPerformOperation(actorContext, operation, input.organizationId, {
    allowedRoles,
  });
  if (!auth.ok) {
    return { ok: false, error: buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers }) };
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return { ok: false, error: buildKaiError("tenant_boundary_violation", { blockers: [tenant] }) };
  }

  return { ok: true, actorContext };
}

function isCreateImprovementPracticeInput(value) {
  const allowedKeys = new Set([
    "organizationId",
    "engagementId",
    "gapLogItemId",
    "title",
    "rationale",
    "cadence",
    "nextDueDate",
    "responsibleActorUserId",
    "actorContext",
    "req",
  ]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

export async function createImprovementPractice(input = {}, dependencies = {}) {
  if (!isCreateImprovementPracticeInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const fieldValidation = validatePracticeFields(input, { requireAll: true });
  if (!fieldValidation.ok) {
    return buildKaiError("validation_blocker", { blockers: [fieldValidation.blocker] });
  }

  const authResult = await resolveAuthorizedActor(input, dependencies, CREATE_IMPROVEMENT_PRACTICE_OPERATION);
  if (!authResult.ok) return authResult.error;
  const { actorContext } = authResult;

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const insertPractice = dependencies.insertImprovementPractice || insertImprovementPractice;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;

  let practice = null;
  try {
    practice = await runInTransaction(async (tx) => {
      const insertResult = await insertPractice(
        {
          organizationId: input.organizationId,
          engagementId: input.engagementId || null,
          gapLogItemId: input.gapLogItemId || null,
          title: input.title,
          rationale: input.rationale,
          cadence: input.cadence,
          nextDueDate: input.nextDueDate || null,
          responsibleActorUserId: input.responsibleActorUserId || null,
          createdByUserId: actorContext.actorUserId,
        },
        tx,
      );
      if (!insertResult.ok) {
        const error = new Error(insertResult.error_code || "system_error");
        error.kaiErrorCode = insertResult.error_code === "invalid_reference" ? "validation_blocker" : "system_error";
        throw error;
      }

      const auditResult = await insertAudit({
        operation: CREATE_IMPROVEMENT_PRACTICE_OPERATION,
        operation_type: CREATE_IMPROVEMENT_PRACTICE_OPERATION,
        reason_code: "improvement_practice_created",
        object_type: "other",
        target_object_type: "improvement_practice",
        object_id: insertResult.practice.improvement_practice_id,
        organization_id: input.organizationId,
        engagement_id: insertResult.practice.engagement_id,
        actor_type: actorContext.actorType,
        actor_user_id: actorContext.actorUserId,
        created_by_service: "kaiImprovementPracticeService",
        metadata_only: true,
      }, tx);
      if (!auditResult?.ok) {
        const error = new Error("required audit rejected");
        error.kaiErrorCode = "audit_payload_rejected";
        throw error;
      }

      return insertResult.practice;
    });
  } catch (error) {
    if (error?.kaiErrorCode) {
      return buildKaiError(error.kaiErrorCode);
    }
    throw error;
  }

  return { ok: true, data: serializePractice(practice), error: null };
}

function isListImprovementPracticesInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId)) return false;
  if (value.engagementId !== undefined && value.engagementId !== null && !isNonEmptyString(value.engagementId)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

export async function listImprovementPracticesForOrganizationOperation(input = {}, dependencies = {}) {
  if (!isListImprovementPracticesInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const authResult = await resolveAuthorizedActor(input, dependencies, LIST_IMPROVEMENT_PRACTICES_OPERATION, IMPROVEMENT_PRACTICE_READ_ROLES);
  if (!authResult.ok) return authResult.error;

  const listPractices = dependencies.listImprovementPracticesForOrganization || listImprovementPracticesForOrganization;
  const rows = await listPractices({
    organizationId: input.organizationId,
    engagementId: input.engagementId || null,
  });

  return { ok: true, data: rows.map(serializePractice), error: null };
}

function isGetImprovementPracticeInput(value) {
  const allowedKeys = new Set(["organizationId", "improvementPracticeId", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId) || !isNonEmptyString(value.improvementPracticeId)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

export async function getImprovementPracticeOperation(input = {}, dependencies = {}) {
  if (!isGetImprovementPracticeInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const authResult = await resolveAuthorizedActor(input, dependencies, GET_IMPROVEMENT_PRACTICE_OPERATION, IMPROVEMENT_PRACTICE_READ_ROLES);
  if (!authResult.ok) return authResult.error;

  const getPractice = dependencies.getImprovementPracticeForOrganization || getImprovementPracticeForOrganization;
  const row = await getPractice({
    organizationId: input.organizationId,
    improvementPracticeId: input.improvementPracticeId,
  });
  if (!row) return buildKaiError("not_found");

  return { ok: true, data: serializePractice(row), error: null };
}

function isUpdateImprovementPracticeFieldsInput(value) {
  const allowedKeys = new Set([
    "organizationId",
    "improvementPracticeId",
    "expectedUpdatedAt",
    "title",
    "rationale",
    "cadence",
    "nextDueDate",
    "responsibleActorUserId",
    "actorContext",
    "req",
  ]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId) || !isNonEmptyString(value.improvementPracticeId)) return false;
  if (!isNonEmptyString(value.expectedUpdatedAt)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

export async function updateImprovementPracticeFieldsOperation(input = {}, dependencies = {}) {
  if (!isUpdateImprovementPracticeFieldsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const fieldValidation = validatePracticeFields(input, { requireAll: true });
  if (!fieldValidation.ok) {
    return buildKaiError("validation_blocker", { blockers: [fieldValidation.blocker] });
  }

  const authResult = await resolveAuthorizedActor(input, dependencies, UPDATE_IMPROVEMENT_PRACTICE_FIELDS_OPERATION);
  if (!authResult.ok) return authResult.error;
  const { actorContext } = authResult;

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const updateFields = dependencies.updateImprovementPracticeFields || updateImprovementPracticeFields;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;

  let practice = null;
  try {
    practice = await runInTransaction(async (tx) => {
      const updateResult = await updateFields(
        {
          organizationId: input.organizationId,
          improvementPracticeId: input.improvementPracticeId,
          expectedUpdatedAt: input.expectedUpdatedAt,
          title: input.title,
          rationale: input.rationale,
          cadence: input.cadence,
          nextDueDate: input.nextDueDate || null,
          responsibleActorUserId: input.responsibleActorUserId || null,
        },
        tx,
      );
      if (!updateResult.ok) {
        const error = new Error(updateResult.error_code || "system_error");
        error.kaiErrorCode = updateResult.error_code === "conflict_current_state_changed"
          ? "conflict_current_state_changed"
          : "validation_blocker";
        throw error;
      }

      const auditResult = await insertAudit({
        operation: UPDATE_IMPROVEMENT_PRACTICE_FIELDS_OPERATION,
        operation_type: UPDATE_IMPROVEMENT_PRACTICE_FIELDS_OPERATION,
        reason_code: "improvement_practice_fields_updated",
        object_type: "other",
        target_object_type: "improvement_practice",
        object_id: updateResult.practice.improvement_practice_id,
        organization_id: input.organizationId,
        engagement_id: updateResult.practice.engagement_id,
        actor_type: actorContext.actorType,
        actor_user_id: actorContext.actorUserId,
        created_by_service: "kaiImprovementPracticeService",
        metadata_only: true,
      }, tx);
      if (!auditResult?.ok) {
        const error = new Error("required audit rejected");
        error.kaiErrorCode = "audit_payload_rejected";
        throw error;
      }

      return updateResult.practice;
    });
  } catch (error) {
    if (error?.kaiErrorCode) {
      return buildKaiError(error.kaiErrorCode);
    }
    throw error;
  }

  return { ok: true, data: serializePractice(practice), error: null };
}

function isUpdateImprovementPracticeStatusInput(value) {
  const allowedKeys = new Set([
    "organizationId",
    "improvementPracticeId",
    "expectedUpdatedAt",
    "status",
    "actorContext",
    "req",
  ]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId) || !isNonEmptyString(value.improvementPracticeId)) return false;
  if (!isNonEmptyString(value.expectedUpdatedAt)) return false;
  if (!STATUS_SET.has(value.status)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

export async function updateImprovementPracticeStatusOperation(input = {}, dependencies = {}) {
  if (!isUpdateImprovementPracticeStatusInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const authResult = await resolveAuthorizedActor(input, dependencies, UPDATE_IMPROVEMENT_PRACTICE_STATUS_OPERATION);
  if (!authResult.ok) return authResult.error;
  const { actorContext } = authResult;

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const updateStatus = dependencies.updateImprovementPracticeStatus || updateImprovementPracticeStatus;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;

  let practice = null;
  try {
    practice = await runInTransaction(async (tx) => {
      const updateResult = await updateStatus(
        {
          organizationId: input.organizationId,
          improvementPracticeId: input.improvementPracticeId,
          expectedUpdatedAt: input.expectedUpdatedAt,
          status: input.status,
        },
        tx,
      );
      if (!updateResult.ok) {
        const error = new Error(updateResult.error_code || "system_error");
        error.kaiErrorCode = updateResult.error_code === "conflict_current_state_changed"
          ? "conflict_current_state_changed"
          : "validation_blocker";
        throw error;
      }

      const auditResult = await insertAudit({
        operation: UPDATE_IMPROVEMENT_PRACTICE_STATUS_OPERATION,
        operation_type: UPDATE_IMPROVEMENT_PRACTICE_STATUS_OPERATION,
        reason_code: "improvement_practice_status_changed",
        object_type: "other",
        target_object_type: "improvement_practice",
        object_id: updateResult.practice.improvement_practice_id,
        organization_id: input.organizationId,
        engagement_id: updateResult.practice.engagement_id,
        actor_type: actorContext.actorType,
        actor_user_id: actorContext.actorUserId,
        created_by_service: "kaiImprovementPracticeService",
        metadata_only: true,
        resulting_status: updateResult.practice.status,
      }, tx);
      if (!auditResult?.ok) {
        const error = new Error("required audit rejected");
        error.kaiErrorCode = "audit_payload_rejected";
        throw error;
      }

      return updateResult.practice;
    });
  } catch (error) {
    if (error?.kaiErrorCode) {
      return buildKaiError(error.kaiErrorCode);
    }
    throw error;
  }

  return { ok: true, data: serializePractice(practice), error: null };
}

export const __improvementPracticeServiceContract = {
  IMPROVEMENT_PRACTICE_ALLOWED_ROLES,
  IMPROVEMENT_PRACTICE_READ_ROLES,
  CREATE_IMPROVEMENT_PRACTICE_OPERATION,
  UPDATE_IMPROVEMENT_PRACTICE_STATUS_OPERATION,
};
