import { blockerResult, createValidatorResult } from "./types.js";

export const CONFLICT_GROUP_VALIDATOR_KEY = "VAL-KAI-P2-05-001";
export const CONFLICT_GROUP_OBJECT_TYPE = "conflict_group";
export const CONFLICT_GROUP_OBJECT_CODE = "human_selected_unresolved_comparison";

export const CONFLICT_GROUP_BASIS_CODE = "human_selected_unresolved_comparison";
export const CONFLICT_GROUP_SAFE_SUMMARY = "Potential claim conflict requires GK review.";

export const CONFLICT_RESOLUTION_QUEUE_TYPE = "conflict_resolution";
export const CONFLICT_RESOLUTION_TARGET_OBJECT_TYPE = "conflict_group";
export const CONFLICT_RESOLUTION_QUEUE_STATUS = "open";
export const CONFLICT_RESOLUTION_REVIEW_STATUS = "needs_gk_review";
export const CONFLICT_RESOLUTION_PRIORITY = "medium";
export const CONFLICT_RESOLUTION_REQUIRED_ACTION =
  "Compare both claims, their evidence lineage, definitions, reporting periods, entity levels, denominators, and support limitations. Record whether a conflict exists. Do not approve or promote either claim.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const PROHIBITED_KEYS = Object.freeze([
  "claim_text",
  "claim_statement",
  "statement",
  "evidence_text",
  "gap_summary",
  "filename",
  "file_name",
  "raw_content",
  "sample",
  "pii",
  "storage_uri",
  "storage_bucket",
  "storage_object_key",
  "object_key",
  "signed_url",
  "prompt",
  "credential",
  "conflict_status",
  "resolution_status",
  "confidence",
  "asserted_conflict",
  "asserted_conflict_exists",
  "automatic_detection",
  "conflict_exists",
  "proven_conflict",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function findProhibitedKeys(value, path = "") {
  if (!isPlainObject(value) && !Array.isArray(value)) return [];
  const found = [];
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, child] of entries) {
    const keyString = String(key);
    const normalized = keyString.toLowerCase();
    const childPath = path ? `${path}.${keyString}` : keyString;
    if (PROHIBITED_KEYS.includes(normalized)) found.push(childPath);
    if (isPlainObject(child) || Array.isArray(child)) {
      found.push(...findProhibitedKeys(child, childPath));
    }
  }
  return found;
}

function resultEvidence({ reasonCode, conflictGroup, queueItem, prohibitedKeys = [] } = {}) {
  return {
    reason_code: reasonCode,
    conflict_group_id: conflictGroup?.conflict_group_id ?? queueItem?.target_object_id ?? null,
    organization_id: conflictGroup?.organization_id ?? queueItem?.organization_id ?? null,
    lower_claim_id: conflictGroup?.lower_claim_id ?? null,
    higher_claim_id: conflictGroup?.higher_claim_id ?? null,
    lower_claim_conflict_gap_id: conflictGroup?.lower_claim_conflict_gap_id ?? null,
    higher_claim_conflict_gap_id: conflictGroup?.higher_claim_conflict_gap_id ?? null,
    queue_type: queueItem?.queue_type ?? null,
    queue_target_object_type: queueItem?.target_object_type ?? null,
    queue_target_object_id: queueItem?.target_object_id ?? null,
    queue_status: queueItem?.queue_status ?? null,
    review_status: queueItem?.review_status ?? null,
    priority: queueItem?.priority ?? null,
    prohibited_key_count: prohibitedKeys.length,
    prohibited_keys: prohibitedKeys,
  };
}

function passResult(conflictGroup, queueItem) {
  return createValidatorResult({
    validator_key: CONFLICT_GROUP_VALIDATOR_KEY,
    severity: "pass",
    object_type: CONFLICT_GROUP_OBJECT_TYPE,
    object_code: CONFLICT_GROUP_OBJECT_CODE,
    object_id: conflictGroup.conflict_group_id,
    message: "Conflict-group candidate and review queue contract are complete.",
    evidence: resultEvidence({ reasonCode: "conflict_group_contract_passed", conflictGroup, queueItem }),
  });
}

function block(message, reasonCode, { conflictGroup, queueItem, prohibitedKeys = [] } = {}) {
  return blockerResult(CONFLICT_GROUP_VALIDATOR_KEY, message, {
    object_type: CONFLICT_GROUP_OBJECT_TYPE,
    object_code: CONFLICT_GROUP_OBJECT_CODE,
    object_id: conflictGroup?.conflict_group_id ?? queueItem?.target_object_id ?? null,
    blocking_reason: reasonCode,
    required_fix: "Rebuild the conflict-group plan from authoritative normalized claim, gap, and queue identities.",
    evidence: resultEvidence({ reasonCode, conflictGroup, queueItem, prohibitedKeys }),
  });
}

export function validateConflictGroupCompleteness({ conflictGroup, queueItem } = {}) {
  if (!isPlainObject(conflictGroup)) {
    return block("A complete conflict-group row or plan is required.", "missing_conflict_group", { conflictGroup, queueItem });
  }
  if (!isPlainObject(queueItem)) {
    return block("A complete conflict-resolution queue row or plan is required.", "missing_queue_item", { conflictGroup, queueItem });
  }

  const allowedGroupKeys = new Set([
    "conflict_group_id",
    "organization_id",
    "lower_claim_id",
    "higher_claim_id",
    "lower_claim_conflict_gap_id",
    "higher_claim_conflict_gap_id",
    "basis_code",
    "safe_summary",
    "created_by_type",
    "created_at",
  ]);
  const allowedQueueKeys = new Set([
    "review_queue_item_id",
    "organization_id",
    "queue_type",
    "target_object_type",
    "target_object_id",
    "queue_status",
    "review_status",
    "priority",
    "summary",
    "required_action",
    "assigned_to",
    "due_at",
  ]);

  if (!Object.keys(conflictGroup).every((key) => allowedGroupKeys.has(key))) {
    return block("The conflict-group plan contains unsupported fields.", "malformed_conflict_group_plan", { conflictGroup, queueItem });
  }
  if (!Object.keys(queueItem).every((key) => allowedQueueKeys.has(key))) {
    return block("The conflict-resolution queue plan contains unsupported fields.", "malformed_queue_plan", { conflictGroup, queueItem });
  }

  const ids = [
    conflictGroup.conflict_group_id,
    conflictGroup.organization_id,
    conflictGroup.lower_claim_id,
    conflictGroup.higher_claim_id,
    conflictGroup.lower_claim_conflict_gap_id,
    conflictGroup.higher_claim_conflict_gap_id,
  ];
  if (!ids.every(isCanonicalUuid)) {
    return block("Conflict-group identities must be non-null canonical UUIDs.", "invalid_conflict_group_identity", { conflictGroup, queueItem });
  }
  if (conflictGroup.lower_claim_id === conflictGroup.higher_claim_id) {
    return block("A conflict-group candidate requires two distinct claims.", "self_pairing", { conflictGroup, queueItem });
  }
  if (!(conflictGroup.lower_claim_id < conflictGroup.higher_claim_id)) {
    return block("Conflict-group claim IDs must be stored in lexical UUID order.", "claim_pair_not_normalized", { conflictGroup, queueItem });
  }

  const groupContractOk =
    conflictGroup.basis_code === CONFLICT_GROUP_BASIS_CODE &&
    conflictGroup.safe_summary === CONFLICT_GROUP_SAFE_SUMMARY &&
    conflictGroup.created_by_type === "system";
  if (!groupContractOk) {
    return block("The conflict-group row must use the exact potential-candidate contract.", "invalid_conflict_group_contract", {
      conflictGroup,
      queueItem,
    });
  }

  const queueContractOk =
    queueItem.organization_id === conflictGroup.organization_id &&
    queueItem.queue_type === CONFLICT_RESOLUTION_QUEUE_TYPE &&
    queueItem.target_object_type === CONFLICT_RESOLUTION_TARGET_OBJECT_TYPE &&
    queueItem.target_object_id === conflictGroup.conflict_group_id &&
    queueItem.queue_status === CONFLICT_RESOLUTION_QUEUE_STATUS &&
    queueItem.review_status === CONFLICT_RESOLUTION_REVIEW_STATUS &&
    queueItem.priority === CONFLICT_RESOLUTION_PRIORITY &&
    queueItem.summary === CONFLICT_GROUP_SAFE_SUMMARY &&
    queueItem.required_action === CONFLICT_RESOLUTION_REQUIRED_ACTION &&
    queueItem.assigned_to === null &&
    queueItem.due_at === null;
  if (!queueContractOk) {
    return block("The conflict-resolution queue item must use the exact fixed queue contract.", "invalid_queue_contract", {
      conflictGroup,
      queueItem,
    });
  }

  const prohibitedKeys = [...findProhibitedKeys(conflictGroup), ...findProhibitedKeys(queueItem)];
  if (prohibitedKeys.length > 0) {
    return block("Conflict-group persistence must not carry asserted-conflict or raw/sensitive content.", "prohibited_content_present", {
      conflictGroup,
      queueItem,
      prohibitedKeys,
    });
  }

  return passResult(conflictGroup, queueItem);
}

export const __conflictGroupValidatorTestables = Object.freeze({
  findProhibitedKeys,
  isCanonicalUuid,
});
