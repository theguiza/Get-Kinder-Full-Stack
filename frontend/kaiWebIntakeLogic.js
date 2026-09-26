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

// Resolves the idempotency key for one logical file-reservation operation.
// The server blocks duplicate declared checksums, so browser retries must key
// the reservation by the same batch + checksum identity that the server uses.
export function resolveFileReservationIdempotencyKey(previousIdentity, intakeBatchId, checksum) {
  const key = `file-${intakeBatchId}-${checksum}`;
  if (
    previousIdentity &&
    previousIdentity.intakeBatchId === intakeBatchId &&
    previousIdentity.checksum === checksum
  ) {
    return previousIdentity;
  }
  return { intakeBatchId, checksum, key };
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
