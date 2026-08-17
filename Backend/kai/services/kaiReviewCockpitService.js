import {
  areKaiSprint2SourcePromotionFeaturesEnabled,
  isKaiSprint2Enabled,
} from "../config/kaiSprint2Config.js";
import { KAI_SPRINT2_P0_PATTERNS } from "../config/kaiSprint2P0Contract.js";
import { buildKaiError, validationBlocked } from "../errors/kaiErrors.js";
import { resolveKaiActorContext } from "../auth/kaiActorContext.js";
import { validateActorCanPerformOperation } from "../auth/kaiAuthorizationService.js";
import { validateTenantBoundaryConsistency } from "../validators/tenantValidators.js";
import {
  getReviewCockpitFileProfileRecord as readFileProfileRecord,
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
import { createSourcePromotionDecision } from "./kaiSourcePromotionService.js";
import { __sourcePromotionRepositoryContract } from "../dictionary/postgresSourcePromotionRepository.js";

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
 * P1-08's repository requires an injected metadata-only audit dependency. P1-09
 * introduces no audit provider of its own (that would be new abstraction outside
 * this package's scope): `dependencies.metadataOnlyAudit` is forwarded unchanged,
 * and when it is absent P1-08's own fail-closed validator returns a clean
 * validation_blocker rather than any partial write.
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

  const fileProfile = responseFileProfile(record.fileProfile, organizationId);
  if (!fileProfile || fileProfile.file_profile_id !== fileProfileId) return buildKaiError("system_error");

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
 * `decision_controls_enabled` reflects KAI_SOURCE_PROMOTION_ENABLED (composed with
 * KAI_SPRINT2_ENABLED) so the internal UI can hide or disable its decision controls
 * without guessing; the detail itself remains fully available under
 * KAI_SPRINT2_ENABLED alone. `allowed_reviewed_source_types` is read from P1-08's
 * own exported contract rather than restated here, and is empty whenever the
 * decision controls are disabled.
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

  const decisionControlsEnabled = areKaiSprint2SourcePromotionFeaturesEnabled(deps.env || process.env);

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

  if (!areKaiSprint2SourcePromotionFeaturesEnabled(env)) {
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
      ...(deps.metadataOnlyAudit ? { metadataOnlyAudit: deps.metadataOnlyAudit } : {}),
    },
  );

  if (!result?.ok) {
    return buildKaiError(result?.error?.code || "system_error");
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
  responseSourceCandidate,
  responsePromotionDecision,
  setReviewCockpitDependenciesForTest(dependencies) {
    injectedDependencies = dependencies;
    return () => {
      injectedDependencies = null;
    };
  },
});
