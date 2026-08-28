import { compareDefinitionStates, manifestFromPointer, validateDefinitionManifest } from "./clamavDefinitionMirror.js";
import { computeManifestFingerprint } from "./clamavScannerTelemetry.js";

// /livez must never hang on this lookup: a slow or wedged mirror read would
// otherwise keep the recovery-aware liveness request open indefinitely,
// causing the exact false liveness failure this check was designed to
// avoid. This bounds only the recovery-evaluator's own wait; it does not
// cancel the underlying mirror read.
export const DEFAULT_MIRROR_LOOKUP_TIMEOUT_MS = 5000;

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("mirror_lookup_timed_out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Turns this instance's loaded state into a manifest-shaped object so it can
// be fed through the existing Package 1 per-database semantic comparator
// without duplicating that comparison logic here. Filenames are synthesized
// only to satisfy the manifest shape - compareDefinitionStates keys off
// `database`, `metadata.version`, and `sha256`, never off filename.
function manifestFromLoadedState(loadedState) {
  if (!loadedState || typeof loadedState !== "object") return null;
  const databases = loadedState.databases;
  if (!databases || typeof databases !== "object") return null;

  const artifacts = [];
  for (const [database, info] of Object.entries(databases)) {
    if (!info || typeof info.version !== "string" || typeof info.sha256 !== "string") return null;
    artifacts.push({
      filename: `${database}.cvd`,
      database,
      sha256: info.sha256,
      metadata: { version: info.version },
    });
  }
  if (artifacts.length === 0) return null;

  return { generation: loadedState.generation, artifacts };
}

// Recovery is only ever proven, never assumed. Any unreadable, malformed, or
// stale mirror state - or a comparison the semantic model itself cannot
// resolve - leaves replacement NOT proven, exactly like an ambiguous/regressive/
// equivalent mirror. Only a structurally valid, fresh mirror that the
// existing Package 1 comparator calls strictly NEWER than the loaded state
// counts as recoverable. The mirror's storage generation identifier is used
// for diagnostics only and never substitutes for that semantic comparison.
export async function evaluateRecoveryEligibility({
  loadedState,
  store,
  maxAgeSeconds,
  now = new Date(),
  mirrorLookupTimeoutMs = DEFAULT_MIRROR_LOOKUP_TIMEOUT_MS,
} = {}) {
  const loadedManifest = manifestFromLoadedState(loadedState);
  if (!loadedManifest) return { recoverable: "NOT_PROVEN", reason: "malformed_loaded_state" };

  if (!store || typeof store.readCurrent !== "function") {
    return { recoverable: "NOT_PROVEN", reason: "definition_store_unavailable" };
  }

  let current;
  try {
    current = await withTimeout(store.readCurrent(), mirrorLookupTimeoutMs);
  } catch {
    return { recoverable: "NOT_PROVEN", reason: "mirror_read_failed" };
  }
  if (!current?.exists || !current.pointer) {
    return { recoverable: "NOT_PROVEN", reason: "mirror_missing_pointer" };
  }

  const currentManifest = manifestFromPointer(current.pointer);
  if (!currentManifest) return { recoverable: "NOT_PROVEN", reason: "mirror_malformed_pointer" };

  // Derived from the manifest already read above for the existing recovery
  // comparison - never an additional mirror read. Telemetry correlation only,
  // never a substitute for the semantic comparison below.
  const mirrorStateFingerprint = computeManifestFingerprint(currentManifest);

  const validation = validateDefinitionManifest(currentManifest, { maxAgeSeconds, now });
  if (!validation.ok) return { recoverable: "NOT_PROVEN", reason: `mirror_${validation.reason}`, mirrorStateFingerprint };

  const ordering = compareDefinitionStates(currentManifest, loadedManifest);
  if (ordering === "NEWER") return { recoverable: "YES", ordering, mirrorStateFingerprint };
  return { recoverable: "NO", ordering, mirrorStateFingerprint };
}

export const __testables = Object.freeze({
  manifestFromLoadedState,
});
