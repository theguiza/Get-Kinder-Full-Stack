import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Per-instance record of the exact, validated definition set this process's
// clamd actually started against. Distinct from the mirror's current-pointer
// manifest: this state changes only when a new clamd process is confirmed
// running against a newly bootstrapped generation, never on a background
// timer and never by re-reading the mirror on the scan path.
export const LOADED_DEFINITION_STATE_SCHEMA = "kai_gate_c_clamav_loaded_definition_state_v1";

function pendingPathFor(filePath) {
  return `${filePath}.pending`;
}

// Built only from a manifest that has already passed
// validateDefinitionManifest and whose artifacts were installed into the
// directory clamd loads from - never from raw mirror/GCS metadata.
export function buildLoadedDefinitionStateFromManifest(manifest, { loadedAt = new Date() } = {}) {
  if (!manifest || typeof manifest.generation !== "string" || !Array.isArray(manifest.artifacts)) {
    throw new Error("Cannot build loaded definition state from a malformed manifest.");
  }

  const databases = {};
  let controllingBuildTimestamp = null;
  for (const artifact of manifest.artifacts) {
    if (typeof artifact?.database !== "string" || typeof artifact?.sha256 !== "string") {
      throw new Error("Cannot build loaded definition state from a malformed manifest artifact.");
    }
    const version = artifact.metadata?.version;
    if (typeof version !== "string" || version.length === 0) {
      throw new Error("Cannot build loaded definition state without per-database version metadata.");
    }
    databases[artifact.database] = { version, sha256: artifact.sha256 };

    const buildTime = new Date(artifact.metadata?.build_timestamp);
    if (Number.isNaN(buildTime.getTime())) {
      throw new Error("Cannot build loaded definition state without per-database build timestamp metadata.");
    }
    if (!controllingBuildTimestamp || buildTime > new Date(controllingBuildTimestamp)) {
      controllingBuildTimestamp = buildTime.toISOString();
    }
  }

  const loadedAtDate = loadedAt instanceof Date ? loadedAt : new Date(loadedAt);
  if (Number.isNaN(loadedAtDate.getTime())) {
    throw new Error("Cannot build loaded definition state with a malformed loadedAt.");
  }

  return {
    schema: LOADED_DEFINITION_STATE_SCHEMA,
    generation: manifest.generation,
    controlling_build_timestamp: controllingBuildTimestamp,
    databases,
    loaded_at: loadedAtDate.toISOString(),
  };
}

// Reuses the same boundary-inclusive age predicate as
// validateDefinitionManifest's freshness check (age in [0, maxAgeSeconds]),
// applied to the loaded state's own controlling build timestamp instead of a
// mirror candidate's. Fails closed for anything but a well-formed, in-range
// state.
export function evaluateLoadedDefinitionFreshness({ loadedDefinitionState, now = new Date(), maxAgeSeconds } = {}) {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    return { ok: false, reason: "missing_or_invalid_max_age" };
  }
  if (!loadedDefinitionState || typeof loadedDefinitionState !== "object") {
    return { ok: false, reason: "missing_loaded_state" };
  }
  if (loadedDefinitionState.schema !== LOADED_DEFINITION_STATE_SCHEMA) {
    return { ok: false, reason: "malformed_loaded_state" };
  }

  const buildTimestamp = loadedDefinitionState.controlling_build_timestamp;
  const buildTime = new Date(buildTimestamp);
  if (typeof buildTimestamp !== "string" || Number.isNaN(buildTime.getTime())) {
    return { ok: false, reason: "malformed_loaded_state" };
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    return { ok: false, reason: "malformed_loaded_state" };
  }

  const ageSeconds = (nowDate.getTime() - buildTime.getTime()) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return { ok: false, reason: "malformed_loaded_state", age_seconds: ageSeconds, max_age_seconds: maxAgeSeconds };
  }
  if (ageSeconds > maxAgeSeconds) {
    return { ok: false, reason: "stale_loaded_definitions", age_seconds: ageSeconds, max_age_seconds: maxAgeSeconds };
  }
  return { ok: true, age_seconds: ageSeconds, max_age_seconds: maxAgeSeconds };
}

// Written by the bootstrap step once artifacts are installed, before clamd
// has been confirmed running against them. Never read by the HTTP scan path.
export async function writePendingLoadedDefinitionState({ filePath, state }) {
  const pendingPath = pendingPathFor(filePath);
  await mkdir(path.dirname(pendingPath), { recursive: true });
  await writeFile(pendingPath, JSON.stringify(state), { encoding: "utf8" });
  return { ok: true };
}

// Called only after the entrypoint has independently confirmed clamd is
// responding against the installed artifacts. Promotes the pending state to
// the path the HTTP service reads at startup. Fails closed (does not create
// a final state) if no pending state was recorded.
export async function finalizeLoadedDefinitionState({ filePath }) {
  const pendingPath = pendingPathFor(filePath);
  try {
    await rename(pendingPath, filePath);
    return { ok: true };
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, reason: "missing_pending_loaded_state" };
    return { ok: false, reason: "loaded_state_finalization_failed" };
  }
}

export async function readLoadedDefinitionState({ filePath }) {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== LOADED_DEFINITION_STATE_SCHEMA) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const __testables = Object.freeze({
  pendingPathFor,
});
