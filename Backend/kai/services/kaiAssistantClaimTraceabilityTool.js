import { isKaiSprint2Enabled } from "../config/kaiSprint2Config.js";
import { buildKaiError } from "../errors/kaiErrors.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import {
  validateAssistantCannotAccessRawFiles,
  validateAssistantCannotApprove,
  validateAssistantToolAuthorization,
  validatePromptInjectionQuarantine,
} from "../validators/assistantBoundaryValidators.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";

const TRACEABILITY_TOOL_NAME = "get_claim_traceability_summary";
const ELIGIBLE_CLAIMS_TOOL_NAME = "list_eligible_claims_for_audience";
const GOVERNED_CLAIMS_TOOL_NAME = "list_governed_claims";
const CLIENT_FOLLOWUP_TOOL_NAME = "list_client_followup_workflows";
const TOOL_NAMES = new Set([
  TRACEABILITY_TOOL_NAME,
  ELIGIBLE_CLAIMS_TOOL_NAME,
  GOVERNED_CLAIMS_TOOL_NAME,
  CLIENT_FOLLOWUP_TOOL_NAME,
]);
const TOP_LEVEL_KEYS = new Set(["toolName", "arguments", "actorContext"]);
const TRACEABILITY_ARGUMENT_KEYS = new Set(["organizationId", "claimId", "requestedAudience"]);
const ELIGIBLE_CLAIMS_ARGUMENT_KEYS = new Set(["organizationId", "requestedAudience", "limit", "afterClaimId"]);
const GOVERNED_CLAIMS_ARGUMENT_KEYS = new Set(["organizationId", "limit", "afterClaimId"]);
const CLIENT_FOLLOWUP_ARGUMENT_KEYS = new Set(["organizationId"]);
const GOVERNED_CLAIMS_MAX_LIMIT = 25;
const REQUESTED_AUDIENCES = new Set(["internal", "funder", "public"]);
const ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
// P2-11's read companion is deliberately scoped to client_reviewer only (see
// kaiClientFollowupReadService.js) - a different, narrower authority than the
// GK-staff-only ALLOWED_ROLES above, never unioned with it.
const CLIENT_FOLLOWUP_ALLOWED_ROLES = new Set(["client_reviewer"]);
const PRESERVED_FAILURE_CODES = new Set([
  "not_found",
  "conflict_current_state_changed",
  "authorization_denied",
  "unauthorized",
  "mapped_kai_user_required",
  "tenant_boundary_violation",
  "validation_blocker",
  "feature_disabled",
]);
const SAFE_STATUS_VALUES = new Set([
  "active",
  "approved",
  "complete",
  "current",
  "draft",
  "eligible",
  "finding",
  "internal",
  "needs_gk_review",
  "normal",
  "open",
  "proposed",
  "public",
  "funder",
  "resolved",
  "unassessed",
  "unknown",
  "unresolved",
  "waiting_on_client",
  "closed",
  "blocked",
  "not_allowed",
  "not allowed",
  "allowed",
  "system",
  "human_selected_unresolved_comparison",
]);
const ID_OR_CODE_KEY_PATTERN =
  /(^|_)(id|ids|code|codes|type|status|statuses|key|keys|strength|eligible|truncated|allowed|current|only|ready|gates|dimensions|items|claim|evidence|locator|source|version|candidate|decision|review|workflow|blocker|affected|groups)$/i;
const PROHIBITED_OUTPUT_KEY_PATTERN =
  /\b(text|summary|question|raw|row|rows|sample|samples|file|filename|file_name|storage|object_key|signed_url|prompt|credential|secret|note|email|phone|address|name|ssn|dob|birth)\b/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{32,128}$/i;
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9_:-]*$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isEnabledValue(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

function isAssistantToolsEnabled(env) {
  return isEnabledValue(env?.KAI_ASSISTANT_TOOLS_ENABLED);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowedKeys.size && keys.every((key) => allowedKeys.has(key));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function validationBlocker(blockers = []) {
  return buildKaiError("validation_blocker", { blockers });
}

function systemError() {
  return buildKaiError("system_error");
}

function isMappedHumanActor(actorContext) {
  const source = actorContext?.source ?? actorContext?.legacyIdentitySource;
  return (
    isPlainObject(actorContext) &&
    actorContext.actorType === "human" &&
    isNonEmptyString(actorContext.actorUserId) &&
    source === "public.userdata"
  );
}

function validateArgumentsShape(args) {
  return (
    hasExactKeys(args, TRACEABILITY_ARGUMENT_KEYS) &&
    isNonEmptyString(args.organizationId) &&
    isNonEmptyString(args.claimId) &&
    REQUESTED_AUDIENCES.has(args.requestedAudience)
  );
}

function validateEligibleClaimsArgumentsShape(args) {
  return (
    hasExactKeys(args, ELIGIBLE_CLAIMS_ARGUMENT_KEYS) &&
    isNonEmptyString(args.organizationId) &&
    REQUESTED_AUDIENCES.has(args.requestedAudience) &&
    Number.isInteger(args.limit) &&
    args.limit >= 1 &&
    args.limit <= 100 &&
    (args.afterClaimId === null ||
      (typeof args.afterClaimId === "string" && CANONICAL_UUID_PATTERN.test(args.afterClaimId)))
  );
}

function validateGovernedClaimsArgumentsShape(args) {
  return (
    hasExactKeys(args, GOVERNED_CLAIMS_ARGUMENT_KEYS) &&
    isNonEmptyString(args.organizationId) &&
    Number.isInteger(args.limit) &&
    args.limit >= 1 &&
    args.limit <= GOVERNED_CLAIMS_MAX_LIMIT &&
    (args.afterClaimId === null ||
      (typeof args.afterClaimId === "string" && CANONICAL_UUID_PATTERN.test(args.afterClaimId)))
  );
}

function validateClientFollowupArgumentsShape(args) {
  return hasExactKeys(args, CLIENT_FOLLOWUP_ARGUMENT_KEYS) && isNonEmptyString(args.organizationId);
}

function safeStringForKey(key, value) {
  if (key === "updated_at" && ISO_TIMESTAMP_PATTERN.test(value)) return true;
  if (UUID_PATTERN.test(value) || HASH_PATTERN.test(value) || SAFE_CODE_PATTERN.test(value)) return true;
  return SAFE_STATUS_VALUES.has(value) || ID_OR_CODE_KEY_PATTERN.test(key);
}

function validateMetadataSafeValue(key, value) {
  if (PROHIBITED_OUTPUT_KEY_PATTERN.test(key)) return false;
  if (value === null || typeof value === "boolean" || Number.isInteger(value)) return true;
  if (typeof value === "string") return safeStringForKey(key, value);
  if (Array.isArray(value)) return value.every((item) => validateMetadataSafeValue(key, item));
  if (!isPlainObject(value)) return false;
  return Object.entries(value).every(([childKey, childValue]) => validateMetadataSafeValue(childKey, childValue));
}

const TRACEABILITY_DIMENSION_KEYS = new Set([
  "assessment_status",
  "validator_key",
  "internal_limitation_accepted",
  "blocks_requested_audience",
]);
const TRACEABILITY_CLAIM_KEYS = new Set([
  "claim_id",
  "claim_type",
  "claim_status",
  "claim_review_status",
  "claim_strength",
  "audience_gates",
]);
const TRACEABILITY_AUDIENCE_GATE_KEYS = new Set([
  "internal_only",
  "public_use_allowed",
  "funder_use_allowed",
  "export_ready",
]);
const TRACEABILITY_EVIDENCE_KEYS = new Set([
  "evidence_item_id",
  "evidence_review_status",
  "support_strength",
  "review_queue_item_id",
  "review_queue_status",
  "review_status",
  "updated_at",
  "sensitivity_level",
]);
const GOVERNED_CLAIM_KEYS = new Set([
  "claimId",
  "evidenceItemId",
  "claimType",
  "claimStatus",
  "claimReviewStatus",
  "claimStrength",
  "reviewQueueItems",
]);
const GOVERNED_CLAIM_REVIEW_QUEUE_ITEM_KEYS = new Set([
  "review_queue_item_id",
  "queue_type",
  "target_object_type",
  "target_object_id",
  "queue_status",
  "review_status",
]);
const CLIENT_FOLLOWUP_WORKFLOW_KEYS = new Set([
  "claim_id",
  "client_followup_item_id",
  "dimension_key",
  "question_text",
  "review_queue_item_id",
  "queue_status",
  "review_status",
  "updated_at",
]);
// Mirrors the DB-enforced fixed dimension/question pairing (CHECK constraints
// client_followup_items_p2_04_question_text_check and
// _dimension_question_pairing_check in migrations/kai_sprint2_p2_04_claim_gap_followup.sql).
// question_text is one of exactly four server-owned template strings, never
// caller-supplied or free-form - so, unlike other string fields, it is
// validated against this closed set rather than the generic
// validateMetadataSafeValue (whose PROHIBITED_OUTPUT_KEY_PATTERN deliberately
// rejects any key named "question"/"text" as a general free-text guard).
const CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION = Object.freeze({
  definition_clarity: "Confirm the business meaning of the unresolved field or measure.",
  denominator_clarity: "Confirm the denominator and how it is calculated.",
  time_period_clarity: "Confirm the reporting period represented by this source.",
  entity_level_clarity: "Confirm the entity level represented by the unresolved field or measure.",
});
const TRACEABILITY_LOCATOR_KEYS = new Set(["source_locator_id"]);
const TRACEABILITY_SOURCE_KEYS = new Set(["source_id", "source_code"]);
const TRACEABILITY_SOURCE_VERSION_KEYS = new Set(["source_version_id", "is_current"]);
const TRACEABILITY_CLAIM_REVIEW_KEYS = new Set([
  "review_queue_item_id",
  "queue_status",
  "review_status",
  "updated_at",
]);
const TRACEABILITY_CANDIDATE_KEYS = new Set(["intake_source_candidate_id"]);
const TRACEABILITY_PROMOTION_DECISION_KEYS = new Set(["intake_promotion_decision_id"]);
const TRACEABILITY_GAP_ITEM_KEYS = new Set([
  "gap_log_item_id",
  "dimension_key",
  "assessment_status",
  "validator_key",
]);
const TRACEABILITY_FOLLOWUP_WORKFLOW_KEYS = new Set([
  "client_followup_item_id",
  "gap_log_item_id",
  "dimension_key",
  "workflow_status",
  "review_status",
  "review_queue_item_id",
]);
const TRACEABILITY_CONFLICT_GROUP_KEYS = new Set([
  "conflict_group_id",
  "lower_claim_id",
  "higher_claim_id",
  "lower_claim_conflict_gap_id",
  "higher_claim_conflict_gap_id",
  "basis_code",
  "review_queue_item_id",
  "review_status",
  "workflow_status",
]);

function validateExactSafeObject(value, keys) {
  return hasExactKeys(value, keys) && Object.entries(value).every(([key, childValue]) => validateMetadataSafeValue(key, childValue));
}

function validateClaim(claim) {
  return (
    validateExactSafeObject(claim, TRACEABILITY_CLAIM_KEYS) &&
    validateExactSafeObject(claim.audience_gates, TRACEABILITY_AUDIENCE_GATE_KEYS)
  );
}

function validateArrayEntries(entries, keys) {
  return Array.isArray(entries) && entries.every((entry) => validateExactSafeObject(entry, keys));
}

function validateDimensions(dimensions) {
  if (!isPlainObject(dimensions)) return false;

  return Object.values(dimensions).every(
    (dimension) =>
      hasExactKeys(dimension, TRACEABILITY_DIMENSION_KEYS) &&
      typeof dimension.assessment_status === "string" &&
      typeof dimension.validator_key === "string" &&
      typeof dimension.internal_limitation_accepted === "boolean" &&
      typeof dimension.blocks_requested_audience === "boolean" &&
      validateMetadataSafeValue("assessment_status", dimension.assessment_status) &&
      validateMetadataSafeValue("validator_key", dimension.validator_key) &&
      validateMetadataSafeValue(
        "internal_limitation_accepted",
        dimension.internal_limitation_accepted,
      ) &&
      validateMetadataSafeValue(
        "blocks_requested_audience",
        dimension.blocks_requested_audience,
      ),
  );
}

function validateSuccessDto(data) {
  const rootKeys = new Set([
    "claim",
    "evidence",
    "locator",
    "source",
    "source_version",
    "claim_review",
    "candidate",
    "promotion_decision",
    "dimensions",
    "gap_items",
    "client_followup_workflows",
    "potential_conflict_groups",
    "requestedAudience",
    "eligible",
    "blockerCodes",
    "affectedDimensionKeys",
    "affectedObjectIds",
    "truncated",
  ]);
  return (
    hasExactKeys(data, rootKeys) &&
    validateDimensions(data.dimensions) &&
    validateClaim(data.claim) &&
    validateExactSafeObject(data.evidence, TRACEABILITY_EVIDENCE_KEYS) &&
    validateExactSafeObject(data.locator, TRACEABILITY_LOCATOR_KEYS) &&
    validateExactSafeObject(data.source, TRACEABILITY_SOURCE_KEYS) &&
    validateExactSafeObject(data.source_version, TRACEABILITY_SOURCE_VERSION_KEYS) &&
    validateExactSafeObject(data.claim_review, TRACEABILITY_CLAIM_REVIEW_KEYS) &&
    validateExactSafeObject(data.candidate, TRACEABILITY_CANDIDATE_KEYS) &&
    validateExactSafeObject(data.promotion_decision, TRACEABILITY_PROMOTION_DECISION_KEYS) &&
    validateArrayEntries(data.gap_items, TRACEABILITY_GAP_ITEM_KEYS) &&
    validateArrayEntries(data.client_followup_workflows, TRACEABILITY_FOLLOWUP_WORKFLOW_KEYS) &&
    validateArrayEntries(data.potential_conflict_groups, TRACEABILITY_CONFLICT_GROUP_KEYS) &&
    validateMetadataSafeValue("requestedAudience", data.requestedAudience) &&
    validateMetadataSafeValue("eligible", data.eligible) &&
    validateMetadataSafeValue("blockerCodes", data.blockerCodes) &&
    validateMetadataSafeValue("affectedDimensionKeys", data.affectedDimensionKeys) &&
    validateMetadataSafeValue("affectedObjectIds", data.affectedObjectIds) &&
    validateMetadataSafeValue("truncated", data.truncated)
  );
}

function validateEligibleClaimEntry(entry) {
  const keys = new Set([
    "claimId",
    "claimType",
    "claimStatus",
    "claimReviewStatus",
    "supportStrength",
    "evidenceItemId",
    "sourceId",
    "sourceVersionId",
    "requestedAudience",
  ]);
  return hasExactKeys(entry, keys) && Object.entries(entry).every(([key, value]) => validateMetadataSafeValue(key, value));
}

function validateEligibleClaimsSuccessDto(data) {
  const rootKeys = new Set([
    "requestedAudience",
    "eligibleClaims",
    "limit",
    "afterClaimId",
    "truncated",
    "nextAfterClaimId",
  ]);
  return (
    hasExactKeys(data, rootKeys) &&
    REQUESTED_AUDIENCES.has(data.requestedAudience) &&
    Array.isArray(data.eligibleClaims) &&
    data.eligibleClaims.every(validateEligibleClaimEntry) &&
    Number.isInteger(data.limit) &&
    data.limit >= 1 &&
    data.limit <= 100 &&
    (data.afterClaimId === null ||
      (typeof data.afterClaimId === "string" && CANONICAL_UUID_PATTERN.test(data.afterClaimId))) &&
    typeof data.truncated === "boolean" &&
    (data.nextAfterClaimId === null ||
      (typeof data.nextAfterClaimId === "string" && CANONICAL_UUID_PATTERN.test(data.nextAfterClaimId))) &&
    (data.truncated === false || data.nextAfterClaimId !== null) &&
    validateMetadataSafeValue("requestedAudience", data.requestedAudience) &&
    validateMetadataSafeValue("limit", data.limit) &&
    validateMetadataSafeValue("afterClaimId", data.afterClaimId) &&
    validateMetadataSafeValue("truncated", data.truncated) &&
    validateMetadataSafeValue("nextAfterClaimId", data.nextAfterClaimId)
  );
}

function validateServiceResult(result) {
  if (!isPlainObject(result) || typeof result.ok !== "boolean") return false;
  if (result.ok !== true) {
    return result.data == null && isPlainObject(result.error) && PRESERVED_FAILURE_CODES.has(result.error.code);
  }
  return result.error === null && validateSuccessDto(result.data);
}

function validateEligibleClaimsServiceResult(result) {
  if (!isPlainObject(result) || typeof result.ok !== "boolean") return false;
  if (result.ok !== true) {
    return result.data == null && isPlainObject(result.error) && PRESERVED_FAILURE_CODES.has(result.error.code);
  }
  return result.error === null && validateEligibleClaimsSuccessDto(result.data);
}

function validateGovernedClaimEntry(entry) {
  return (
    hasExactKeys(entry, GOVERNED_CLAIM_KEYS) &&
    Object.entries(entry).every(([key, value]) => {
      if (key === "reviewQueueItems") {
        return validateArrayEntries(value, GOVERNED_CLAIM_REVIEW_QUEUE_ITEM_KEYS);
      }
      return validateMetadataSafeValue(key, value);
    })
  );
}

function validateGovernedClaimsSuccessDto(data) {
  const rootKeys = new Set(["items", "limit", "afterClaimId", "truncated", "nextAfterClaimId"]);
  return (
    hasExactKeys(data, rootKeys) &&
    Array.isArray(data.items) &&
    data.items.every(validateGovernedClaimEntry) &&
    Number.isInteger(data.limit) &&
    data.limit >= 1 &&
    data.limit <= GOVERNED_CLAIMS_MAX_LIMIT &&
    (data.afterClaimId === null ||
      (typeof data.afterClaimId === "string" && CANONICAL_UUID_PATTERN.test(data.afterClaimId))) &&
    typeof data.truncated === "boolean" &&
    (data.nextAfterClaimId === null ||
      (typeof data.nextAfterClaimId === "string" && CANONICAL_UUID_PATTERN.test(data.nextAfterClaimId))) &&
    (data.truncated === false || data.nextAfterClaimId !== null)
  );
}

function validateGovernedClaimsServiceResult(result) {
  if (!isPlainObject(result) || typeof result.ok !== "boolean") return false;
  if (result.ok !== true) {
    return result.data == null && isPlainObject(result.error) && PRESERVED_FAILURE_CODES.has(result.error.code);
  }
  return result.error == null && validateGovernedClaimsSuccessDto(result.data);
}

function validateClientFollowupWorkflowEntry(entry) {
  if (!hasExactKeys(entry, CLIENT_FOLLOWUP_WORKFLOW_KEYS)) return false;
  const expectedQuestionText = CLIENT_FOLLOWUP_QUESTION_BY_DIMENSION[entry.dimension_key];
  if (!expectedQuestionText || entry.question_text !== expectedQuestionText) return false;
  return (
    validateMetadataSafeValue("claim_id", entry.claim_id) &&
    validateMetadataSafeValue("client_followup_item_id", entry.client_followup_item_id) &&
    validateMetadataSafeValue("review_queue_item_id", entry.review_queue_item_id) &&
    validateMetadataSafeValue("queue_status", entry.queue_status) &&
    validateMetadataSafeValue("review_status", entry.review_status) &&
    validateMetadataSafeValue("updated_at", entry.updated_at)
  );
}

function validateClientFollowupWorkflowsSuccessDto(data) {
  return (
    hasExactKeys(data, new Set(["items"])) &&
    Array.isArray(data.items) &&
    data.items.every(validateClientFollowupWorkflowEntry)
  );
}

function validateClientFollowupWorkflowsServiceResult(result) {
  if (!isPlainObject(result) || typeof result.ok !== "boolean") return false;
  if (result.ok !== true) {
    return result.data == null && isPlainObject(result.error) && PRESERVED_FAILURE_CODES.has(result.error.code);
  }
  return result.error == null && validateClientFollowupWorkflowsSuccessDto(result.data);
}

async function importDefaultClaimTraceabilityService() {
  return import("./kaiClaimTraceabilityService.js");
}

async function importDefaultEligibleClaimsForAudienceService() {
  return import("./kaiEligibleClaimsForAudienceService.js");
}

async function importDefaultClaimLibraryService() {
  return import("./kaiClaimLibraryService.js");
}

async function importDefaultClientFollowupReadService() {
  return import("./kaiClientFollowupReadService.js");
}

export async function getClaimTraceabilitySummaryTool(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
  if (!isAssistantToolsEnabled(env)) return buildKaiError("feature_disabled");

  if (!hasExactKeys(input, TOP_LEVEL_KEYS)) return validationBlocker();
  if (!TOOL_NAMES.has(input.toolName)) return validationBlocker();
  if (input.toolName === TRACEABILITY_TOOL_NAME && !validateArgumentsShape(input.arguments)) return validationBlocker();
  if (input.toolName === ELIGIBLE_CLAIMS_TOOL_NAME && !validateEligibleClaimsArgumentsShape(input.arguments)) {
    return validationBlocker();
  }
  if (input.toolName === GOVERNED_CLAIMS_TOOL_NAME && !validateGovernedClaimsArgumentsShape(input.arguments)) {
    return validationBlocker();
  }
  if (input.toolName === CLIENT_FOLLOWUP_TOOL_NAME && !validateClientFollowupArgumentsShape(input.arguments)) {
    return validationBlocker();
  }

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) return buildKaiError("authorization_denied");

  const allowedRolesForOperation =
    input.toolName === CLIENT_FOLLOWUP_TOOL_NAME ? CLIENT_FOLLOWUP_ALLOWED_ROLES : ALLOWED_ROLES;
  const auth = validateActorCanPerformOperation(
    actorContext,
    input.toolName,
    input.arguments.organizationId,
    { allowedRoles: allowedRolesForOperation },
  );
  if (!auth.ok) {
    if (auth.blockers?.some((blocker) => blocker.blocking_reason === "missing_active_organization_membership")) {
      return buildKaiError("tenant_boundary_violation", { blockers: auth.blockers });
    }
    return buildKaiError(auth.error_code || "authorization_denied", { blockers: auth.blockers });
  }

  const assistantResults = [
    validateAssistantToolAuthorization({ operation: input.toolName }),
    validateAssistantCannotApprove({ operation: input.toolName }),
    validateAssistantCannotAccessRawFiles({ operation: input.toolName, payload: input.arguments }),
    validatePromptInjectionQuarantine({ payload: input.arguments }),
  ];
  const assistantBlockers = assistantResults.filter((result) => result.severity === "blocker");
  if (assistantBlockers.length > 0) return validationBlocker(assistantBlockers);

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: input.arguments.organizationId,
    payload: { organization_id: input.arguments.organizationId },
  });
  if (tenant.severity === "blocker") {
    return buildKaiError("tenant_boundary_violation", { blockers: [tenant] });
  }

  if (input.toolName === ELIGIBLE_CLAIMS_TOOL_NAME) {
    const serviceModule = await (
      dependencies.importEligibleClaimsForAudienceService || importDefaultEligibleClaimsForAudienceService
    )();
    if (typeof serviceModule?.listEligibleClaimsForAudience !== "function") return systemError();

    const result = await serviceModule.listEligibleClaimsForAudience(
      {
        organizationId: input.arguments.organizationId,
        requestedAudience: input.arguments.requestedAudience,
        limit: input.arguments.limit,
        afterClaimId: input.arguments.afterClaimId,
        actorContext,
      },
      dependencies.eligibleClaimsForAudienceServiceDependencies || { env },
    );

    if (!validateEligibleClaimsServiceResult(result)) return systemError();
    return result;
  }

  if (input.toolName === GOVERNED_CLAIMS_TOOL_NAME) {
    const serviceModule = await (dependencies.importClaimLibraryService || importDefaultClaimLibraryService)();
    if (typeof serviceModule?.listClaimLibraryCandidates !== "function") return systemError();

    const result = await serviceModule.listClaimLibraryCandidates(
      {
        organizationId: input.arguments.organizationId,
        limit: input.arguments.limit,
        afterClaimId: input.arguments.afterClaimId,
        actorContext,
      },
      dependencies.claimLibraryServiceDependencies || { env },
    );

    if (!validateGovernedClaimsServiceResult(result)) return systemError();
    return result;
  }

  if (input.toolName === CLIENT_FOLLOWUP_TOOL_NAME) {
    const serviceModule = await (
      dependencies.importClientFollowupReadService || importDefaultClientFollowupReadService
    )();
    if (typeof serviceModule?.listClientFollowupWorkflows !== "function") return systemError();

    const result = await serviceModule.listClientFollowupWorkflows(
      {
        organizationId: input.arguments.organizationId,
        actorContext,
      },
      dependencies.clientFollowupReadServiceDependencies || { env },
    );

    if (!validateClientFollowupWorkflowsServiceResult(result)) return systemError();
    return result;
  }

  const serviceModule = await (dependencies.importClaimTraceabilityService || importDefaultClaimTraceabilityService)();
  if (typeof serviceModule?.getClaimTraceabilitySummary !== "function") return systemError();

  const result = await serviceModule.getClaimTraceabilitySummary(
    {
      organizationId: input.arguments.organizationId,
      claimId: input.arguments.claimId,
      requestedAudience: input.arguments.requestedAudience,
      actorContext,
    },
    dependencies.claimTraceabilityServiceDependencies || { env },
  );

  if (!validateServiceResult(result)) return systemError();
  return result;
}

export const __assistantClaimTraceabilityToolContract = Object.freeze({
  TOOL_NAME: TRACEABILITY_TOOL_NAME,
  TOOL_NAMES,
  TOP_LEVEL_KEYS,
  ARGUMENT_KEYS: TRACEABILITY_ARGUMENT_KEYS,
  TRACEABILITY_ARGUMENT_KEYS,
  ELIGIBLE_CLAIMS_ARGUMENT_KEYS,
  GOVERNED_CLAIMS_ARGUMENT_KEYS,
  CLIENT_FOLLOWUP_ARGUMENT_KEYS,
  REQUESTED_AUDIENCES,
  ALLOWED_ROLES,
  CLIENT_FOLLOWUP_ALLOWED_ROLES,
});
