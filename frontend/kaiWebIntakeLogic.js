export const BASE_PATH = "/api/kai/sprint2/intake";

export function organizationsPath() {
  return `${BASE_PATH}/admin/organizations`;
}

export function engagementsPath(organizationId) {
  return `${BASE_PATH}/admin/organizations/${encodeURIComponent(organizationId)}/engagements`;
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

export function fileExtensionOf(filename) {
  const match = /\.[^.]+$/.exec(filename || "");
  return match ? match[0].toLowerCase() : "";
}

export function errorText(result) {
  return result?.body?.error?.message || `Request failed (${result?.statusCode ?? "unknown"}).`;
}

export function normalizeBatchCode(batchCode) {
  return String(batchCode || "").trim();
}

function stableIdempotencyKey(control, identityParts) {
  const identity = JSON.stringify(identityParts);
  if (control.current?.identity === identity) return control.current.idempotencyKey;
  const idempotencyKey = crypto.randomUUID();
  control.current = { identity, idempotencyKey };
  return idempotencyKey;
}

export function stableBatchIdempotencyKey(control, { organizationId, engagementId, batchCode }) {
  return stableIdempotencyKey(control, {
    organization_id: organizationId,
    engagement_id: engagementId,
    batch_code: normalizeBatchCode(batchCode),
  });
}

export function createBatchRequestBody(control, { organizationId, engagementId, batchCode }) {
  const normalizedBatchCode = normalizeBatchCode(batchCode);
  return {
    organization_id: organizationId,
    engagement_id: engagementId,
    batch_code: normalizedBatchCode,
    idempotency_key: stableBatchIdempotencyKey(control, {
      organizationId,
      engagementId,
      batchCode: normalizedBatchCode,
    }),
    intake_method: "manual_upload",
  };
}

export function stableFileReservationIdempotencyKey(control, {
  organizationId,
  engagementId,
  intakeBatchId,
  originalFilename,
  fileExtension,
  mimeType,
  fileSizeBytes,
  checksum,
  hashAlgorithm,
}) {
  return stableIdempotencyKey(control, {
    organization_id: organizationId,
    engagement_id: engagementId,
    intake_batch_id: intakeBatchId,
    original_filename: originalFilename,
    file_extension: fileExtension,
    mime_type: mimeType,
    file_size_bytes: fileSizeBytes,
    checksum,
    hash_algorithm: hashAlgorithm,
  });
}

export function fileReservationRequestBody(control, {
  organizationId,
  engagementId,
  intakeBatchId,
  originalFilename,
  fileExtension,
  mimeType,
  fileSizeBytes,
  checksum,
  hashAlgorithm,
}) {
  return {
    organization_id: organizationId,
    engagement_id: engagementId,
    original_filename: originalFilename,
    file_extension: fileExtension,
    mime_type: mimeType,
    file_size_bytes: fileSizeBytes,
    checksum,
    hash_algorithm: hashAlgorithm,
    idempotency_key: stableFileReservationIdempotencyKey(control, {
      organizationId,
      engagementId,
      intakeBatchId,
      originalFilename,
      fileExtension,
      mimeType,
      fileSizeBytes,
      checksum,
      hashAlgorithm,
    }),
  };
}
