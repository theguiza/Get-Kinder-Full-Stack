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

const TOOL_NAME = "get_claim_traceability_summary";
const TOP_LEVEL_KEYS = new Set(["toolName", "arguments", "actorContext"]);
const ARGUMENT_KEYS = new Set(["organizationId", "claimId", "requestedAudience"]);
const REQUESTED_AUDIENCES = new Set(["internal", "funder", "public"]);
const ALLOWED_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
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
const HASH_PATTERN = /^[0-9a-f]{32,128}$/i;
const SAFE_CODE_PATTERN = /^[a-z][a-z0-9_:-]*$/i;

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
    hasExactKeys(args, ARGUMENT_KEYS) &&
    isNonEmptyString(args.organizationId) &&
    isNonEmptyString(args.claimId) &&
    REQUESTED_AUDIENCES.has(args.requestedAudience)
  );
}

function safeStringForKey(key, value) {
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

function validateDimensions(dimensions) {
  if (!isPlainObject(dimensions)) return false;
  return Object.values(dimensions).every(
    (dimension) =>
      hasExactKeys(dimension, new Set(["assessment_status", "validator_key"])) &&
      typeof dimension.assessment_status === "string" &&
      typeof dimension.validator_key === "string" &&
      validateMetadataSafeValue("assessment_status", dimension.assessment_status) &&
      validateMetadataSafeValue("validator_key", dimension.validator_key),
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
    validateMetadataSafeValue("claim", data.claim) &&
    validateMetadataSafeValue("evidence", data.evidence) &&
    validateMetadataSafeValue("locator", data.locator) &&
    validateMetadataSafeValue("source", data.source) &&
    validateMetadataSafeValue("source_version", data.source_version) &&
    validateMetadataSafeValue("claim_review", data.claim_review) &&
    validateMetadataSafeValue("candidate", data.candidate) &&
    validateMetadataSafeValue("promotion_decision", data.promotion_decision) &&
    validateMetadataSafeValue("gap_items", data.gap_items) &&
    validateMetadataSafeValue("client_followup_workflows", data.client_followup_workflows) &&
    validateMetadataSafeValue("potential_conflict_groups", data.potential_conflict_groups) &&
    validateMetadataSafeValue("requestedAudience", data.requestedAudience) &&
    validateMetadataSafeValue("eligible", data.eligible) &&
    validateMetadataSafeValue("blockerCodes", data.blockerCodes) &&
    validateMetadataSafeValue("affectedDimensionKeys", data.affectedDimensionKeys) &&
    validateMetadataSafeValue("affectedObjectIds", data.affectedObjectIds) &&
    validateMetadataSafeValue("truncated", data.truncated)
  );
}

function validateServiceResult(result) {
  if (!isPlainObject(result) || typeof result.ok !== "boolean") return false;
  if (result.ok !== true) {
    return result.data == null && isPlainObject(result.error) && PRESERVED_FAILURE_CODES.has(result.error.code);
  }
  return result.error === null && validateSuccessDto(result.data);
}

async function importDefaultClaimTraceabilityService() {
  return import("./kaiClaimTraceabilityService.js");
}

export async function getClaimTraceabilitySummaryTool(input, dependencies = {}) {
  const env = dependencies.env || process.env;
  if (!isKaiSprint2Enabled(env)) return buildKaiError("feature_disabled");
  if (!isAssistantToolsEnabled(env)) return buildKaiError("feature_disabled");

  if (!hasExactKeys(input, TOP_LEVEL_KEYS)) return validationBlocker();
  if (input.toolName !== TOOL_NAME) return validationBlocker();
  if (!validateArgumentsShape(input.arguments)) return validationBlocker();

  const { actorContext } = input;
  if (!isMappedHumanActor(actorContext)) return buildKaiError("authorization_denied");

  const auth = validateActorCanPerformOperation(
    actorContext,
    TOOL_NAME,
    input.arguments.organizationId,
    { allowedRoles: ALLOWED_ROLES },
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
  TOOL_NAME,
  TOP_LEVEL_KEYS,
  ARGUMENT_KEYS,
  REQUESTED_AUDIENCES,
  ALLOWED_ROLES,
});
