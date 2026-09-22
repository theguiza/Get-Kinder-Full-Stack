import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  getEngagementForOrganization,
  listEngagementRequirementSetsForOrganization,
  listExternalRequirementSetsForTarget,
  listEngagementsForOrganization,
  updateEngagementProjectMetadata,
} from "../db/kaiQueries.js";
import { insertInitialEngagement } from "../db/kaiOrganizationEnablementQueries.js";
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
const CLASSIFY_FUNDER_REQUIREMENTS_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "client_admin"]);
const CLASSIFY_FUNDER_REQUIREMENTS_OPERATION = "classify_engagement_funder_requirements_state";
// KAI Impact Library redesign, Package F: "+ New Project" over kai.engagements.
// Same allowed-role set as every other engagement-scoped operation in this
// file - a client_admin actor may create a Project/Engagement for its own
// bound organization, the same as it may list or update one.
const CREATE_ENGAGEMENT_ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "client_admin"]);
const CREATE_ENGAGEMENT_OPERATION = "create_engagement";
const ENGAGEMENT_CODE_MAX_LENGTH = 200;
const ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY = "engagement_requirement_target";
const SAFE_TARGET_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,95}$/;
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
const EXTERNAL_REQUIREMENT_SOURCE_TYPES = new Set([
  "funder",
  "government_program",
  "reporting_template",
  "organization",
  "standard_framework",
]);
const CLASSIFIER_STATES = Object.freeze({
  noTargetSelected: "no_target_selected",
  targetSelectedNoAuthoritativeRequirementSet: "target_selected_no_authoritative_requirement_set",
  authoritativeRequirementSetNotApplicable: "authoritative_requirement_set_not_applicable",
  applicableRequirementSetAssessmentNotAvailable: "applicable_requirement_set_assessment_not_available",
});
const APPLICABILITY_NOT_CONFIRMED_REASON =
  "engagement_requirement_sets lacks reviewed_by/reviewed_at/current_effective_state/supersession/target_snapshot provenance";
const APPLICABILITY_CONFIRMED_REASON =
  "engagement_requirement_sets has reviewed authority, current append-only lineage, effective applicability, and approved target snapshot";

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
    // KAI Impact Library redesign, Package C0: the smallest authorized
    // read-model addition needed for a human-readable Project/Engagement
    // label - engagement_code already exists on every kai.engagements row
    // (NOT NULL) and was simply not previously serialized. Never
    // fabricated: null only if a caller-supplied test fixture omits it.
    engagement_code: row.engagement_code || null,
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

function isClassifyEngagementFunderRequirementsInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementId", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId) || !isNonEmptyString(value.engagementId)) return false;
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError(actorResult.error_code || "unauthorized");
}

async function resolveAuthorizedHumanActor(input, operation, allowedRoles, dependencies) {
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
    operation,
    input.organizationId,
    { allowedRoles },
  );
  if (!auth.ok) {
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }
  return { ok: true, actorContext };
}

function hasSelectedTarget(target) {
  return Object.keys(target || {}).length > 0;
}

function requirementSetAuthorityDto(row = {}) {
  return {
    requirement_set_id: row.requirement_set_id,
    set_key: row.set_key,
    requirement_count: Number(row.requirement_count || 0),
    requirements: Array.isArray(row.requirements)
      ? row.requirements.map((requirement) => ({
          requirement_id: requirement.requirement_id,
          requirement_key: requirement.requirement_key,
        }))
      : [],
    requirement_framework_version: {
      requirement_framework_version_id: row.requirement_framework_version_id,
      framework_code: row.framework_code,
      version_label: row.version_label,
      framework_status: row.framework_status,
    },
    requirement_source: {
      requirement_source_id: row.requirement_source_id,
      source_type: row.source_type,
      source_code: row.source_code,
    },
  };
}

function applicabilityRowDto(row = {}) {
  return {
    engagement_requirement_set_id: row.engagement_requirement_set_id,
    organization_id: row.organization_id,
    engagement_id: row.engagement_id,
    requirement_set_id: row.requirement_set_id,
    applicability_status: row.applicability_status,
    applicability_effective_state: row.applicability_effective_state || null,
    reviewed_by: row.reviewed_by || null,
    reviewed_by_role: row.reviewed_by_role || null,
    reviewed_at: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at || null,
    supersedes_engagement_requirement_set_id: row.supersedes_engagement_requirement_set_id || null,
    superseded_by_engagement_requirement_set_id: row.superseded_by_engagement_requirement_set_id || null,
    target_context_identity: isPlainObject(row.target_context_identity) ? row.target_context_identity : null,
    created_by_type: row.created_by_type,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at || null,
    requirement_framework_version: {
      requirement_framework_version_id: row.requirement_framework_version_id,
      framework_code: row.framework_code,
      version_label: row.version_label,
      framework_status: row.framework_status,
    },
    requirement_source: {
      requirement_source_id: row.requirement_source_id,
      source_type: row.source_type,
      source_code: row.source_code,
    },
  };
}

function isExternalAuthoritativeRequirementSet(row = {}) {
  return (
    EXTERNAL_REQUIREMENT_SOURCE_TYPES.has(row.source_type) &&
    row.source_type !== "kai_standard" &&
    row.framework_status === "active"
  );
}

function rowMatchesTarget(row = {}, target = {}) {
  return row.source_code === target.target_funder_id && row.framework_code === target.target_framework;
}

function canonicalObject(value) {
  if (!isPlainObject(value)) return null;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    const child = value[key];
    if (isPlainObject(child)) {
      output[key] = canonicalObject(child);
    } else if (Array.isArray(child)) {
      output[key] = child.map((item) => (isPlainObject(item) ? canonicalObject(item) : item));
    } else {
      output[key] = child;
    }
  }
  return output;
}

function targetContextMatches(row = {}, target = {}) {
  const normalized = normalizeEngagementRequirementTarget(row.target_context_identity || {});
  if (!normalized.ok) return false;
  return JSON.stringify(canonicalObject(normalized.target)) === JSON.stringify(canonicalObject(target));
}

function isCurrentReviewedApplicability(row = {}, target = {}) {
  return (
    row.applicability_status === "confirmed" &&
    row.reviewed_by &&
    row.reviewed_by_role &&
    row.reviewed_at &&
    ["applicable", "not_applicable"].includes(row.applicability_effective_state) &&
    !row.superseded_by_engagement_requirement_set_id &&
    targetContextMatches(row, target)
  );
}

function classifyApplicabilityRows({ target, authoritativeRequirementSets, applicabilityRows }) {
  const authoritativeIds = new Set(authoritativeRequirementSets.map((row) => row.requirement_set_id));
  const matchingRows = applicabilityRows.filter((row) =>
    authoritativeIds.has(row.requirement_set_id) &&
    isExternalAuthoritativeRequirementSet(row) &&
    rowMatchesTarget(row, target),
  );
  return matchingRows.map((row) => {
    const dto = applicabilityRowDto(row);
    if (isCurrentReviewedApplicability(row, target)) {
      return {
        ...dto,
        applicability_conclusion: row.applicability_effective_state === "applicable" ? "CURRENT_APPLICABLE" : "CURRENT_NOT_APPLICABLE",
        applicability_confirmed_reason: APPLICABILITY_CONFIRMED_REASON,
      };
    }
    return {
      ...dto,
      applicability_conclusion: "NOT_CONFIRMED",
      not_confirmed_reason: APPLICABILITY_NOT_CONFIRMED_REASON,
      missing_persistence: [
        "reviewed_by",
        "reviewed_at",
        "current_effective_state",
        "superseded_by_or_replaced_by",
        "target_snapshot_at_approval",
      ],
    };
  });
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

function isCreateEngagementInput(value) {
  const allowedKeys = new Set(["organizationId", "engagementCode", "engagementType", "actorContext", "req"]);
  if (!isPlainObject(value) || !Object.keys(value).every((key) => allowedKeys.has(key))) return false;
  if (!isNonEmptyString(value.organizationId)) return false;
  if (
    !isNonEmptyString(value.engagementCode)
    || value.engagementCode.length > ENGAGEMENT_CODE_MAX_LENGTH
    || value.engagementCode.trim() !== value.engagementCode
  ) {
    return false;
  }
  if (
    value.engagementType !== undefined
    && value.engagementType !== null
    && (!isNonEmptyString(value.engagementType) || value.engagementType.length > ENGAGEMENT_CODE_MAX_LENGTH)
  ) {
    return false;
  }
  return isPlainObject(value.actorContext) || isPlainObject(value.req);
}

/**
 * "+ New Project" (Package F). Project remains a UI label over
 * kai.engagements - no second Project model, no new table. Reuses the
 * existing, already-idempotent-on-conflict insertInitialEngagement DB
 * write (previously only ever called by organization-enablement bootstrap
 * with a fixed default code); this is the first authorized path that lets
 * an ordinary actor create an ADDITIONAL, user-named engagement for an
 * organization that already has one. Mirrors
 * updateEngagementRequirementTarget's transaction + required-audit
 * pattern above exactly - the same file, the same write conventions.
 */
export async function createEngagement(input = {}, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isCreateEngagementInput(input)) {
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
    CREATE_ENGAGEMENT_OPERATION,
    input.organizationId,
    { allowedRoles: CREATE_ENGAGEMENT_ALLOWED_ROLES },
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

  const runInTransaction = dependencies.runInTransaction || withTransaction;
  const insertEngagement = dependencies.insertInitialEngagement || insertInitialEngagement;
  const insertAudit = dependencies.insertRequiredSuccessfulAuditEvent || insertRequiredSuccessfulAuditEvent;

  let engagement = null;
  try {
    engagement = await runInTransaction(async (tx) => {
      const insertResult = await insertEngagement(
        {
          organizationId: input.organizationId,
          engagementCode: input.engagementCode,
          createdByUserId: actorContext.actorUserId,
          engagementType: isNonEmptyString(input.engagementType) ? input.engagementType : null,
        },
        tx,
      );
      if (!insertResult.ok) {
        const error = new Error(insertResult.error_code || "system_error");
        error.kaiErrorCode = insertResult.error_code === "conflicting_engagement"
          ? "engagement_code_conflict"
          : "system_error";
        throw error;
      }

      const auditResult = await insertAudit({
        operation: CREATE_ENGAGEMENT_OPERATION,
        operation_type: CREATE_ENGAGEMENT_OPERATION,
        reason_code: "engagement_created",
        object_type: "other",
        target_object_type: "engagement",
        object_id: insertResult.engagement.engagement_id,
        organization_id: input.organizationId,
        engagement_id: insertResult.engagement.engagement_id,
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

      return insertResult.engagement;
    });
  } catch (error) {
    if (error?.kaiErrorCode) {
      return buildKaiError(error.kaiErrorCode);
    }
    throw error;
  }

  return {
    ok: true,
    data: {
      engagement_id: engagement.engagement_id,
      organization_id: engagement.organization_id,
      engagement_code: engagement.engagement_code,
      engagement_type: engagement.engagement_type || null,
    },
    error: null,
  };
}

export async function classifyEngagementFunderRequirementsState(input, dependencies = {}) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return buildKaiError("feature_disabled");
  }
  if (!isClassifyEngagementFunderRequirementsInput(input)) {
    return buildKaiError("validation_blocker");
  }

  const actor = await resolveAuthorizedHumanActor(
    input,
    CLASSIFY_FUNDER_REQUIREMENTS_OPERATION,
    CLASSIFY_FUNDER_REQUIREMENTS_ALLOWED_ROLES,
    dependencies,
  );
  if (!actor.ok) return actor;

  const readEngagement = dependencies.getEngagementForOrganization || getEngagementForOrganization;
  const listAuthority = dependencies.listExternalRequirementSetsForTarget || listExternalRequirementSetsForTarget;
  const listApplicability = dependencies.listEngagementRequirementSetsForOrganization || listEngagementRequirementSetsForOrganization;

  const engagement = await readEngagement({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
  });
  if (!engagement) return buildKaiError("not_found");

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.organizationId,
    payload: { organization_id: input.organizationId, engagement_id: input.engagementId },
    engagementRecord: engagement,
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  const engagementDto = serializeEngagementTarget(engagement);
  const target = engagementDto.requirement_target;
  if (!hasSelectedTarget(target)) {
    return {
      ok: true,
      data: {
        state: CLASSIFIER_STATES.noTargetSelected,
        engagement: engagementDto,
        target,
        authoritative_requirement_sets: [],
        applicability_rows: [],
        applicable_requirement_sets: [],
        not_confirmed_states: [CLASSIFIER_STATES.applicableRequirementSetAssessmentNotAvailable],
      },
      error: null,
    };
  }

  if (!target.target_funder_id || !target.target_framework) {
    return {
      ok: true,
      data: {
        state: CLASSIFIER_STATES.targetSelectedNoAuthoritativeRequirementSet,
        engagement: engagementDto,
        target,
        authoritative_requirement_sets: [],
        applicability_rows: [],
        applicable_requirement_sets: [],
        not_confirmed_states: [CLASSIFIER_STATES.applicableRequirementSetAssessmentNotAvailable],
        missing_persistence: [],
      },
      error: null,
    };
  }

  const authoritativeRequirementSets = (await listAuthority({
    sourceCode: target.target_funder_id,
    frameworkCode: target.target_framework,
  })).filter((row) => isExternalAuthoritativeRequirementSet(row) && rowMatchesTarget(row, target));

  if (authoritativeRequirementSets.length === 0) {
    return {
      ok: true,
      data: {
        state: CLASSIFIER_STATES.targetSelectedNoAuthoritativeRequirementSet,
        engagement: engagementDto,
        target,
        authoritative_requirement_sets: [],
        applicability_rows: [],
        applicable_requirement_sets: [],
        not_confirmed_states: [CLASSIFIER_STATES.applicableRequirementSetAssessmentNotAvailable],
      },
      error: null,
    };
  }

  const applicabilityRows = await listApplicability({
    organizationId: input.organizationId,
    engagementId: input.engagementId,
  });
  const classifiedApplicability = classifyApplicabilityRows({
    target,
    authoritativeRequirementSets,
    applicabilityRows,
  });
  // requirementSetAuthorityDto expects the flat listExternalRequirementSetsForTarget
  // row shape (a top-level source_type/source_code plus an aggregated
  // requirements array) - classifiedApplicability rows are instead
  // listEngagementRequirementSetsForOrganization rows already reshaped by
  // applicabilityRowDto (nested requirement_source/requirement_framework_version,
  // no requirements array at all). Map each CURRENT_APPLICABLE row back to
  // its already-validated authoritativeRequirementSets entry (same
  // requirement_set_id) before projecting, so the governed requirement
  // list/source/framework actually reach the caller instead of silently
  // resolving to an empty list and undefined source/framework fields.
  const applicableRequirementSets = classifiedApplicability
    .filter((row) => row.applicability_conclusion === "CURRENT_APPLICABLE")
    .map((row) => authoritativeRequirementSets.find((set) => set.requirement_set_id === row.requirement_set_id))
    .filter(Boolean)
    .map(requirementSetAuthorityDto);

  if (applicableRequirementSets.length > 0) {
    return {
      ok: true,
      data: {
        state: CLASSIFIER_STATES.applicableRequirementSetAssessmentNotAvailable,
        engagement: engagementDto,
        target,
        authoritative_requirement_sets: authoritativeRequirementSets.map(requirementSetAuthorityDto),
        applicability_rows: classifiedApplicability,
        applicable_requirement_sets: applicableRequirementSets,
        applicability_conclusion: "CURRENT_APPLICABLE",
        not_confirmed_states: [],
        missing_persistence: [],
      },
      error: null,
    };
  }

  return {
    ok: true,
    data: {
      state: CLASSIFIER_STATES.authoritativeRequirementSetNotApplicable,
      engagement: engagementDto,
      target,
      authoritative_requirement_sets: authoritativeRequirementSets.map(requirementSetAuthorityDto),
      applicability_rows: classifiedApplicability,
      applicable_requirement_sets: [],
      applicability_conclusion: classifiedApplicability.length > 0
        ? classifiedApplicability[0].applicability_conclusion
        : "none",
      not_confirmed_states: [CLASSIFIER_STATES.applicableRequirementSetAssessmentNotAvailable],
      missing_persistence: classifiedApplicability.some((row) => row.applicability_conclusion === "NOT_CONFIRMED")
        ? [
            "reviewed_by",
            "reviewed_at",
            "current_effective_state",
            "superseded_by_or_replaced_by",
            "target_snapshot_at_approval",
          ]
        : [],
    },
    error: null,
  };
}

export const __engagementContextServiceContract = Object.freeze({
  LIST_ENGAGEMENTS_ALLOWED_ROLES,
  LIST_ENGAGEMENTS_OPERATION,
  UPDATE_ENGAGEMENT_TARGET_ALLOWED_ROLES,
  UPDATE_ENGAGEMENT_TARGET_OPERATION,
  CLASSIFY_FUNDER_REQUIREMENTS_ALLOWED_ROLES,
  CLASSIFY_FUNDER_REQUIREMENTS_OPERATION,
  CREATE_ENGAGEMENT_ALLOWED_ROLES,
  CREATE_ENGAGEMENT_OPERATION,
  ENGAGEMENT_REQUIREMENT_TARGET_METADATA_KEY,
  TARGET_FIELD_DEFINITIONS,
  CLASSIFIER_STATES,
  APPLICABILITY_NOT_CONFIRMED_REASON,
  APPLICABILITY_CONFIRMED_REASON,
});

export const __engagementContextServiceTestables = Object.freeze({
  isListEngagementsInput,
  isUpdateEngagementTargetInput,
  isClassifyEngagementFunderRequirementsInput,
  isCreateEngagementInput,
  isMappedHumanActor,
  normalizeEngagementRequirementTarget,
  serializeEngagementTarget,
  isExternalAuthoritativeRequirementSet,
  rowMatchesTarget,
  targetContextMatches,
  isCurrentReviewedApplicability,
});
