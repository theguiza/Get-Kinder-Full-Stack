// Framework-agnostic scanner-service handlers. These operate on already-read
// raw bytes and an injected clamd client - they never touch HTTP transport,
// route wiring, or listener setup, and never log or return raw scanned
// bytes, file names, or clamd/native infrastructure detail.

function errorResponse(httpStatus, reason) {
  return { httpStatus, body: { status: "error", reason } };
}

export async function handleClamavScanRequest({ bytes, clamdClient, maxBytes } = {}) {
  if (!(bytes instanceof Uint8Array)) return errorResponse(400, "invalid_body");
  if (Number.isSafeInteger(maxBytes) && bytes.byteLength > maxBytes) {
    return errorResponse(413, "oversized_input");
  }
  if (!clamdClient || typeof clamdClient.scanBytes !== "function") {
    return errorResponse(503, "scanner_unavailable");
  }

  let result;
  try {
    result = await clamdClient.scanBytes(bytes);
  } catch {
    return errorResponse(502, "scanner_failure");
  }

  if (result?.status === "clean") return { httpStatus: 200, body: { status: "clean" } };
  if (result?.status === "found") return { httpStatus: 200, body: { status: "found" } };
  return errorResponse(502, "scanner_failure");
}

export async function handleClamavReadinessRequest({ clamdClient } = {}) {
  if (!clamdClient || typeof clamdClient.checkReadiness !== "function") {
    return { httpStatus: 503, body: { status: "not_ready" } };
  }

  let readiness;
  try {
    readiness = await clamdClient.checkReadiness();
  } catch {
    return { httpStatus: 503, body: { status: "not_ready" } };
  }

  if (readiness?.ready === true) return { httpStatus: 200, body: { status: "ready" } };
  return { httpStatus: 503, body: { status: "not_ready" } };
}
