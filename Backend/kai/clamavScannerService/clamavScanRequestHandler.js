// Framework-agnostic scanner-service handlers. These operate on already-read
// raw bytes and an injected clamd client - they never touch HTTP transport,
// route wiring, or listener setup, and never log or return raw scanned
// bytes, file names, or clamd/native infrastructure detail.

import { evaluateLoadedDefinitionFreshness } from "./loadedDefinitionState.js";
import { evaluateRecoveryEligibility } from "./loadedDefinitionRecovery.js";
import { computeLoadedStateFingerprint, createLivenessDecisionTelemetryRecorder } from "./clamavScannerTelemetry.js";

// Process-local default recorder: one liveness-decision transition log
// stream per scanner process, shared across repeated Cloud Run probe
// evaluations so identical decisions are not logged on every probe. Tests
// inject their own recorder instances instead of relying on this shared one.
const defaultLivenessTelemetryRecorder = createLivenessDecisionTelemetryRecorder();

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
// actually broken instance and fails liveness directly, with no clamd check
// needed. Otherwise - fresh or stale alike - a genuinely broken clamd always
// fails liveness on its own, before the mirror is ever read: a dead scanner
// justifies replacement regardless of definition freshness or mirror
// recoverability. Only once clamd is confirmed healthy does a stale loaded
// state go on to ask whether the authoritative mirror can be proven, via the
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
  telemetry = defaultLivenessTelemetryRecorder,
} = {}) {
  const freshness = loadedDefinitionFreshness({ loadedDefinitionState, maxAgeSeconds, now });
  const loadedStateFingerprint = computeLoadedStateFingerprint(loadedDefinitionState);
  const freshnessLabel = freshness.ok ? "fresh" : freshness.reason === "stale_loaded_definitions" ? "stale" : "invalid";
  const baseTelemetryFields = {
    loaded_state_fingerprint: loadedStateFingerprint,
    freshness: freshnessLabel,
    freshness_reason: freshness.reason ?? "not_applicable",
    age_seconds: freshness.age_seconds ?? null,
    max_age_seconds: freshness.max_age_seconds ?? null,
  };

  function record(fields) {
    telemetry?.record?.({ ...baseTelemetryFields, ...fields });
  }

  if (freshnessLabel === "invalid") {
    record({
      clamd: "not_checked",
      recovery_evaluated: "no",
      recovery_result: "not_applicable",
      recovery_reason: "not_applicable",
      mirror_state_fingerprint: "not_applicable",
      liveness: "not_live",
      decision_reason: "invalid_loaded_state",
    });
    return { httpStatus: 503, body: { status: "not_live" } };
  }

  if (!clamdClient || typeof clamdClient.checkReadiness !== "function") {
    record({
      clamd: "unhealthy",
      recovery_evaluated: "no",
      recovery_result: "not_applicable",
      recovery_reason: "not_applicable",
      mirror_state_fingerprint: "not_applicable",
      liveness: "not_live",
      decision_reason: "clamd_unhealthy",
    });
    return { httpStatus: 503, body: { status: "not_live" } };
  }
  let readiness;
  try {
    readiness = await clamdClient.checkReadiness();
  } catch {
    readiness = { ready: false };
  }
  if (readiness?.ready !== true) {
    record({
      clamd: "unhealthy",
      recovery_evaluated: "no",
      recovery_result: "not_applicable",
      recovery_reason: "not_applicable",
      mirror_state_fingerprint: "not_applicable",
      liveness: "not_live",
      decision_reason: "clamd_unhealthy",
    });
    return { httpStatus: 503, body: { status: "not_live" } };
  }

  if (freshness.ok) {
    record({
      clamd: "healthy",
      recovery_evaluated: "no",
      recovery_result: "not_applicable",
      recovery_reason: "not_applicable",
      mirror_state_fingerprint: "not_applicable",
      liveness: "live",
      decision_reason: "fresh_loaded_state_healthy",
    });
    return { httpStatus: 200, body: { status: "live" } };
  }

  const recovery = await evaluateRecoveryEligibility({
    loadedState: loadedDefinitionState,
    store: definitionStore,
    maxAgeSeconds,
    now,
    ...(mirrorLookupTimeoutMs === undefined ? {} : { mirrorLookupTimeoutMs }),
  });
  const recoveryResult =
    recovery.recoverable === "YES" ? "recoverable" : recovery.recoverable === "NO" ? "not_recoverable" : "not_proven";
  const decisionReason =
    recovery.recoverable === "YES"
      ? "stale_loaded_state_recoverable"
      : recovery.recoverable === "NO"
        ? "stale_loaded_state_not_recoverable"
        : "stale_loaded_state_recovery_not_proven";
  const liveness = recovery.recoverable === "YES" ? "not_live" : "live";

  record({
    clamd: "healthy",
    recovery_evaluated: "yes",
    recovery_result: recoveryResult,
    recovery_reason: recovery.reason ?? "not_applicable",
    mirror_state_fingerprint: recovery.mirrorStateFingerprint ?? "not_applicable",
    liveness,
    decision_reason: decisionReason,
  });

  if (recovery.recoverable === "YES") return { httpStatus: 503, body: { status: "not_live" } };
  return { httpStatus: 200, body: { status: "live" } };
}
