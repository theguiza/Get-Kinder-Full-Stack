// Observability-only structured lifecycle telemetry for the ClamAV scanner
// container. Emits exactly one single-line JSON object per lifecycle event
// to stdout so Cloud Logging can correlate it with the platform's own
// per-instance metadata. Never emits raw storage paths, credentials,
// environment values, or definition bytes - only deterministic, non-secret
// fingerprints derived from already-computed loaded/mirror state, plus the
// already-known per-database semantic versions and timestamps.
//
// This module never changes freshness, recovery, scan, readiness, or
// liveness behavior - it only records facts about decisions already made
// elsewhere.
import { createHash } from "node:crypto";

const COMPONENT = "kai_clamav_scanner";
const TELEMETRY_SCHEMA = 1;

function emit(event, fields, logger = console) {
  logger.log(JSON.stringify({ component: COMPONENT, telemetry_schema: TELEMETRY_SCHEMA, event, ...fields }));
}

function normalizedEntries(entries) {
  return entries.slice().sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function fingerprintFromEntries(generation, entries) {
  const canonical = JSON.stringify({ generation, databases: normalizedEntries(entries) });
  return createHash("sha256").update(canonical).digest("hex");
}

// Deterministic, non-reversible identity for this instance's own loaded
// definition state. Changes whenever the meaningful loaded identity changes
// (generation, per-database version, or per-database checksum); never
// exposes the raw generation id (a storage path segment) or checksums
// directly.
export function computeLoadedStateFingerprint(loadedState) {
  if (!loadedState || typeof loadedState !== "object") return null;
  const databases = loadedState.databases;
  if (!databases || typeof databases !== "object") return null;
  const entries = Object.entries(databases).map(([database, info]) => [
    database,
    typeof info?.version === "string" ? info.version : null,
    typeof info?.sha256 === "string" ? info.sha256 : null,
  ]);
  if (entries.length === 0) return null;
  return fingerprintFromEntries(loadedState.generation, entries);
}

// Same fingerprint scheme applied to an already-read, already-parsed mirror
// manifest, so a mirror state can be compared to a loaded state fingerprint
// without ever logging the mirror's raw generation id or object paths.
export function computeManifestFingerprint(manifest) {
  if (!manifest || !Array.isArray(manifest.artifacts)) return null;
  const entries = manifest.artifacts.map((artifact) => [
    artifact?.database,
    typeof artifact?.metadata?.version === "string" ? artifact.metadata.version : null,
    typeof artifact?.sha256 === "string" ? artifact.sha256 : null,
  ]);
  if (entries.length === 0 || entries.some(([database]) => typeof database !== "string")) return null;
  return fingerprintFromEntries(manifest.generation, entries);
}

// Emitted once, at the smallest point where a loaded-definition state has
// been successfully finalized after clamd readiness was already confirmed.
// Never emitted for a failed finalization.
export function emitLoadedStateFinalizedTelemetry({ loadedState, logger = console } = {}) {
  const fingerprint = computeLoadedStateFingerprint(loadedState);
  if (!fingerprint) return;

  const databases = loadedState.databases || {};
  emit(
    "clamav_loaded_state_finalized",
    {
      loaded_state_fingerprint: fingerprint,
      controlling_build_timestamp: loadedState.controlling_build_timestamp,
      loaded_at: loadedState.loaded_at,
      main_version: typeof databases.main?.version === "string" ? databases.main.version : null,
      daily_version: typeof databases.daily?.version === "string" ? databases.daily.version : null,
      bytecode_version: typeof databases.bytecode?.version === "string" ? databases.bytecode.version : null,
    },
    logger,
  );
}

// Process-local liveness-decision transition recorder. Suppresses repeated
// identical decision states (the Cloud Run liveness probe re-evaluates this
// continuously) while still emitting a fresh event whenever the meaningful
// decision changes. Purely local bookkeeping for log volume - it never
// persists across process replacement and never affects the liveness
// decision itself.
export function createLivenessDecisionTelemetryRecorder({ logger = console } = {}) {
  let lastTransitionKey = null;
  return {
    record(fields) {
      const transitionKey = JSON.stringify([
        fields.freshness,
        fields.clamd,
        fields.recovery_evaluated,
        fields.recovery_result,
        fields.liveness,
        fields.decision_reason,
      ]);
      if (transitionKey === lastTransitionKey) return;
      lastTransitionKey = transitionKey;
      emit("clamav_liveness_decision", fields, logger);
    },
  };
}

export const __testables = Object.freeze({
  fingerprintFromEntries,
});
