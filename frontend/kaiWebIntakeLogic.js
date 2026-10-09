import { isRouteUuid } from "./impactEvidenceLibraryLogic.js";

export const BASE_PATH = "/api/kai/sprint2/intake";

export function organizationsPath() {
  return `${BASE_PATH}/admin/organizations`;
}

export function organizationOnboardingStatusPath() {
  return `${BASE_PATH}/admin/organization-onboarding/status`;
}

export function engagementsPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/engagements`;
}

// KAI Impact Library redesign, Package F: "+ New Project" over
// kai.engagements - same path shape as engagementsPath, POST creates.
export function createEngagementPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/engagements`;
}

export function organizationProfilePath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/profile`;
}

// KAI Impact Library redesign, Package G/G2: Improvement Plan over the new
// kai.improvement_practices table. engagementId is optional - omitted means
// the organization-wide list (no engagement_id query param sent).
export function improvementPracticesPath(organizationId, engagementId) {
  const base = `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/improvement-practices`;
  return engagementId ? `${base}?engagement_id=${encodeURIComponent(engagementId)}` : base;
}

export function improvementPracticePath(organizationId, improvementPracticeId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/improvement-practices/${encodeURIComponent(improvementPracticeId)}`;
}

export function improvementPracticeStatusPath(organizationId, improvementPracticeId) {
  return `${improvementPracticePath(organizationId, improvementPracticeId)}/status`;
}

export function batchesPath(organizationId) {
  return `${BASE_PATH}/admin/batches?organization_id=${encodeURIComponent(organizationId)}`;
}

export function batchFilesPath(organizationId, intakeBatchId) {
  return `${BASE_PATH}/admin/batches/${encodeURIComponent(intakeBatchId)}/files?organization_id=${encodeURIComponent(organizationId)}`;
}

export function fileDetailPath(organizationId, intakeFileId) {
  return `${BASE_PATH}/admin/files/${encodeURIComponent(intakeFileId)}?organization_id=${encodeURIComponent(organizationId)}`;
}

// GK-only review-cockpit lookup of one intake file's P1-05 sensitivity profile
// id. Never part of the restricted file-detail DTO.
export function intakeFileSensitivityProfilePath(organizationId, intakeFileId) {
  return `${BASE_PATH}/admin/review-cockpit/intake-files/${encodeURIComponent(intakeFileId)}/sensitivity-profile`
    + `?organization_id=${encodeURIComponent(organizationId)}`;
}

export function createBatchPath() {
  return `${BASE_PATH}/admin/batches`;
}

export function fileReservationsPath(intakeBatchId) {
  return `${BASE_PATH}/admin/batches/${encodeURIComponent(intakeBatchId)}/file-reservations`;
}

export function requestUploadUrlPath(intakeBatchId) {
  return `${BASE_PATH}/admin/batches/${encodeURIComponent(intakeBatchId)}/files/upload-url`;
}

export function confirmUploadPath(organizationId, intakeFileId) {
  return `${BASE_PATH}/admin/files/${encodeURIComponent(intakeFileId)}/confirm-upload?organization_id=${encodeURIComponent(organizationId)}`;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function getJson(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  return { statusCode: response.status, body: await readJson(response) };
}

export async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { statusCode: response.status, body: await readJson(response) };
}

/**
 * Gate C-2A browser signed-upload PUT. The signed URL and its headers exist
 * only as function parameters/locals for the duration of this call - never
 * rendered, logged, or stored in any longer-lived state. No application
 * cookies, Authorization header, CSRF token, or other app header is ever
 * attached: only the server-issued upload_headers (the reserved Content-Type)
 * are sent, cross-origin, with no credentials.
 */
export async function putToSignedUrl(uploadUrl, uploadMethod, uploadHeaders, file) {
  const response = await fetch(uploadUrl, {
    method: uploadMethod || "PUT",
    headers: uploadHeaders || {},
    body: file,
  });
  return { statusCode: response.status, ok: response.ok };
}

export async function sha256HexOfFile(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateIdempotencyKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Resolves the idempotency key for one logical file-reservation intent: one
// file selection, in one batch, with the checksum of exactly the bytes
// selected, optionally as an explicit new version of one existing file.
// A retry of that intent replays the same key; choosing a file again, a
// different file, another batch, or a new-version decision is a new intent
// and mints a new key. Repeated uploads of content already held are resolved
// by the server's duplicate-resolution response, not by key reuse.
export function resolveFileReservationIdempotencyKey(
  previousIdentity,
  { selectionId, intakeBatchId, checksum, duplicateOfIntakeFileId = null },
  mintKey = generateIdempotencyKey,
) {
  if (
    previousIdentity &&
    previousIdentity.selectionId === selectionId &&
    previousIdentity.intakeBatchId === intakeBatchId &&
    previousIdentity.checksum === checksum &&
    previousIdentity.duplicateOfIntakeFileId === duplicateOfIntakeFileId
  ) {
    return previousIdentity;
  }
  return { selectionId, intakeBatchId, checksum, duplicateOfIntakeFileId, key: `file-${mintKey()}` };
}

// Server-allowed MIME for each supported extension, used only when the
// browser reports no type for the selected file (common for .md and .txt).
// A browser-reported type is always sent as reported.
const MIME_TYPE_BY_SUPPORTED_EXTENSION = Object.freeze({
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
});

export function declaredMimeTypeForFile(file) {
  if (typeof file?.type === "string" && file.type.length > 0) return file.type;
  return MIME_TYPE_BY_SUPPORTED_EXTENSION[fileExtensionOf(file?.name)] || "application/octet-stream";
}

// The server signs an upload only for a record still in "reserved". A 409
// conflict_current_state_changed means its bytes were already transferred
// (a retried or continued intent whose earlier attempt got further than the
// browser saw), so the remaining step is confirmation - which re-verifies the
// stored bytes server-side and replays safely - not a stale-state dead end.
export function uploadUrlResultRequiresConfirmOnly(result) {
  return result?.statusCode === 409 && result?.body?.error?.code === "conflict_current_state_changed";
}

export const DUPLICATE_RESOLUTION_ACTION = Object.freeze({
  USE_EXISTING_FILE: "use_existing_file",
  CONTINUE_UPLOAD: "continue_upload",
  UPLOAD_NEW_INTAKE_VERSION: "upload_new_intake_version",
  CANCEL: "cancel",
});

const KNOWN_DUPLICATE_ACTIONS = new Set(Object.values(DUPLICATE_RESOLUTION_ACTION));

// The server's duplicate-resolution payload (422 VAL-IDEMP-006, or 409 when
// the presented file changed), or null for any other response.
export function duplicateResolutionFromResult(result) {
  if (result?.statusCode !== 422 && result?.statusCode !== 409) return null;
  const resolution = result?.body?.data?.duplicate_resolution;
  if (
    !resolution
    || resolution.contract !== "kai_intake_duplicate_resolution_v1"
    || typeof resolution.existing_file?.intake_file_id !== "string"
    || typeof resolution.existing_file?.intake_batch_id !== "string"
    || !Array.isArray(resolution.available_actions)
  ) {
    return null;
  }
  return {
    ...resolution,
    available_actions: resolution.available_actions.filter((action) => KNOWN_DUPLICATE_ACTIONS.has(action)),
  };
}

const DUPLICATE_LOCATION_TEXT = Object.freeze({
  duplicate_in_batch: "In this batch",
  duplicate_in_other_batch: "In another batch in this project",
  duplicate_in_other_engagement: "In another project in this organization",
});

const EXISTING_STATE_TEXT = Object.freeze({
  confirmed: "Uploaded",
  upload_in_progress: "Upload not finished",
  upload_not_completed: "Upload did not complete",
  blocked_by_policy: "Blocked by a file security policy",
  security_check_failed: "Security check could not run",
  unknown: "Status unavailable",
});

const DUPLICATE_RESTRICTION_TEXT = Object.freeze({
  blocked_by_policy:
    "An identical file was blocked by a file security policy, so this copy can't be added. Correct the file and upload the corrected version, or contact Get Kinder.",
  security_check_failed:
    "The security check for the identical file could not run. Uploading the same file again won't resolve this. Contact Get Kinder.",
  upload_in_progress:
    "An upload of this file in this batch hasn't finished. Continue that upload instead of starting another.",
  declared_size_mismatch:
    "The selected file's size doesn't match the earlier file. Choose the file again and retry.",
  state_unknown: "The earlier file's status can't be confirmed, so no action is available. Contact Get Kinder.",
});

function duplicateActionLabel(action, duplicateStatus) {
  if (action === DUPLICATE_RESOLUTION_ACTION.USE_EXISTING_FILE) return "Use existing file";
  if (action === DUPLICATE_RESOLUTION_ACTION.CONTINUE_UPLOAD) return "Continue upload";
  if (action === DUPLICATE_RESOLUTION_ACTION.UPLOAD_NEW_INTAKE_VERSION) {
    return duplicateStatus === "duplicate_in_batch"
      ? "Upload again as a new intake version"
      : "Upload to this batch as a linked copy";
  }
  return "Cancel";
}

// Display model for the resolution card: only the actions the server listed.
export function duplicateResolutionView(resolution) {
  const existing = resolution.existing_file;
  return {
    heading: "This file has already been added.",
    existingFilename: existing.safe_filename,
    location: DUPLICATE_LOCATION_TEXT[resolution.duplicate_status] || "In this organization",
    status: EXISTING_STATE_TEXT[existing.existing_state] || EXISTING_STATE_TEXT.unknown,
    processingStatus: existing.processing_status,
    restriction: resolution.restriction_code ? DUPLICATE_RESTRICTION_TEXT[resolution.restriction_code] || null : null,
    actions: resolution.available_actions.map((action) => ({
      action,
      label: duplicateActionLabel(action, resolution.duplicate_status),
    })),
  };
}

export function fileExtensionOf(filename) {
  const match = /\.[^.]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
}

export function errorText(result) {
  return result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`;
}

// Files persistence/rehydration: request-state vocabulary for the batch and
// batch-file reads, so an initial empty array is never presented as proof
// that no persisted data exists, and a failed read never renders as zero-data.
export const INTAKE_READ_STATUS = Object.freeze({
  NOT_STARTED: "not_started",
  LOADING: "loading",
  SUCCESS_EMPTY: "success_empty",
  SUCCESS_WITH_DATA: "success_with_data",
  ERROR: "error",
});

function sameId(left, right) {
  return Boolean(left) && Boolean(right) && String(left).toLowerCase() === String(right).toLowerCase();
}

// The organization-scoped batch list is narrowed to the active Project using
// only each batch's persisted organization_id + engagement_id - never its
// code, name, timestamps, or position.
export function engagementScopedBatches(batches, organizationId, engagementId) {
  if (!Array.isArray(batches) || !organizationId || !engagementId) return [];
  return batches.filter(
    (batch) =>
      batch &&
      batch.intake_batch_id &&
      sameId(batch.organization_id, organizationId) &&
      sameId(batch.engagement_id, engagementId),
  );
}

// Resolves which batch (if any) is active after a fresh authoritative read:
// a retained selection is reused only when it is in the scoped list; a single
// scoped batch is selected; several require an explicit user choice.
export function resolveIntakeBatchSelection(scopedBatches, retainedIntakeBatchId = "") {
  const items = Array.isArray(scopedBatches) ? scopedBatches : [];
  const retained = items.find((batch) => sameId(batch.intake_batch_id, retainedIntakeBatchId));
  if (retained) {
    return { intakeBatchId: retained.intake_batch_id, retainedStale: false, requiresChoice: false };
  }
  const retainedStale = Boolean(retainedIntakeBatchId);
  if (items.length === 1) {
    return { intakeBatchId: items[0].intake_batch_id, retainedStale, requiresChoice: false };
  }
  return { intakeBatchId: "", retainedStale, requiresChoice: items.length > 1 };
}

// One authoritative read of the organization's batches, narrowed to the
// active engagement and resolved to a selection. A failed read selects
// nothing, so an unvalidated retained id can never reach the file route.
export async function readEngagementIntakeBatches(
  { organizationId, engagementId, retainedIntakeBatchId = "" },
  getJsonFn = getJson,
) {
  const result = await getJsonFn(batchesPath(organizationId));
  if (result?.statusCode !== 200 || !result?.body?.ok) {
    return {
      status: INTAKE_READ_STATUS.ERROR,
      error: errorText(result),
      batches: [],
      intakeBatchId: "",
      retainedStale: false,
      requiresChoice: false,
    };
  }
  const batches = engagementScopedBatches(result.body.data?.batches, organizationId, engagementId);
  return {
    status: batches.length > 0 ? INTAKE_READ_STATUS.SUCCESS_WITH_DATA : INTAKE_READ_STATUS.SUCCESS_EMPTY,
    error: "",
    batches,
    ...resolveIntakeBatchSelection(batches, retainedIntakeBatchId),
  };
}

// One authoritative read of a validated batch's persisted files through the
// existing organization + intakeBatchId -> listIntakeFilesForBatch route.
export async function readIntakeBatchFiles({ organizationId, intakeBatchId }, getJsonFn = getJson) {
  const result = await getJsonFn(batchFilesPath(organizationId, intakeBatchId));
  if (result?.statusCode !== 200 || !result?.body?.ok) {
    return { status: INTAKE_READ_STATUS.ERROR, error: errorText(result), items: [] };
  }
  const items = Array.isArray(result.body.data?.items) ? result.body.data.items : [];
  return {
    status: items.length > 0 ? INTAKE_READ_STATUS.SUCCESS_WITH_DATA : INTAKE_READ_STATUS.SUCCESS_EMPTY,
    error: "",
    items,
  };
}

// One read of the GK-only file -> sensitivity profile lookup. Resolves to the
// server-grounded profile id, or null for a failed read, a response for a
// different file, or a file without a complete profile - never a guess.
export async function readIntakeFileSensitivityProfileId({ organizationId, intakeFileId }, getJsonFn = getJson) {
  try {
    const result = await getJsonFn(intakeFileSensitivityProfilePath(organizationId, intakeFileId));
    const data = result?.statusCode === 200 && result?.body?.ok ? result.body.data : null;
    if (!data || data.intake_file_id !== intakeFileId) return null;
    return isRouteUuid(data.intake_sensitivity_profile_id) ? data.intake_sensitivity_profile_id : null;
  } catch {
    return null;
  }
}
