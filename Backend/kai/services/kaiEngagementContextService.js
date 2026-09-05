import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  getEngagementForOrganization,
  listEngagementsForOrganization,
  updateEngagementProjectMetadata,
} from "../db/kaiQueries.js";
import { withTransaction } from "../db/kaiDb.js";
import { insertRequiredSuccessfulAuditEvent } from "../db/kaiAuditQueries.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";

/**
 * KAI intake-context read: lets the Web Intake UI select an EXISTING
 * tenant-authoritative organization/engagement pair instead of the caller
 * fabricating one. Gated by exactly the roles that can create a batch with
 * the resulting engagement id: the global gk_admin/gk_operator write roles
 * (Backend/kai/config/kaiSprint2P0Contract.js#create_intake_batch) plus the
 * org-scoped client_admin write exception derived only from an active
 * kai.gk_organization_bindings row (kaiAuthorizationService.js's
 * P0_CLIENT_WRITE_ROLES) - a client_admin actor bootstrapping ordinary intake
 * for its own bound organization must be able to read that organization's
 * engagements the same as it can create a batch in it. Read-only: never
 * creates an engagement row.
 */
const LIST_ENGAGEMENTS_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "client_admin"]);
const LIST_ENGAGEMENTS_OPERATION = "list_engagement_contexts";
const UPDATE_ENGAGEMENT_TARGET_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "client_admin"]);
const UPDATE_ENGAGEMENT_TARGET_OPERATION = "update_engagement_requirement_target";
const ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY = "engagement_requirement_target";
const SAFE_TARGET_IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SAFE_TARGET_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:/#()-]{0,199}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TARGET_FIELD_DEFINITIONS = Object.freeze({
  target_funder_id: "identifier",
  target_framework: "identifier",
  grant_program_identity: "label",
  report_identity: "label",
  reporting_template_identity: "label",
  reporting_period_start: "date",
  reporting_period_end: "date",
});
const TARGET_FIELD_KEYS = new Set(Object.keys(TARGET_FIELD_DEFINITIONS));

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined || value === "") return null;
  return typeof value === "string" ? value.trim() : value;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validationBlocker(blockingReason, objectCode, requiredFix) {
  return {
    validator_key: "VAL-KAI-ENG-TARGET-001",
    severity: "blocker",
    object_type: "engagement_requirement_target",
    object_code: objectCode,
    object_id: null,
    message: "Engagement requirement target metadata is invalid.",
    blocking_reason: blockingReason,
    required_fix: requiredFix || "Send only the approved engagement target fields with valid controlled values.",
    evidence: {},
  };
}

function normalizeTargetField(key, value) {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) return { ok: true, value: null };
  if (typeof normalized !== "string") {
    return { ok: false, blocker: validationBlocker("target_field_type_invalid", key) };
  }

  const kind = TARGET_FIELD_DEFINITIONS[key];
  if (kind === "identifier" && !SAFE_TARGET_IDENTIFIER_PATTERN.test(normalized)) {
    return { ok: false, blocker: validationBlocker("target_identifier_invalid", key) };
  }
  if (kind === "label" && !SAFE_TARGET_LABEL_PATTERN.test(normalized)) {
    return { ok: false, blocker: validationBlocker("target_identity_invalid", key) };
  }
  if (kind === "date" && !isIsoDate(normalized)) {
    return { ok: false, blocker: validationBlocker("target_reporting_period_invalid", key) };
  }
  return { ok: true, value: normalized };
}

function normalizeEngagementRequirementTarget(value = {}) {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      blockers: [validationBlocker("target_payload_not_object", "engagement_requirement_target")],
    };
  }

  const unknownKeys = Object.keys(value).filter((key) => !TARGET_FIELD_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      blockers: [validationBlocker("unknown_target_field", unknownKeys[0])],
    };
  }

  const target = {};
  for (const key of TARGET_FIELD_KEYS) {
    if (!Object.hasOwn(value, key)) continue;
    const result = normalizeTargetField(key, value[key]);
    if (!result.ok) return { ok: false, blockers: [result.blocker] };
    if (result.value !== null) target[key] = result.value;
  }

  if (target.reporting_period_start && target.reporting_period_end) {
    if (target.reporting_period_start > target.reporting_period_end) {
      return {
        ok: false,
        blockers: [
          validationBlocker(
            "target_reporting_period_order_invalid",
            "reporting_period_start",
            "The reporting period start must be on or before the reporting period end.",
          ),
        ],
      };
    }
  }

  return { ok: true, target };
}

function readProjectMetadata(row = {}) {
  return isPlainObject(row.project_metadata) ? row.project_metadata : {};
}

function serializeEngagementTarget(row = {}) {
  const metadata = readProjectMetadata(row);
  const target = normalizeEngagementRequirementTarget(metadata[ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY] || {});
  return {
    engagement_id: row.engagement_id,
    organization_id: row.organization_id,
    engagement_type: row.engagement_type || null,
    engagement_status: row.engagement_status || null,
    requirement_target: target.ok ? target.target : {},
  };
}

function isMappedHumanActor(actorContext) {
  return actorContext?.actorType === "human" && isNonEmptyString(actorContext?.actorUserId);
}

function isListEngagementsInput(value) {
  const allowedKeys = new Set(["organizationId", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

function isUpdateEngagementTargetInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "target", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId) || !isNonEmptyString(value.engagementId)) return false;
  if (!isPlainObject(value.target)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

export async function listAuthorizedEngagements(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isListEngagementsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const { actorContext } = actorResult;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    LIST_ENGAGEMENTS_OPERATION,
    input.organizationId,
    { allowedRoles: LIST_ENGAGEMENTS_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const listEngagements = dependencies.listEngagementsForOrganization || listEngagementsForOrganization;
  const rows = await listEngagements({ organizationId: input.organizationId });

  return {
    ok: true,
    data: {
      items: rows.map(serializeEngagementTarget),
    },
    error: null,
  };
}

export async function updateEngagementRequirementTarget(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isUpdateEngagementTargetInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const normalizedTarget = normalizeEngagementRequirementTarget(input.target);
  if (!normalizedTarget.ok) {
    return buildKaiError("validation_blocker", { blockers: normalizedTarget.blockers });
  }

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return actorError(actorResult);

  const { actorContext } = actorResult;
  if (!isMappedHumanActor(actorContext)) {
    return buildKaiError("authorization_denied");
  }

  const auth = validateActorCanPerformOperation(
    actorContext,
    UPDATE_ENGAGEMENT_TARGET_OPERATION,
    input.organizationId,
    { allowedRoles: UPDATE_ENGAGEMENT_TARGET_ALLOWED_ROLES },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
  const updateMetadata = dependencies.updateEngagementProjectMetadata || updateEngagementProjectMetadata;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;

  let row = null;
  try {
    row = await runInTransaction(async (tx) => {
      const engagement = await readEngagement(
        { organizationId: input.organizationId, engagementId: input.engagementId, lockForUpdate: true },
        tx,
      );
      if (!engagement) return null;

      const tenant = validateTenantBoundaryConsistency({
        expectedOrganizationId: input.organizationId,
        payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
        engagementRecord: engagement,
      });
      if (tenant.severity === "blocker") {
        const error = new Error("tenant_boundary_violation");
        error.kaiErrorCode = "tenant_boundary_violation";
        error.blockers = [tenant];
        throw error;
      }

      const projectMetadata = {
        ...readProjectMetadata(engagement),
        [ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY]: normalizedTarget.target,
      };
      const updated = await updateMetadata(
        { organizationId: input.organizationId, engagementId: input.engagementId, projectMetadata },
        tx,
      );
      if (!updated) return null;

      const auditResult = await insertAudit({
        operation: UPDATE_ENGAGEMENT_TARGET_OPERATION,
        operation_type: UPDATE_ENGAGEMENT_TARGET_OPERATION,
        reason_code: "engagement_requirement_target_updated",
        object_type: "other",
        target_object_type: "engagement",
        object_id: input.engagementId,
        organization_id: input.organizationId,
        engagement_id: input.engagementId,
        actor_type: actorContext.actorType,
        actor_user_id: actorContext.actorUserId,
        created_by_service: "kaiEngagementContextService",
        metadata_only: true,
      }, tx);
      if (!auditResult?.ok) {
        const error = new Error("required audit rejected");
        error.kaiErrorCode = "audit_payload_rejected";
        throw error;
      }

      return updated;
    });
  } catch (error) {
    if (error?.kaiErrorCode) {
      return buildKaiError(error.kaiErrorCode, { blockers: error.blockers || [] });
    }
    throw error;
  }

  if (!row) return buildKaiError("not_found");

  return {
    ok: true,
    data: serializeEngagementTarget(row),
    error: null,
  };
}

export const __engagementContextServiceContract = Object.freeze({
  LIST_ENGAGEMENTS_ALLOWED_ROLES,
  LIST_ENGAGEMENTS_OPERATION,
  UPDATE_ENGAGEMENT_TARGET_ALLOWED_ROLES,
  UPDATE_ENGAGEMENT_TARGET_OPERATION,
  ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY,
  TARGET_FIELD_DEFINITIONS,
});

export const __engagementContextServiceTestables = Object.freeze({
  isListEngagementsInput,
  isUpdateEngagementTargetInput,
  isMappedHumanActor,
  normalizeEngagementRequirementTarget,
  serializeEngagementTarget,
});
