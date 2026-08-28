// Framework-agnostic scanner-service handlers. These operate on already-read
// raw bytes and an injected clamd client - they never touch HTTP transport,
// route wiring, or listener setup, and never log or return raw scanned
// bytes, file names, or clamd/native infrastructure detail.

import { evaluateLoadedDefinitionFreshness } from "./loadedDefinitionState.js";
import { evaluateRecoveryEligibility } from "./loadedDefinitionRecovery.js";

function errorResponse(httpStatus, reason) {
  return { httpStatus, body: { status: "error", reason } };
}

function loadedDefinitionFreshness({ loadedDefinitionState, maxAgeSeconds, now }) {
  return evaluateLoadedDefinitionFreshness({ loadedDefinitionState, maxAgeSeconds, now });
}

// Primary security invariant: this instance's own loaded-definition state
// must exist and be fresh before clamd is ever contacted. Never reads the
// current mirror pointer here - that would let a fresh mirror stand in for
// definitions this clamd process never actually loaded.
export async function handleClamavScanRequest({
  bytes,
  clamdClient,
  maxBytes,
  loadedDefinitionState,
  maxAgeSeconds,
  now = new Date(),
} = {}) {
  if (!(bytes instanceof Uint8Array)) return errorResponse(400, "invalid_body");
  if (Number.isSafeInteger(maxBytes) && bytes.byteLength > maxBytes) {
    return errorResponse(413, "oversized_input");
  }

  const freshness = loadedDefinitionFreshness({ loadedDefinitionState, maxAgeSeconds, now });
  if (!freshness.ok) return errorResponse(503, "scanner_unavailable");

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

// Readiness evaluates only this instance's loaded state, never the mirror -
// a fresh mirror never makes a stale-loaded instance ready.
export async function handleClamavReadinessRequest({
  clamdClient,
  loadedDefinitionState,
  maxAgeSeconds,
  now = new Date(),
} = {}) {
  const freshness = loadedDefinitionFreshness({ loadedDefinitionState, maxAgeSeconds, now });
  if (!freshness.ok) return { httpStatus: 503, body: { status: "not_ready" } };

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

// Recovery-aware liveness. A missing/malformed loaded state signals an
// actually broken instance and fails liveness directly. A stale loaded state
// only fails liveness when the authoritative mirror can be proven, via the
// existing Package 1 semantic comparator, to be strictly newer than what
// this instance loaded - never merely because the mirror's storage
// generation differs. Otherwise liveness stays healthy so Cloud Run never
// recycles an instance that a replacement could not actually improve.
export async function handleClamavLivenessRequest({
  clamdClient,
  loadedDefinitionState,
  maxAgeSeconds,
  definitionStore,
  now = new Date(),
  mirrorLookupTimeoutMs,
} = {}) {
  const freshness = loadedDefinitionFreshness({ loadedDefinitionState, maxAgeSeconds, now });

  if (freshness.ok) {
    if (!clamdClient || typeof clamdClient.checkReadiness !== "function") {
      return { httpStatus: 503, body: { status: "not_live" } };
    }
    let readiness;
    try {
      readiness = await clamdClient.checkReadiness();
    } catch {
      return { httpStatus: 503, body: { status: "not_live" } };
    }
    if (readiness?.ready === true) return { httpStatus: 200, body: { status: "live" } };
    return { httpStatus: 503, body: { status: "not_live" } };
  }

  if (freshness.reason !== "stale_loaded_definitions") {
    return { httpStatus: 503, body: { status: "not_live" } };
  }

  const recovery = await evaluateRecoveryEligibility({
    loadedState: loadedDefinitionState,
    store: definitionStore,
    maxAgeSeconds,
    now,
    ...(mirrorLookupTimeoutMs === undefined ? {} : { mirrorLookupTimeoutMs }),
  });
  if (recovery.recoverable === "YES") return { httpStatus: 503, body: { status: "not_live" } };
  return { httpStatus: 200, body: { status: "live" } };
}
