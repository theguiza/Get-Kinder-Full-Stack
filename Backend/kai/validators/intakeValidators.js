import { blockerResult, passResult, warningResult } from "./types.js";
import {
  checksum_format_supported,
  checksum_required,
  idempotency_key_format_supported,
  idempotency_key_required,
} from "./idempotencyValidators.js";

const VALID_REVIEW_QUEUE_TYPES = Object.freeze([
  "intake_file_review",
  "source_candidate_review",
  "sensitivity_review",
  "data_dictionary_review",
  "evidence_review",
  "claim_review",
  "client_followup",
  "conflict_resolution",
  "generated_content_review",
  "export_review",
]);

export const SUPPORTED_FILE_POLICY_STATUSES = Object.freeze(["pending", "passed", "blocked", "failed", "skipped"]);
export const SUPPORTED_STORAGE_PROVIDERS = Object.freeze(["gcs", "local_dev"]);

const INVALID_P0_QUEUE_TYPES = new Set([
  "source_candidate_review_stub",
  "client_followup_stub",
  "file_policy_blocked",
]);

export function validateReviewQueueType({ queueType } = {}) {
  if (INVALID_P0_QUEUE_TYPES.has(queueType) || !VALID_REVIEW_QUEUE_TYPES.includes(queueType)) {
    return blockerResult("VAL-INT-001", "Review queue type is not DDL-valid.", {
      object_type: "review_queue_item",
      object_code: queueType,
      blocking_reason: "invalid_queue_type",
      required_fix: "Use a DDL-valid queue_type and put stub/blocking semantics in metadata/status fields.",
    });
  }

  return passResult("VAL-INT-001", "Review queue type is DDL-valid.", { queueType });
}

export { VALID_REVIEW_QUEUE_TYPES };

function hasValue(value) {
  return value != null && String(value).trim() !== "";
}

function getOrganizationId(context = {}) {
  return (
    context.organizationId ||
    context.organization_id ||
    context.tenantContext?.organizationId ||
    context.tenantContext?.organization_id ||
    context.payload?.organizationId ||
    context.payload?.organization_id ||
    null
  );
}

function getBooleanFlag(context = {}, names = []) {
  for (const name of names) {
    if (context[name] === true || context.payload?.[name] === true) return true;
  }
  return false;
}

export function actor_context_required(context = {}) {
  if (!context.actorContext) {
    return blockerResult("VAL-INT-ACTOR-001", "Actor context is required for intake operations.", {
      object_type: "actor_context",
      blocking_reason: "missing_actor_context",
      required_fix: "Resolve a mapped Sprint 2 actor before evaluating intake creation.",
      evidence: { actor_context_present: false },
    });
  }

  return passResult("VAL-INT-ACTOR-001", "Actor context is present.", { actor_context_present: true });
}

export function tenant_context_required(context = {}) {
  if (!context.tenantContext && !hasValue(getOrganizationId(context))) {
    return blockerResult("VAL-INT-TENANT-001", "Tenant context is required for intake operations.", {
      object_type: "tenant_context",
      blocking_reason: "missing_tenant_context",
      required_fix: "Resolve tenant authorization before evaluating intake creation.",
      evidence: { tenant_context_present: false },
    });
  }

  return passResult("VAL-INT-TENANT-001", "Tenant context is present.", { tenant_context_present: true });
}

export function organization_id_required(context = {}) {
  if (!hasValue(getOrganizationId(context))) {
    return blockerResult("VAL-INT-TENANT-002", "organization_id is required for intake operations.", {
      object_type: "organization",
      object_code: "organization_id",
      blocking_reason: "missing_organization_id",
      required_fix: "Supply organization_id from the authorized tenant scope.",
      evidence: { organization_id_present: false },
    });
  }

  return passResult("VAL-INT-TENANT-002", "organization_id is present.", { organization_id_present: true });
}

export function file_policy_status_supported(context = {}) {
  const filePolicyStatus = context.filePolicyStatus || context.file_policy_status || context.payload?.file_policy_status || "pending";
  if (!SUPPORTED_FILE_POLICY_STATUSES.includes(filePolicyStatus)) {
    return blockerResult("VAL-INT-FILE-001", "file_policy_status is not supported by the accepted DDL vocabulary.", {
      object_type: "intake_file",
      object_code: filePolicyStatus,
      blocking_reason: "unsupported_file_policy_status",
      required_fix: "Use pending, passed, blocked, failed, or skipped.",
    });
  }

  return passResult("VAL-INT-FILE-001", "file_policy_status is supported.", { file_policy_status: filePolicyStatus });
}

export function storage_provider_supported(context = {}) {
  const storageProvider = context.storageProvider || context.storage_provider || context.payload?.storage_provider || "gcs";
  if (!SUPPORTED_STORAGE_PROVIDERS.includes(storageProvider)) {
    return blockerResult("VAL-INT-STORAGE-001", "storage_provider is blocked for this P0 contract.", {
      object_type: "intake_file",
      object_code: storageProvider,
      blocking_reason: "unsupported_storage_provider",
      required_fix: "Use gcs or local_dev only for the P0 contract surface.",
    });
  }

  return passResult("VAL-INT-STORAGE-001", "storage_provider is supported.", { storage_provider: storageProvider });
}

export function raw_upload_blocked_in_p0(context = {}) {
  if (
    getBooleanFlag(context, ["rawUploadRequested", "raw_upload_requested", "rawUpload", "raw_upload"]) ||
    context.rawFile ||
    context.file
  ) {
    return blockerResult("VAL-INT-P0-001", "Raw file upload is blocked in Sprint 2 P0 Pass 1D.", {
      object_type: "intake_file",
      blocking_reason: "raw_upload_blocked_in_p0",
      required_fix: "Use non-mutating intake preflight only in Pass 1D.",
    });
  }

  return passResult("VAL-INT-P0-001", "Raw file upload was not requested.");
}

export function signed_url_blocked_in_p0(context = {}) {
  if (
    getBooleanFlag(context, [
      "signedUploadUrlRequested",
      "signed_upload_url_requested",
      "signedReadUrlRequested",
      "signed_read_url_requested",
    ])
  ) {
    return blockerResult("VAL-INT-P0-002", "Signed URLs are blocked in Sprint 2 P0 Pass 1D.", {
      object_type: "intake_file",
      blocking_reason: "signed_url_blocked_in_p0",
      required_fix: "Do not issue signed upload or read URLs in Pass 1D.",
    });
  }

  return passResult("VAL-INT-P0-002", "Signed URL behavior was not requested.");
}

export function parser_raw_file_work_blocked_in_p0(context = {}) {
  if (getBooleanFlag(context, ["parserRawFileWorkRequested", "parser_raw_file_work_requested"])) {
    return blockerResult("VAL-INT-P0-003", "Parser raw-file work is blocked in Sprint 2 P0 Pass 1D.", {
      object_type: "intake_file",
      blocking_reason: "parser_raw_file_work_blocked_in_p0",
      required_fix: "Do not fetch or parse raw files in Pass 1D.",
    });
  }

  return passResult("VAL-INT-P0-003", "Parser raw-file work was not requested.");
}

export function source_promotion_blocked_in_p0(context = {}) {
  if (getBooleanFlag(context, ["sourcePromotionRequested", "source_promotion_requested"])) {
    return blockerResult("VAL-INT-P0-004", "Source promotion is blocked in Sprint 2 P0 Pass 1D.", {
      object_type: "source",
      blocking_reason: "source_promotion_blocked_in_p0",
      required_fix: "Do not promote intake files to sources in Pass 1D.",
    });
  }

  return passResult("VAL-INT-P0-004", "Source promotion was not requested.");
}

export function pass1d_contract_warning() {
  return warningResult("VAL-INT-P0-005", "Intake creation is scaffolded only and remains non-mutating in Pass 1D.", {
    object_type: "intake_contract",
    blocking_reason: null,
    required_fix: null,
  });
}

export const intakeValidatorGroups = Object.freeze({
  intake_preflight: Object.freeze([
    actor_context_required,
    tenant_context_required,
    organization_id_required,
    file_policy_status_supported,
    storage_provider_supported,
    raw_upload_blocked_in_p0,
    signed_url_blocked_in_p0,
    parser_raw_file_work_blocked_in_p0,
    source_promotion_blocked_in_p0,
    pass1d_contract_warning,
  ]),
  future_intake_creation: Object.freeze([
    actor_context_required,
    tenant_context_required,
    organization_id_required,
    idempotency_key_required,
    idempotency_key_format_supported,
    file_policy_status_supported,
    storage_provider_supported,
    raw_upload_blocked_in_p0,
    signed_url_blocked_in_p0,
    parser_raw_file_work_blocked_in_p0,
    source_promotion_blocked_in_p0,
    pass1d_contract_warning,
  ]),
  create_intake_batch: Object.freeze([
    actor_context_required,
    tenant_context_required,
    organization_id_required,
    idempotency_key_required,
    idempotency_key_format_supported,
    file_policy_status_supported,
    storage_provider_supported,
    raw_upload_blocked_in_p0,
    signed_url_blocked_in_p0,
    parser_raw_file_work_blocked_in_p0,
    source_promotion_blocked_in_p0,
    pass1d_contract_warning,
  ]),
  register_intake_file_metadata: Object.freeze([
    actor_context_required,
    tenant_context_required,
    organization_id_required,
    idempotency_key_required,
    idempotency_key_format_supported,
    checksum_required,
    checksum_format_supported,
    file_policy_status_supported,
    storage_provider_supported,
    raw_upload_blocked_in_p0,
    signed_url_blocked_in_p0,
    parser_raw_file_work_blocked_in_p0,
    source_promotion_blocked_in_p0,
    pass1d_contract_warning,
  ]),
  confirm_upload: Object.freeze([
    actor_context_required,
    tenant_context_required,
    organization_id_required,
    idempotency_key_required,
    idempotency_key_format_supported,
    checksum_required,
    checksum_format_supported,
    file_policy_status_supported,
    storage_provider_supported,
    raw_upload_blocked_in_p0,
    signed_url_blocked_in_p0,
    parser_raw_file_work_blocked_in_p0,
    source_promotion_blocked_in_p0,
    pass1d_contract_warning,
  ]),
});
