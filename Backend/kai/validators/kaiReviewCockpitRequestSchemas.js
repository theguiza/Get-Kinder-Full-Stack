import {
  KAI_SPRINT2_P0_PATTERNS,
  KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES,
} from "../config/kaiSprint2P0Contract.js";

/**
 * KAI P1-09 internal review-cockpit request schemas.
 *
 * Additive and isolated: this module does not modify or re-export any validator in
 * Backend/kai/validators/kaiSprint2RequestSchemas.js. It follows that module's exact
 * idiom - a closed query-key allowlist, a base64url-encoded cursor object whose keys
 * and value shapes are re-validated on decode, and a closed request-body key
 * allowlist for the mutation request.
 */

/**
 * The canonical review-queue vocabularies this cockpit lists. Both are strict
 * subsets of vocabularies already established by accepted packages: the queue types
 * are exactly the three `queue_type` values P1-06 and P1-07 write, and the statuses
 * are exactly the accepted P0 review-queue status vocabulary. No new value is
 * introduced here.
 */
export const REVIEW_COCKPIT_QUEUE_TYPES = Object.freeze([
  "intake_file_review",
  "sensitivity_review",
  "source_candidate_review",
]);
export const REVIEW_COCKPIT_QUEUE_STATUSES = Object.freeze([...KAI_SPRINT2_P0_REVIEW_QUEUE_STATUSES]);

export const REVIEW_COCKPIT_QUEUE_DEFAULT_LIMIT = 25;
export const REVIEW_COCKPIT_QUEUE_MAX_LIMIT = 25;

export const REVIEW_COCKPIT_QUEUE_CURSOR_KEYS = Object.freeze(["created_at", "review_queue_item_id"]);

/**
 * The three owner-authorized P1-08 decision outcomes. This is the same vocabulary
 * P1-08's service and repository already enforce; it is restated here only so a
 * malformed request body is rejected before any service or repository call, and it
 * is never widened.
 */
export const REVIEW_COCKPIT_DECISION_OUTCOMES = Object.freeze([
  "needs_more_information",
  "rejected",
  "promoted",
]);

const REVIEW_COCKPIT_QUEUE_QUERY_KEYS = new Set([
  "organization_id",
  "limit",
  "cursor",
  "queue_type",
  "queue_status",
]);
const REVIEW_COCKPIT_DECISION_REQUEST_KEYS = new Set(["outcome", "reviewed_source_type"]);

const REVIEW_COCKPIT_QUEUE_TYPE_SET = new Set(REVIEW_COCKPIT_QUEUE_TYPES);
const REVIEW_COCKPIT_QUEUE_STATUS_SET = new Set(REVIEW_COCKPIT_QUEUE_STATUSES);
const REVIEW_COCKPIT_DECISION_OUTCOME_SET = new Set(REVIEW_COCKPIT_DECISION_OUTCOMES);

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const CANONICAL_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MACHINE_TOKEN_RE = /^[a-z0-9_]{1,64}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalIsoTimestamp(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string" || !CANONICAL_ISO_TIMESTAMP_RE.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) return null;
  return value;
}

function canonicalCursorUuid(value) {
  if (typeof value !== "string" || value !== value.toLowerCase()) return null;
  return KAI_SPRINT2_P0_PATTERNS.uuid.test(value) ? value : null;
}

function validatedCursorObject(value) {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== REVIEW_COCKPIT_QUEUE_CURSOR_KEYS.length) return null;
  if (!REVIEW_COCKPIT_QUEUE_CURSOR_KEYS.every((key, index) => keys[index] === key)) return null;

  const createdAt = canonicalIsoTimestamp(value.created_at);
  const identifier = canonicalCursorUuid(value.review_queue_item_id);
  if (!createdAt || !identifier) return null;
  return { created_at: createdAt, review_queue_item_id: identifier };
}

function decodeReviewCockpitQueueCursor(token) {
  if (typeof token !== "string" || !BASE64URL_RE.test(token)) return null;
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.length === 0 || bytes.toString("base64url") !== token) return null;
    return validatedCursorObject(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

export function encodeReviewCockpitQueueCursor(value) {
  const cursor = validatedCursorObject(value);
  if (!cursor) throw new TypeError("Cannot encode an invalid review-cockpit queue cursor.");
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * Service-side re-validation of an already-decoded pagination/filter object, so the
 * service never trusts a route-shaped object it did not itself check. Absent
 * filters resolve to the full canonical vocabulary rather than to an unbounded read.
 */
export function validateReviewCockpitQueueSelection(value = {}) {
  if (!isPlainObject(value)) return { ok: false };

  const limit = value.limit ?? REVIEW_COCKPIT_QUEUE_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > REVIEW_COCKPIT_QUEUE_MAX_LIMIT) {
    return { ok: false };
  }

  let cursor = null;
  if (value.cursor != null) {
    cursor = validatedCursorObject(value.cursor);
    if (!cursor) return { ok: false };
  }

  let queueTypes = REVIEW_COCKPIT_QUEUE_TYPES;
  if (value.queueType != null) {
    if (!REVIEW_COCKPIT_QUEUE_TYPE_SET.has(value.queueType)) return { ok: false };
    queueTypes = [value.queueType];
  }

  let queueStatuses = REVIEW_COCKPIT_QUEUE_STATUSES;
  if (value.queueStatus != null) {
    if (!REVIEW_COCKPIT_QUEUE_STATUS_SET.has(value.queueStatus)) return { ok: false };
    queueStatuses = [value.queueStatus];
  }

  return {
    ok: true,
    selection: {
      limit,
      cursor,
      queueTypes: [...queueTypes],
      queueStatuses: [...queueStatuses],
    },
  };
}

/**
 * Route-side query-string validation for the cockpit queue list. Rejects any query
 * key outside the closed allowlist, and accepts only string-shaped query values (an
 * array-shaped or object-shaped repeated query parameter is rejected, never
 * coerced).
 */
export function validateReviewCockpitQueueQuery(query = {}) {
  if (!isPlainObject(query)) return { ok: false };
  if (Object.keys(query).some((key) => !REVIEW_COCKPIT_QUEUE_QUERY_KEYS.has(key))) {
    return { ok: false };
  }

  let limit = REVIEW_COCKPIT_QUEUE_DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    if (typeof query.limit !== "string" || !/^\d+$/.test(query.limit)) return { ok: false };
    limit = Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > REVIEW_COCKPIT_QUEUE_MAX_LIMIT) {
      return { ok: false };
    }
  }

  let cursor = null;
  if (query.cursor !== undefined) {
    cursor = decodeReviewCockpitQueueCursor(query.cursor);
    if (!cursor) return { ok: false };
  }

  let queueType = null;
  if (query.queue_type !== undefined) {
    if (typeof query.queue_type !== "string" || !REVIEW_COCKPIT_QUEUE_TYPE_SET.has(query.queue_type)) {
      return { ok: false };
    }
    queueType = query.queue_type;
  }

  let queueStatus = null;
  if (query.queue_status !== undefined) {
    if (typeof query.queue_status !== "string" || !REVIEW_COCKPIT_QUEUE_STATUS_SET.has(query.queue_status)) {
      return { ok: false };
    }
    queueStatus = query.queue_status;
  }

  return { ok: true, selection: { limit, cursor, queueType, queueStatus } };
}

function requestBlocker(blockingReason, objectCode) {
  return {
    validator_key: "VAL-REQ-P0-001",
    severity: "blocker",
    object_type: "request",
    object_code: objectCode || "body",
    object_id: null,
    message: "Request does not match the KAI Sprint 2 route schema.",
    blocking_reason: blockingReason,
    required_fix: "Send only the documented metadata fields with their documented types and limits.",
    evidence: {},
  };
}

/**
 * Closed request-body allowlist for a source-candidate decision. `outcome` is
 * required and must be one of the three P1-08 outcomes; `reviewed_source_type` is
 * permitted only when `outcome === 'promoted'`, matching P1-08's own
 * present-but-ignored-is-never-accepted rule. The reviewed-source-type *vocabulary*
 * is deliberately not re-enumerated here: VAL-KAI-P1-08-003 in the accepted P1-08
 * repository remains its sole authority, so this validator only enforces a bounded
 * machine-token shape and forwards the value unchanged.
 */
export function validateSourceCandidateDecisionRequest(payload) {
  if (!isPlainObject(payload)) {
    return { ok: false, blockers: [requestBlocker("request_body_must_be_object", "body")] };
  }

  for (const key of Object.keys(payload)) {
    if (!REVIEW_COCKPIT_DECISION_REQUEST_KEYS.has(key)) {
      return { ok: false, blockers: [requestBlocker("unknown_field", `body.${key}`)] };
    }
    const value = payload[key];
    if (value === null) return { ok: false, blockers: [requestBlocker("null_field_not_allowed", `body.${key}`)] };
    if (Array.isArray(value)) return { ok: false, blockers: [requestBlocker("array_field_not_allowlisted", `body.${key}`)] };
    if (isPlainObject(value)) return { ok: false, blockers: [requestBlocker("nested_object_not_allowed", `body.${key}`)] };
    if (typeof value !== "string") return { ok: false, blockers: [requestBlocker("invalid_string_field", `body.${key}`)] };
  }

  if (!Object.hasOwn(payload, "outcome")) {
    return { ok: false, blockers: [requestBlocker("required_field_missing", "body.outcome")] };
  }
  if (!REVIEW_COCKPIT_DECISION_OUTCOME_SET.has(payload.outcome)) {
    return { ok: false, blockers: [requestBlocker("invalid_decision_outcome", "body.outcome")] };
  }

  const hasReviewedSourceType = Object.hasOwn(payload, "reviewed_source_type");
  if (payload.outcome === "promoted") {
    if (!hasReviewedSourceType) {
      return { ok: false, blockers: [requestBlocker("required_field_missing", "body.reviewed_source_type")] };
    }
    if (!MACHINE_TOKEN_RE.test(payload.reviewed_source_type)) {
      return { ok: false, blockers: [requestBlocker("invalid_reviewed_source_type", "body.reviewed_source_type")] };
    }
  } else if (hasReviewedSourceType) {
    return {
      ok: false,
      blockers: [requestBlocker("reviewed_source_type_not_allowed_for_outcome", "body.reviewed_source_type")],
    };
  }

  return { ok: true, blockers: [] };
}

export const __testables = {
  canonicalIsoTimestamp,
  decodeReviewCockpitQueueCursor,
  validatedCursorObject,
};
