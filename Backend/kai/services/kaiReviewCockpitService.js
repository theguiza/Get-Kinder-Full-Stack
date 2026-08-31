import {
  isKaiSprint2Enabled,
} from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError, validationBlocked } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  getReviewCockpitFileProfileRecord as readFileProfileRecord,
  getReviewCockpitSensitivityProfileRecord as readSensitivityProfileRecord,
  getReviewCockpitSourceCandidateRecord as readSourceCandidateRecord,
  listReviewCockpitQueueItems as readReviewCockpitQueueItems,
} from "../db/kaiReviewCockpitReadModels.js";
import {
  REVIEW_COCKPIT_QUEUE_STATUSES,
  REVIEW_COCKPIT_QUEUE_TYPES,
  encodeReviewCockpitQueueCursor,
  validateReviewCockpitQueueSelection,
  validateSourceCandidateDecisionRequest,
} from "../validators/kaiReviewCockpitRequestSchemas.js";
import { validateSensitivityProfileDecisionRequest } from "../validators/kaiSprint2RequestSchemas.js";
import { createSourcePromotionDecision } from "./kaiSourcePromotionService.js";
import { __sourcePromotionRepositoryContract } from "../dictionary/postgresSourcePromotionRepository.js";
import { recordSensitivityAllowedUseDecision } from "./kaiSensitivityAllowedUseReviewService.js";
import {
  SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES,
  SENSITIVITY_PRESENCE_DECISION_FIELDS,
  SENSITIVITY_PERMISSION_DECISION_FIELDS,
  SENSITIVITY_ALLOWED_USE_DECISION_FIELD,
  sensitivityAuthorityFromCurrentDecision,
} from "../dictionary/sensitivityAllowedUseDecisionContract.js";
import {
  createProductionMetadataOnlyAuditForSensitivityAllowedUseDecision,
  createProductionMetadataOnlyAuditForSourcePromotion,
} from "./kaiMetadataOnlyAuditComposition.js";

/**
 * KAI P1-09 internal review cockpit service.
 *
 * Internal-GK-only, read-mostly review surface over already-committed P1-01 through
 * P1-08 objects, plus one thin marshaling seam onto P1-08's own
 * createSourcePromotionDecision. This module:
 *
 * - contains no SQL and imports no database pool: every read is delegated to the
 *   P1-09 read models, and the one write path is delegated wholly to P1-08's
 *   accepted service (no decision, transition, replay, or idempotency logic is
 *   reimplemented, retried, or coerced here);
 * - implements no file-profile mutation of any kind - file-profile review is
 *   strictly read-only in this package, and no approval/rejection/resolution/
 *   eligibility state is invented for it anywhere;
 * - never couples reading or filtering the review queue to a promotion call: the
 *   queue list and both detail reads invoke no decision service, and the only call
 *   site of createSourcePromotionDecision is the explicit decision endpoint below;
 * - hand-builds every response object field by field with independent
 *   re-validation, so no raw database row, storage location, object key, signed
 *   URL, credential, prompt, internal note, raw sample, or unrestricted audit
 *   metadata can ever reach a response.
 *
 * P1-08's repository requires an injected metadata-only audit dependency. A
 * caller-supplied `dependencies.metadataOnlyAudit` (test double) is always
 * forwarded unchanged; on the real/default runtime path this seam composes the
 * approved production provider itself
 * (`createProductionMetadataOnlyAuditForSourcePromotion`, the same
 * `insertRequiredSuccessfulAuditEvent`-backed mechanism every other P1/P2/P3
 * mutation route composes), bound to this request's own
 * organizationId/intakeSourceCandidateId. If a provider cannot be composed (or
 * a caller-supplied double is missing/invalid), P1-08's own fail-closed
 * validator returns a clean validation_blocker rather than any partial write.
 */

const REVIEW_COCKPIT_READ_ROLES = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const REVIEW_COCKPIT_READ_OPERATION = "read_intake";

const UUID_RE = KAI_SPRINT2_P0_PATTERNS.uuid;
const CANONICAL_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MACHINE_TOKEN_RE = /^[a-z0-9_]{1,64}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const DISALLOWED_TEXT_CONTROLS_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;
const BIDI_FORMATTING_CONTROLS_RE = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/**
 * Re-applies, in the response layer, the exact unsafe-text exclusions the P1-04
 * `data_quality_findings_p1_04_detail_safe_check` CHECK already enforces at write
 * time, so a finding detail is never emitted on the strength of the stored
 * constraint alone.
 */
const UNSAFE_DETAIL_RE =
  /(https?:\/\/|\/Users\/|\/private\/|\/var\/|\/etc\/|password|secret|api[_-]?key|token|credential|Bearer\s|stack ?trace|traceback|\s{2}at [A-Za-z])/i;

const REVIEW_COCKPIT_QUEUE_TYPE_SET = new Set(REVIEW_COCKPIT_QUEUE_TYPES);
const REVIEW_COCKPIT_QUEUE_STATUS_SET = new Set(REVIEW_COCKPIT_QUEUE_STATUSES);
const REVIEW_COCKPIT_TARGET_OBJECT_TYPES = new Set([
  "intake_file",
  "intake_sensitivity_profile",
  "intake_source_candidate",
]);
const THREE_STATE_PRESENCE = new Set(["unknown", "present", "absent"]);
const ALLOWED_USE_STATUSES = new Set(["unknown", "allowed", "not_allowed"]);
const SENSITIVITY_PRESENCE_DIMENSIONS = Object.freeze([
  "pii_status",
  "minor_data_status",
  "health_housing_justice_immigration_status",
  "indigenous_governance_status",
  "staff_notes_status",
  "story_testimonial_status",
  "small_cell_risk_status",
  "financial_records_status",
  "consent_basis_status",
]);
const SENSITIVITY_RESTRICTION_FLAGS = Object.freeze([
  "llm_processing_allowed",
  "product_learning_allowed",
  "public_use_allowed",
  "funder_use_allowed",
  "human_review_required",
]);
const SENSITIVITY_DECISION_OUTCOME_SET = new Set(SENSITIVITY_ALLOWED_USE_DECISION_OUTCOMES);
const SENSITIVITY_DECISION_ROLE_SET = new Set(["gk_admin", "gk_operator", "gk_reviewer"]);
const DECISION_STATUS_SET = new Set(__sourcePromotionRepositoryContract.ALLOWED_DECISION_OUTCOMES);
const CANDIDATE_STATUS_SET = new Set([
  __sourcePromotionRepositoryContract.CANDIDATE_STATUS_NEEDS_REVIEW,
  __sourcePromotionRepositoryContract.CANDIDATE_STATUS_PROMOTED,
  __sourcePromotionRepositoryContract.CANDIDATE_STATUS_REJECTED,
]);
const REVIEWED_SOURCE_TYPE_SET = new Set(__sourcePromotionRepositoryContract.ALLOWED_REVIEWED_SOURCE_TYPES);

let injectedDependencies = null;

function resolvedDependencies(dependencies) {
  return injectedDependencies ? { ...injectedDependencies, ...dependencies } : dependencies;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalUuid(value) {
  return typeof value === "string" && value === value.toLowerCase() && UUID_RE.test(value);
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

function boundedText(value, maximumCodePoints, { nullable = true } = {}) {
  if (value === null) return nullable ? { ok: true, value: null } : { ok: false };
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

function actorError(actorResult) {
  if (actorResult.error_code === "mapped_kai_user_required") return buildKaiError("mapped_kai_user_required");
  return buildKaiError("unauthorized");
}

/**
 * The single, shared authorization sequence for every P1-09 endpoint: feature gate
 * -> explicit tenant identifier shape -> mapped actor resolution -> mapped-human-only
 * gate -> active-membership-plus-global-GK-role operation authorization -> explicit
 * tenant-boundary consistency. No assistant/AI actor and no inactive membership can
 * reach any read or write below it. The role check requires an active organization
 * membership for the requested organization (validated inside
 * validateActorCanPerformOperation) AND a global gk_admin/gk_operator/gk_reviewer
 * capability role (globalRolesOnly): an org-scoped role_name is tenant scope only
 * and never substitutes for the required global capability.
 */
async function authorizeReviewCockpitRequest(input, dependencies) {
  if (!isKaiSprint2Enabled(dependencies.env || process.env)) {
    return { ok: false, error: buildKaiError("feature_disabled") };
  }

  const organizationId = String(input.organizationId || "").trim().toLowerCase();
  if (!UUID_RE.test(organizationId)) return { ok: false, error: buildKaiError("invalid_request") };

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, dependencies);
  if (!actorResult.ok) return { ok: false, error: actorError(actorResult) };

  const actorContext = actorResult.actorContext;
  if (actorContext.actorType !== "human") {
    return { ok: false, error: buildKaiError("authorization_denied") };
  }

  const roleAuth = validateActorCanPerformOperation(
    actorContext,
    REVIEW_COCKPIT_READ_OPERATION,
    organizationId,
    { allowedRoles: REVIEW_COCKPIT_READ_ROLES, globalRolesOnly: true },
  );
  if (!roleAuth.ok) {
    return { ok: false, error: buildKaiError(roleAuth.error_code, { blockers: roleAuth.blockers }) };
  }

  const tenant = validateTenantBoundaryConsistency({
    expectedOrganizationId: organizationId,
    payload: { organization_id: organizationId },
  });
  if (tenant.severity === "blocker") {
    return { ok: false, error: buildKaiError("tenant_boundary_violation", { blockers: [tenant] }) };
  }

  return { ok: true, organizationId, actorContext };
}

/**
 * KAI B1A-3B: a safe, read-only "can I" probe for the Impact Library product
 * page (and any other authenticated product surface) to decide
 * whether to fetch/show actionable Phase-5 sensitivity-review controls,
 * without duplicating the role list in the browser and without the browser
 * ever attempting the GK-only sensitivity-profile routes just to read a 403.
 *
 * This intentionally does NOT reuse authorizeReviewCockpitRequest's combined
 * authentication+authorization result as-is: that function collapses "not
 * authenticated" and "authenticated but not authorized" into the same
 * ok:false shape, which is correct for a route that should refuse to serve
 * data either way. Here the two must be told apart - a genuinely
 * unauthenticated request (no session-resolvable actor at all) still gets the
 * existing authentication failure unchanged; only "authenticated but not
 * mapped / not the right role" is turned into a plain false. No DB read
 * beyond actor resolution happens, and no queue/profile/decision data is
 * touched.
 */
export async function getReviewCockpitCapabilities(input = {}, dependencies = {}) {
  const deps = resolvedDependencies(dependencies);
  if (!isKaiSprint2Enabled(deps.env || process.env)) {
    return buildKaiError("feature_disabled");
  }

  const organizationId = String(input.organizationId || "").trim().toLowerCase();
  if (!UUID_RE.test(organizationId)) return buildKaiError("invalid_request");

  const actorResult = input.actorContext
    ? { ok: true, actorContext: input.actorContext }
    : await resolveKaiActorContext(input.req, deps);

  if (!actorResult.ok && actorResult.error_code !== "mapped_kai_user_required") {
    return buildKaiError("unauthorized");
  }
  if (!actorResult.ok) {
    return { ok: true, data: { can_manage_sensitivity_review: false } };
  }

  const actorContext = actorResult.actorContext;
  if (actorContext.actorType !== "human") {
    return { ok: true, data: { can_manage_sensitivity_review: false } };
  }

  const roleAuth = validateActorCanPerformOperation(
    actorContext,
    REVIEW_COCKPIT_READ_OPERATION,
    organizationId,
    { allowedRoles: REVIEW_COCKPIT_READ_ROLES, globalRolesOnly: true },
  );

  return { ok: true, data: { can_manage_sensitivity_review: roleAuth.ok === true } };
}

function responseReviewCockpitQueueItem(row, organizationId) {
  if (!isPlainObject(row)) return null;
  if (
    !canonicalUuid(row.review_queue_item_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !REVIEW_COCKPIT_QUEUE_TYPE_SET.has(row.queue_type)
    || !REVIEW_COCKPIT_TARGET_OBJECT_TYPES.has(row.target_object_type)
    || !canonicalUuid(row.target_object_id)
    || !REVIEW_COCKPIT_QUEUE_STATUS_SET.has(row.queue_status)
    || typeof row.priority !== "string"
    || !MACHINE_TOKEN_RE.test(row.priority)
  ) {
    return null;
  }

  const dueAt = canonicalTimestamp(row.due_at, { nullable: true });
  const createdAt = canonicalTimestamp(row.created_at);
  const updatedAt = canonicalTimestamp(row.updated_at);
  const summary = boundedText(row.summary, 200);
  const requiredAction = boundedText(row.required_action, 1000);
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

function responseFileProfile(row, organizationId) {
  if (!isPlainObject(row)) return null;
  const createdAt = canonicalTimestamp(row.created_at);
  if (
    !canonicalUuid(row.file_profile_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.intake_file_id)
    || typeof row.parser_name !== "string"
    || !MACHINE_TOKEN_RE.test(row.parser_name)
    || typeof row.parser_version !== "string"
    || !/^[a-z0-9._-]{1,64}$/.test(row.parser_version)
    || typeof row.checksum !== "string"
    || !SHA256_HEX_RE.test(row.checksum)
    || typeof row.profile_canonical_sha256 !== "string"
    || !SHA256_HEX_RE.test(row.profile_canonical_sha256)
    || createdAt === undefined
  ) {
    return null;
  }
  return {
    file_profile_id: row.file_profile_id,
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    parser_name: row.parser_name,
    parser_version: row.parser_version,
    checksum: row.checksum,
    profile_canonical_sha256: row.profile_canonical_sha256,
    created_at: createdAt,
  };
}

function responseDataDictionarySummary(row, organizationId) {
  if (row === null) return null;
  if (!isPlainObject(row)) return undefined;
  const createdAt = canonicalTimestamp(row.created_at);
  if (
    !canonicalUuid(row.data_dictionary_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.intake_file_id)
    || !canonicalUuid(row.file_profile_id)
    || typeof row.dictionary_status !== "string"
    || !MACHINE_TOKEN_RE.test(row.dictionary_status)
    || typeof row.profile_canonical_sha256 !== "string"
    || !SHA256_HEX_RE.test(row.profile_canonical_sha256)
    || !Number.isSafeInteger(row.field_count)
    || row.field_count < 0
    || createdAt === undefined
  ) {
    return undefined;
  }
  return {
    data_dictionary_id: row.data_dictionary_id,
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    file_profile_id: row.file_profile_id,
    dictionary_status: row.dictionary_status,
    profile_canonical_sha256: row.profile_canonical_sha256,
    field_count: row.field_count,
    created_at: createdAt,
  };
}

function responseQualityFinding(row, organizationId) {
  if (!isPlainObject(row)) return null;
  const createdAt = canonicalTimestamp(row.created_at);
  const detail = boundedText(row.finding_detail_safe, 500, { nullable: false });
  if (
    !canonicalUuid(row.data_quality_finding_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.data_dictionary_id)
    || typeof row.profile_field_key !== "string"
    || !/^[a-z0-9_]{1,128}$/.test(row.profile_field_key)
    || typeof row.finding_type !== "string"
    || !MACHINE_TOKEN_RE.test(row.finding_type)
    || typeof row.finding_status !== "string"
    || !MACHINE_TOKEN_RE.test(row.finding_status)
    || !detail.ok
    || UNSAFE_DETAIL_RE.test(detail.value)
    || createdAt === undefined
  ) {
    return null;
  }
  return {
    data_quality_finding_id: row.data_quality_finding_id,
    data_dictionary_id: row.data_dictionary_id,
    profile_field_key: row.profile_field_key,
    finding_type: row.finding_type,
    finding_status: row.finding_status,
    finding_detail_safe: detail.value,
    created_at: createdAt,
  };
}

function responseSensitivityPosture(row, organizationId) {
  if (row === null) return null;
  if (!isPlainObject(row)) return undefined;
  const createdAt = canonicalTimestamp(row.created_at);
  if (
    !canonicalUuid(row.intake_sensitivity_profile_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.intake_file_id)
    || !canonicalUuid(row.file_profile_id)
    || !canonicalUuid(row.data_dictionary_id)
    || typeof row.profile_canonical_sha256 !== "string"
    || !SHA256_HEX_RE.test(row.profile_canonical_sha256)
    || !SENSITIVITY_PRESENCE_DIMENSIONS.every((dimension) => THREE_STATE_PRESENCE.has(row[dimension]))
    || !ALLOWED_USE_STATUSES.has(row.allowed_use_status)
    || createdAt === undefined
  ) {
    return undefined;
  }
  const posture = {
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    file_profile_id: row.file_profile_id,
    data_dictionary_id: row.data_dictionary_id,
    profile_canonical_sha256: row.profile_canonical_sha256,
    allowed_use_status: row.allowed_use_status,
    created_at: createdAt,
  };
  for (const dimension of SENSITIVITY_PRESENCE_DIMENSIONS) {
    posture[dimension] = row[dimension];
  }
  return posture;
}

function responseAllowedUseRestrictions(row) {
  if (row === null) return null;
  if (!isPlainObject(row)) return undefined;
  if (
    !SENSITIVITY_RESTRICTION_FLAGS.every((flag) => typeof row[flag] === "boolean")
    || typeof row.retention_posture !== "string"
    || !MACHINE_TOKEN_RE.test(row.retention_posture)
  ) {
    return undefined;
  }
  const restrictions = { retention_posture: row.retention_posture };
  for (const flag of SENSITIVITY_RESTRICTION_FLAGS) {
    restrictions[flag] = row[flag];
  }
  return restrictions;
}

/**
 * KAI B1A-2: the narrow queue projection carried alongside a sensitivity-profile
 * detail. Identical to responseQueueState but additionally emits `updated_at`,
 * which the cockpit needs as the optimistic-concurrency stamp when submitting a
 * Phase-5 decision. It still never emits queue_metadata, assigned_to,
 * blocked_reason, priority, summary, or required_action.
 */
function responseSensitivityQueueState(row, organizationId) {
  if (row === null) return null;
  const base = responseQueueState(row, organizationId);
  if (base === undefined || base === null) return base;
  const updatedAt = canonicalTimestamp(row.updated_at);
  if (updatedAt === undefined) return undefined;
  if (base.queue_type !== "sensitivity_review" || base.target_object_type !== "intake_sensitivity_profile") {
    return undefined;
  }
  return { ...base, updated_at: updatedAt };
}

/**
 * KAI B1A-2: the current Phase-5 decision projection. Only ever built from the
 * decision-lineage head (the row with no successor) that the read model returns;
 * a superseded decision is never passed in, and nothing here is ever manufactured
 * from queue state, role possession, or the machine-written P1-05 profile row.
 *
 * `authority` is the contract module's own fail-closed projection: no head means
 * nothing permitted, a needs_more_information head means nothing permitted, and a
 * terminal reviewed head permits exactly and only what the row stores as true.
 */
function responseSensitivityDecision(row, organizationId, intakeSensitivityProfileId) {
  if (row === null) return null;
  if (!isPlainObject(row)) return undefined;
  const createdAt = canonicalTimestamp(row.created_at);
  const supersedesDecisionId = row.supersedes_decision_id ?? null;
  if (
    !canonicalUuid(row.decision_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.intake_sensitivity_profile_id)
    || row.intake_sensitivity_profile_id !== intakeSensitivityProfileId
    || !canonicalUuid(row.review_queue_item_id)
    || !SENSITIVITY_DECISION_OUTCOME_SET.has(row.decision_outcome)
    || !canonicalUuid(row.decided_by)
    || !SENSITIVITY_DECISION_ROLE_SET.has(row.decided_by_role)
    || row.created_by_type !== "human"
    || (supersedesDecisionId !== null && !canonicalUuid(supersedesDecisionId))
    || createdAt === undefined
  ) {
    return undefined;
  }

  const isReviewed = row.decision_outcome === "reviewed";
  const decision = {
    decision_id: row.decision_id,
    organization_id: row.organization_id,
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    review_queue_item_id: row.review_queue_item_id,
    decision_outcome: row.decision_outcome,
    decided_by: row.decided_by,
    decided_by_role: row.decided_by_role,
    created_by_type: row.created_by_type,
    supersedes_decision_id: supersedesDecisionId,
    created_at: createdAt,
  };

  for (const field of SENSITIVITY_PRESENCE_DECISION_FIELDS) {
    const value = row[field] ?? null;
    if (isReviewed ? !THREE_STATE_PRESENCE.has(value) : value !== null) return undefined;
    decision[field] = value;
  }
  const allowedUse = row[SENSITIVITY_ALLOWED_USE_DECISION_FIELD] ?? null;
  if (isReviewed ? !ALLOWED_USE_STATUSES.has(allowedUse) : allowedUse !== null) return undefined;
  decision[SENSITIVITY_ALLOWED_USE_DECISION_FIELD] = allowedUse;
  for (const field of SENSITIVITY_PERMISSION_DECISION_FIELDS) {
    const value = row[field] ?? null;
    if (isReviewed ? typeof value !== "boolean" : value !== null) return undefined;
    decision[field] = value;
  }

  decision.authority = sensitivityAuthorityFromCurrentDecision(row);
  return decision;
}

function responseSourceCandidate(row, organizationId) {
  if (!isPlainObject(row)) return null;
  const createdAt = canonicalTimestamp(row.created_at);
  if (
    !canonicalUuid(row.intake_source_candidate_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.intake_file_id)
    || !canonicalUuid(row.file_profile_id)
    || !canonicalUuid(row.data_dictionary_id)
    || !canonicalUuid(row.intake_sensitivity_profile_id)
    || typeof row.profile_canonical_sha256 !== "string"
    || !SHA256_HEX_RE.test(row.profile_canonical_sha256)
    || typeof row.proposed_source_type !== "string"
    || !MACHINE_TOKEN_RE.test(row.proposed_source_type)
    || !CANDIDATE_STATUS_SET.has(row.candidate_status)
    || createdAt === undefined
  ) {
    return null;
  }
  return {
    intake_source_candidate_id: row.intake_source_candidate_id,
    organization_id: row.organization_id,
    intake_file_id: row.intake_file_id,
    file_profile_id: row.file_profile_id,
    data_dictionary_id: row.data_dictionary_id,
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    profile_canonical_sha256: row.profile_canonical_sha256,
    proposed_source_type: row.proposed_source_type,
    candidate_status: row.candidate_status,
    created_at: createdAt,
  };
}

/**
 * The narrow queue-state projection carried alongside a source-candidate detail or
 * decision result. Deliberately narrower than the queue-list DTO: it never emits
 * queue_metadata, assigned_to, blocked_reason, or any other queue column.
 */
function responseQueueState(row, organizationId) {
  if (row === null) return null;
  if (!isPlainObject(row)) return undefined;
  if (
    !canonicalUuid(row.review_queue_item_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !REVIEW_COCKPIT_QUEUE_TYPE_SET.has(row.queue_type)
    || !REVIEW_COCKPIT_TARGET_OBJECT_TYPES.has(row.target_object_type)
    || !canonicalUuid(row.target_object_id)
    || !REVIEW_COCKPIT_QUEUE_STATUS_SET.has(row.queue_status)
  ) {
    return undefined;
  }
  const reviewStatus = row.review_status ?? null;
  if (reviewStatus !== null && (typeof reviewStatus !== "string" || !MACHINE_TOKEN_RE.test(reviewStatus))) {
    return undefined;
  }
  return {
    review_queue_item_id: row.review_queue_item_id,
    organization_id: row.organization_id,
    queue_type: row.queue_type,
    target_object_type: row.target_object_type,
    target_object_id: row.target_object_id,
    queue_status: row.queue_status,
    review_status: reviewStatus,
  };
}

function responsePromotionDecision(row, organizationId) {
  if (row === null) return null;
  if (!isPlainObject(row)) return undefined;
  const createdAt = canonicalTimestamp(row.created_at);
  const decidedAt = canonicalTimestamp(row.decided_at, { nullable: true });
  const promotedAt = canonicalTimestamp(row.promoted_at, { nullable: true });
  const reviewedSourceType = row.reviewed_source_type ?? null;
  const sourceId = row.source_id ?? null;
  const sourceVersionId = row.source_version_id ?? null;
  if (
    !canonicalUuid(row.intake_promotion_decision_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.intake_source_candidate_id)
    || !canonicalUuid(row.review_queue_item_id)
    || !DECISION_STATUS_SET.has(row.decision_status)
    || (reviewedSourceType !== null && !REVIEWED_SOURCE_TYPE_SET.has(reviewedSourceType))
    || (sourceId !== null && !canonicalUuid(sourceId))
    || (sourceVersionId !== null && !canonicalUuid(sourceVersionId))
    || createdAt === undefined
    || decidedAt === undefined
    || promotedAt === undefined
  ) {
    return undefined;
  }
  return {
    intake_promotion_decision_id: row.intake_promotion_decision_id,
    organization_id: row.organization_id,
    intake_source_candidate_id: row.intake_source_candidate_id,
    review_queue_item_id: row.review_queue_item_id,
    reviewed_source_type: reviewedSourceType,
    decision_status: row.decision_status,
    source_id: sourceId,
    source_version_id: sourceVersionId,
    created_at: createdAt,
    decided_at: decidedAt,
    promoted_at: promotedAt,
  };
}

function responseSource(row, organizationId) {
  if (row === null) return null;
  if (!isPlainObject(row)) return undefined;
  const createdAt = canonicalTimestamp(row.created_at);
  if (
    !canonicalUuid(row.source_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || typeof row.source_code !== "string"
    || !SHA256_HEX_RE.test(row.source_code)
    || !REVIEWED_SOURCE_TYPE_SET.has(row.reviewed_source_type)
    || createdAt === undefined
  ) {
    return undefined;
  }
  return {
    source_id: row.source_id,
    organization_id: row.organization_id,
    source_code: row.source_code,
    reviewed_source_type: row.reviewed_source_type,
    created_at: createdAt,
  };
}

function responseSourceVersion(row, organizationId) {
  if (row === null) return null;
  if (!isPlainObject(row)) return undefined;
  const createdAt = canonicalTimestamp(row.created_at);
  if (
    !canonicalUuid(row.source_version_id)
    || !canonicalUuid(row.organization_id)
    || row.organization_id !== organizationId
    || !canonicalUuid(row.source_id)
    || !canonicalUuid(row.intake_source_candidate_id)
    || !canonicalUuid(row.intake_sensitivity_profile_id)
    || typeof row.profile_canonical_sha256 !== "string"
    || !SHA256_HEX_RE.test(row.profile_canonical_sha256)
    || typeof row.is_current !== "boolean"
    || createdAt === undefined
  ) {
    return undefined;
  }
  return {
    source_version_id: row.source_version_id,
    organization_id: row.organization_id,
    source_id: row.source_id,
    intake_source_candidate_id: row.intake_source_candidate_id,
    intake_sensitivity_profile_id: row.intake_sensitivity_profile_id,
    profile_canonical_sha256: row.profile_canonical_sha256,
    is_current: row.is_current,
    created_at: createdAt,
  };
}

/**
 * Bounded, deterministically ordered, tenant-scoped review-queue list for the
 * internal cockpit. Ordering is `created_at DESC, review_queue_item_id DESC`, whose
 * tie-breaker column (review_queue_item_id) is the table's unique primary key, so
 * the ordering is total and page boundaries can never repeat or skip a row.
 *
 * Reading or filtering this queue performs no mutation and invokes no decision
 * service: queue state is displayed, never acted on, by this endpoint.
 */
export async function listReviewCockpitQueue(input = {}, dependencies = {}) {
  const deps = resolvedDependencies(dependencies);
  const authorization = await authorizeReviewCockpitRequest(input, deps);
  if (!authorization.ok) return authorization.error;
  const { organizationId } = authorization;

  const selectionResult = validateReviewCockpitQueueSelection(input.selection);
  if (!selectionResult.ok) return buildKaiError("invalid_request");
  const { limit, cursor, queueTypes, queueStatuses } = selectionResult.selection;

  const readQueue = deps.listReviewCockpitQueueItems || readReviewCockpitQueueItems;
  const rows = await readQueue(organizationId, { limit, cursor, queueTypes, queueStatuses });
  if (!Array.isArray(rows) || rows.length > limit + 1) return buildKaiError("system_error");

  const validatedRows = [];
  for (const row of rows) {
    const item = responseReviewCockpitQueueItem(row, organizationId);
    if (!item) return buildKaiError("system_error");
    validatedRows.push(item);
  }

  const hasNextPage = validatedRows.length > limit;
  const items = validatedRows.slice(0, limit);
  const finalItem = items.at(-1);

  return {
    ok: true,
    data: {
      items,
      filters: { queue_types: queueTypes, queue_statuses: queueStatuses },
      pagination: {
        limit,
        next_cursor: hasNextPage
          ? encodeReviewCockpitQueueCursor({
            created_at: finalItem.created_at,
            review_queue_item_id: finalItem.review_queue_item_id,
          })
          : null,
      },
    },
    warnings: [],
  };
}

/**
 * Read-only file-profile review detail. This package exposes no mutation path for a
 * file profile, its dictionary, its quality findings, or its sensitivity posture:
 * there is no corresponding write service, and no approval, rejection, resolution,
 * or eligibility state is invented for any of them.
 */
export async function getReviewCockpitFileProfileDetail(input = {}, dependencies = {}) {
  const deps = resolvedDependencies(dependencies);
  const authorization = await authorizeReviewCockpitRequest(input, deps);
  if (!authorization.ok) return authorization.error;
  const { organizationId } = authorization;

  const fileProfileId = typeof input.fileProfileId === "string" ? input.fileProfileId : "";
  if (!canonicalUuid(fileProfileId)) return buildKaiError("invalid_request");

  const readRecord = deps.getReviewCockpitFileProfileRecord || readFileProfileRecord;
  const record = await readRecord(organizationId, fileProfileId);
  if (!record) return buildKaiError("not_found");
  if (!isPlainObject(record)) return buildKaiError("system_error");

  const detail = composeReviewCockpitFileProfileDetail(record, organizationId);
  if (!detail.ok) return detail;
  if (detail.data.file_profile.file_profile_id !== fileProfileId) return buildKaiError("system_error");
  return detail;
}

export async function getReviewCockpitSensitivityProfileDetail(input = {}, dependencies = {}) {
  const deps = resolvedDependencies(dependencies);
  const authorization = await authorizeReviewCockpitRequest(input, deps);
  if (!authorization.ok) return authorization.error;
  const { organizationId } = authorization;

  const intakeSensitivityProfileId = typeof input.intakeSensitivityProfileId === "string"
    ? input.intakeSensitivityProfileId
    : "";
  if (!canonicalUuid(intakeSensitivityProfileId)) return buildKaiError("invalid_request");

  const readRecord = deps.getReviewCockpitSensitivityProfileRecord || readSensitivityProfileRecord;
  const record = await readRecord(organizationId, intakeSensitivityProfileId);
  if (!record) return buildKaiError("not_found");
  if (!isPlainObject(record)) return buildKaiError("system_error");

  const detail = composeReviewCockpitFileProfileDetail(record, organizationId);
  if (!detail.ok) return detail;
  if (detail.data.sensitivity_posture?.intake_sensitivity_profile_id !== intakeSensitivityProfileId) {
    return buildKaiError("system_error");
  }

  // KAI B1A-2: the durable readback of the Phase-5 human authority record. This is
  // the CURRENT decision-lineage head only (the row with no successor) - never a
  // superseded decision, and never manufactured from queue state. `null` means no
  // decision has ever been recorded, which the fail-closed authority projection
  // treats as nothing permitted. `read_only` remains true for the profile itself:
  // this endpoint still writes nothing, and the P1-05 profile row is still never
  // mutated by any path in this package.
  // The Phase-5 decision head travels on the same read-model record the posture
  // came from (getReviewCockpitSensitivityProfileRecord), so there is exactly one
  // tenant-scoped read per detail request and exactly one injection seam. A record
  // that carries no decision field at all is read as "no decision recorded", which
  // the fail-closed authority projection treats as nothing permitted - it is never
  // read as an implicit approval.
  if (record.sensitivityDecisionLineageAmbiguous === true) return buildKaiError("system_error");
  const currentDecision = responseSensitivityDecision(
    record.sensitivityDecision ?? null,
    organizationId,
    intakeSensitivityProfileId,
  );
  const sensitivityReviewQueueItem = responseSensitivityQueueState(
    record.sensitivityReviewQueueItem ?? null,
    organizationId,
  );
  if (currentDecision === undefined || sensitivityReviewQueueItem === undefined) {
    return buildKaiError("system_error");
  }

  return {
    ...detail,
    data: {
      ...detail.data,
      sensitivity_review_queue_item: sensitivityReviewQueueItem,
      current_decision: currentDecision,
      decision_controls_enabled: isKaiSprint2Enabled(deps.env || process.env),
    },
  };
}

/**
 * The KAI B1A-2 Phase-5 decision seam: validate the request DTO, then hand the
 * decision to the accepted kaiSensitivityAllowedUseReviewService and marshal its
 * result.
 *
 * This function implements no decision, transition, terminal-state, replay, or
 * idempotency logic of its own - exactly like submitSourceCandidateDecision below.
 * A conflict_current_state_changed result is returned to the caller as produced:
 * never retried, never re-requested with a different outcome, and never coerced
 * into any other result. It writes nothing itself, creates no queue item, and
 * touches no P1-05 column and no downstream approval, generation, or
 * external-release authority of any kind (see
 * Backend/kai/dictionary/postgresSensitivityAllowedUseReviewRepository.js for the
 * exhaustive list of what the write path is forbidden from touching).
 */
export async function submitSensitivityProfileDecision(input = {}, dependencies = {}) {
  const deps = resolvedDependencies(dependencies);
  const env = deps.env || process.env;

  if (!isKaiSprint2Enabled(env)) {
    return buildKaiError("feature_disabled");
  }

  const authorization = await authorizeReviewCockpitRequest(input, deps);
  if (!authorization.ok) return authorization.error;
  const { organizationId, actorContext } = authorization;

  const intakeSensitivityProfileId = typeof input.intakeSensitivityProfileId === "string"
    ? input.intakeSensitivityProfileId
    : "";
  if (!canonicalUuid(intakeSensitivityProfileId)) return buildKaiError("invalid_request");

  const bodyValidation = validateSensitivityProfileDecisionRequest(input.payload);
  if (!bodyValidation.ok) return validationBlocked(bodyValidation.blockers);

  const now = (deps.now ? new Date(deps.now()) : new Date()).toISOString();

  const metadataOnlyAudit = deps.metadataOnlyAudit
    || createProductionMetadataOnlyAuditForSensitivityAllowedUseDecision({
      organizationId,
      intakeSensitivityProfileId,
      actorContext,
      now,
    });

  // Named distinctly from submitSourceCandidateDecision's own `decide` seam so the
  // P1-08 promotion service remains resolved and invoked exactly once in this
  // module, in that function only.
  const recordDecision = deps.recordSensitivityAllowedUseDecision || recordSensitivityAllowedUseDecision;
  const result = await recordDecision(
    {
      organizationId,
      intakeSensitivityProfileId,
      reviewQueueItemId: input.payload.review_queue_item_id,
      expectedUpdatedAt: input.payload.expected_updated_at,
      decision: input.payload.decision,
      ...(input.payload.decision === "reviewed" ? { reviewedSnapshot: input.payload.reviewed_snapshot } : {}),
      actorContext,
      now,
    },
    {
      env,
      ...(deps.sensitivityAllowedUseReviewRepository
        ? { sensitivityAllowedUseReviewRepository: deps.sensitivityAllowedUseReviewRepository }
        : {}),
      metadataOnlyAudit,
    },
  );

  if (!result?.ok) {
    return buildKaiError(result?.error?.code || "system_error", {
      ...(result?.data ? { data: result.data } : {}),
    });
  }

  const data = isPlainObject(result.data) ? result.data : null;
  if (!data) return buildKaiError("system_error");

  const currentDecision = responseSensitivityDecision(
    data.decision ?? null,
    organizationId,
    intakeSensitivityProfileId,
  );
  const reviewQueueItem = responseSensitivityQueueState(data.reviewQueueItem ?? null, organizationId);
  if (
    !currentDecision
    || reviewQueueItem === undefined
    || reviewQueueItem === null
    || typeof data.replayed !== "boolean"
  ) {
    return buildKaiError("system_error");
  }

  return {
    ok: true,
    data: {
      current_decision: currentDecision,
      sensitivity_review_queue_item: reviewQueueItem,
      replayed: data.replayed,
    },
    warnings: [],
  };
}

function composeReviewCockpitFileProfileDetail(record, organizationId) {
  const fileProfile = responseFileProfile(record.fileProfile, organizationId);
  if (!fileProfile) {
    return buildKaiError("system_error");
  }

  const dataDictionary = responseDataDictionarySummary(record.dataDictionary ?? null, organizationId);
  if (dataDictionary === undefined) return buildKaiError("system_error");

  const findingRows = Array.isArray(record.qualityFindings) ? record.qualityFindings : null;
  if (!findingRows) return buildKaiError("system_error");
  const qualityFindings = [];
  for (const row of findingRows) {
    const finding = responseQualityFinding(row, organizationId);
    if (!finding) return buildKaiError("system_error");
    qualityFindings.push(finding);
  }

  const sensitivityRow = record.sensitivityProfile ?? null;
  const sensitivityPosture = responseSensitivityPosture(sensitivityRow, organizationId);
  const allowedUseRestrictions = responseAllowedUseRestrictions(sensitivityRow);
  if (sensitivityPosture === undefined || allowedUseRestrictions === undefined) {
    return buildKaiError("system_error");
  }

  return {
    ok: true,
    data: {
      file_profile: fileProfile,
      data_dictionary: dataDictionary,
      quality_findings: qualityFindings,
      sensitivity_posture: sensitivityPosture,
      allowed_use_restrictions: allowedUseRestrictions,
      read_only: true,
    },
    warnings: [],
  };
}

/**
 * Read-only source-candidate review detail: safe lineage, the committed profile
 * checksum, queue state, decision state, and the source/source_version result the
 * committed decision row is bound to.
 *
 * `decision_controls_enabled` reflects KAI_SPRINT2_ENABLED so the internal UI can
 * show or hide its decision controls without guessing. `allowed_reviewed_source_types`
 * is read from P1-08's own exported contract rather than restated here, and is
 * empty whenever decision controls are disabled.
 */
export async function getReviewCockpitSourceCandidateDetail(input = {}, dependencies = {}) {
  const deps = resolvedDependencies(dependencies);
  const authorization = await authorizeReviewCockpitRequest(input, deps);
  if (!authorization.ok) return authorization.error;
  const { organizationId } = authorization;

  const intakeSourceCandidateId = typeof input.intakeSourceCandidateId === "string"
    ? input.intakeSourceCandidateId
    : "";
  if (!canonicalUuid(intakeSourceCandidateId)) return buildKaiError("invalid_request");

  const readRecord = deps.getReviewCockpitSourceCandidateRecord || readSourceCandidateRecord;
  const record = await readRecord(organizationId, intakeSourceCandidateId);
  if (!record) return buildKaiError("not_found");
  if (!isPlainObject(record)) return buildKaiError("system_error");

  const sourceCandidate = responseSourceCandidate(record.sourceCandidate, organizationId);
  if (!sourceCandidate || sourceCandidate.intake_source_candidate_id !== intakeSourceCandidateId) {
    return buildKaiError("system_error");
  }

  const reviewQueueItem = responseQueueState(record.reviewQueueItem ?? null, organizationId);
  const promotionDecision = responsePromotionDecision(record.promotionDecision ?? null, organizationId);
  const source = responseSource(record.source ?? null, organizationId);
  const sourceVersion = responseSourceVersion(record.sourceVersion ?? null, organizationId);
  if (
    reviewQueueItem === undefined
    || promotionDecision === undefined
    || source === undefined
    || sourceVersion === undefined
  ) {
    return buildKaiError("system_error");
  }

  const decisionControlsEnabled = isKaiSprint2Enabled(deps.env || process.env);

  return {
    ok: true,
    data: {
      source_candidate: sourceCandidate,
      review_queue_item: reviewQueueItem,
      promotion_decision: promotionDecision,
      source,
      source_version: sourceVersion,
      decision_controls_enabled: decisionControlsEnabled,
      allowed_reviewed_source_types: decisionControlsEnabled
        ? [...__sourcePromotionRepositoryContract.ALLOWED_REVIEWED_SOURCE_TYPES]
        : [],
    },
    warnings: [],
  };
}

/**
 * The P1-09 decision seam: validate the request DTO, then hand the decision to
 * P1-08's accepted createSourcePromotionDecision and marshal its result.
 *
 * This function implements no decision, transition, terminal-state, replay, or
 * idempotency logic of its own. In particular, a conflict_current_state_changed
 * result is returned to the caller exactly as P1-08 produced it - never retried,
 * never re-requested with a different outcome, and never coerced into any other
 * result - so a stale or terminal-state conflict can never trigger a second
 * mutation attempt from this layer.
 */
export async function submitSourceCandidateDecision(input = {}, dependencies = {}) {
  const deps = resolvedDependencies(dependencies);
  const env = deps.env || process.env;

  if (!isKaiSprint2Enabled(env)) {
    return buildKaiError("feature_disabled");
  }

  const authorization = await authorizeReviewCockpitRequest(input, deps);
  if (!authorization.ok) return authorization.error;
  const { organizationId, actorContext } = authorization;

  const intakeSourceCandidateId = typeof input.intakeSourceCandidateId === "string"
    ? input.intakeSourceCandidateId
    : "";
  if (!canonicalUuid(intakeSourceCandidateId)) return buildKaiError("invalid_request");

  const bodyValidation = validateSourceCandidateDecisionRequest(input.payload);
  if (!bodyValidation.ok) return validationBlocked(bodyValidation.blockers);

  const outcome = input.payload.outcome;
  const now = (deps.now ? new Date(deps.now()) : new Date()).toISOString();

  const metadataOnlyAudit = deps.metadataOnlyAudit || createProductionMetadataOnlyAuditForSourcePromotion({
    organizationId,
    intakeSourceCandidateId,
    actorContext,
    now,
  });

  const decide = deps.createSourcePromotionDecision || createSourcePromotionDecision;
  const result = await decide(
    {
      organizationId,
      intakeSourceCandidateId,
      outcome,
      ...(outcome === "promoted" ? { reviewedSourceType: input.payload.reviewed_source_type } : {}),
      actorContext,
      now,
    },
    {
      env,
      ...(deps.sourcePromotionRepository ? { sourcePromotionRepository: deps.sourcePromotionRepository } : {}),
      metadataOnlyAudit,
    },
  );

  if (!result?.ok) {
    return buildKaiError(result?.error?.code || "system_error", {
      ...(result?.data ? { data: result.data } : {}),
    });
  }

  const data = isPlainObject(result.data) ? result.data : null;
  if (!data) return buildKaiError("system_error");

  const promotionDecision = responsePromotionDecision(data.promotionDecision ?? null, organizationId);
  const sourceCandidate = data.sourceCandidate
    ? responseSourceCandidate(data.sourceCandidate, organizationId)
    : null;
  const reviewQueueItem = responseQueueState(data.reviewQueueItem ?? null, organizationId);
  const source = responseSource(data.source ?? null, organizationId);
  const sourceVersion = responseSourceVersion(data.sourceVersion ?? null, organizationId);
  if (
    !promotionDecision
    || !sourceCandidate
    || reviewQueueItem === undefined
    || source === undefined
    || sourceVersion === undefined
    || typeof data.replayed !== "boolean"
  ) {
    return buildKaiError("system_error");
  }

  return {
    ok: true,
    data: {
      promotion_decision: promotionDecision,
      source_candidate: sourceCandidate,
      review_queue_item: reviewQueueItem,
      source,
      source_version: sourceVersion,
      replayed: data.replayed,
    },
    warnings: [],
  };
}

export const __reviewCockpitServiceContract = Object.freeze({
  REVIEW_COCKPIT_READ_OPERATION,
  REVIEW_COCKPIT_READ_ROLES,
});

export const __testables = Object.freeze({
  responseReviewCockpitQueueItem,
  responseFileProfile,
  responseQualityFinding,
  responseSensitivityPosture,
  responseAllowedUseRestrictions,
  responseSensitivityDecision,
  responseSensitivityQueueState,
  responseSourceCandidate,
  responsePromotionDecision,
  setReviewCockpitDependenciesForTest(dependencies) {
    injectedDependencies = dependencies;
    return () => {
      injectedDependencies = null;
    };
  },
});
