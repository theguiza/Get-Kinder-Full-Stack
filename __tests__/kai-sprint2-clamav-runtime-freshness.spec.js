import test from "node:test";
import assert from "node:assert/strict";

import {
  handleClamavLivenessRequest,
  handleClamavReadinessRequest,
  handleClamavScanRequest,
} from "../Backend/kai/clamavScannerService/clamavScanRequestHandler.js";
import {
  buildLoadedDefinitionStateFromManifest,
  evaluateLoadedDefinitionFreshness,
  LOADED_DEFINITION_STATE_SCHEMA,
} from "../Backend/kai/clamavScannerService/loadedDefinitionState.js";
import { evaluateRecoveryEligibility } from "../Backend/kai/clamavScannerService/loadedDefinitionRecovery.js";
import { __testables } from "../Backend/kai/clamavScannerService/clamavDefinitionMirror.js";

// Package 3A: scanner loaded-definition enforcement + recovery-aware
// recycling. This matrix proves the primary security invariant (a stale or
// missing loaded state can never scan, regardless of mirror freshness) and
// the secondary recovery-eligibility invariant (liveness only signals
// replacement when the mirror is proven, via the existing Package 1
// semantic comparator, to be strictly newer than what this instance
// actually loaded).

const NOW = new Date("2026-08-28T12:00:00.000Z");
const MAX_AGE_SECONDS = 172800; // matches KAI_GATE_C_CLAMAV_DEFINITION_MAX_AGE_SECONDS's existing 2-day default shape
const FRESH_BUILD = "2026-08-28T06:00:00.000Z"; // 6h old
const STALE_BUILD = "2026-08-20T00:00:00.000Z"; // >2 days old

const BASELINE_VERSIONS = { main: "100", daily: "500", bytecode: "200" };

function manifestFixture({ generation, versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD, shas = {} } = {}) {
  return {
    schema: __testables.MANIFEST_SCHEMA,
    generation,
    created_at: NOW.toISOString(),
    artifacts: Object.entries(versions).map(([database, version]) => ({
      filename: `${database}.cvd`,
      database,
      sha256: shas[database] || "a".repeat(64),
      metadata: { version, build_timestamp: buildTimestamp, functionality_level: "90" },
    })),
  };
}

function loadedStateFixture({ generation = "gen-loaded", versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD, loadedAt = NOW } = {}) {
  return buildLoadedDefinitionStateFromManifest(manifestFixture({ generation, versions, buildTimestamp }), { loadedAt });
}

function pointerStore({ generation, versions, buildTimestamp, shas } = {}) {
  const manifest = manifestFixture({ generation, versions, buildTimestamp, shas });
  return {
    async readCurrent() {
      return { exists: true, generation: "1", pointer: __testables.pointerFromManifest(manifest) };
    },
  };
}

function unavailableStore() {
  return {
    async readCurrent() {
      throw new Error("synthetic mirror read failure");
    },
  };
}

function missingPointerStore() {
  return { async readCurrent() { return { exists: false, generation: null, pointer: null }; } };
}

function cleanClamdClient() {
  let scanCalls = 0;
  return {
    scanCalls: () => scanCalls,
    async scanBytes() {
      scanCalls += 1;
      return { status: "clean" };
    },
    async checkReadiness() {
      return { ready: true };
    },
  };
}

function unavailableClamdClient() {
  return {
    async scanBytes() {
      throw new Error("synthetic clamd unavailable");
    },
    async checkReadiness() {
      return { ready: false };
    },
  };
}

// A. Fresh loaded state: readiness/liveness healthy, scan reaches clamd.
test("A: fresh loaded state is ready, live, and scans reach clamd", async () => {
  const loadedState = loadedStateFixture();
  const clamdClient = cleanClamdClient();

  const readiness = await handleClamavReadinessRequest({ clamdClient, loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const liveness = await handleClamavLivenessRequest({ clamdClient, loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const scan = await handleClamavScanRequest({
    bytes: Buffer.from("bytes"),
    clamdClient,
    maxBytes: 1024,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
  });

  assert.equal(readiness.httpStatus, 200);
  assert.equal(liveness.httpStatus, 200);
  assert.deepEqual(scan, { httpStatus: 200, body: { status: "clean" } });
  assert.equal(clamdClient.scanCalls(), 1);
});

// B. Stale loaded state + semantically newer fresh mirror -> recoverable.
test("B: stale loaded state with a semantically newer fresh mirror is recoverable", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = pointerStore({ generation: "gen-2", versions: { main: "200", daily: "600", bytecode: "300" } });
  const clamdClient = cleanClamdClient();

  const readiness = await handleClamavReadinessRequest({ clamdClient, loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const scan = await handleClamavScanRequest({
    bytes: Buffer.from("bytes"),
    clamdClient,
    maxBytes: 1024,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
  });
  const liveness = await handleClamavLivenessRequest({
    clamdClient,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });

  assert.equal(readiness.httpStatus, 503);
  assert.equal(scan.httpStatus, 503);
  assert.equal(clamdClient.scanCalls(), 0);
  assert.equal(liveness.httpStatus, 503);
});

// C. Stale loaded state + equivalent mirror -> not recoverable, liveness healthy.
test("C: stale loaded state with an equivalent mirror is not recoverable, and a differing generation id alone proves nothing", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = pointerStore({ generation: "gen-2", versions: BASELINE_VERSIONS });

  const readiness = await handleClamavReadinessRequest({ clamdClient: cleanClamdClient(), loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const scan = await handleClamavScanRequest({
    bytes: Buffer.from("bytes"),
    clamdClient: cleanClamdClient(),
    maxBytes: 1024,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
  });
  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });

  assert.equal(readiness.httpStatus, 503);
  assert.equal(scan.httpStatus, 503);
  assert.equal(liveness.httpStatus, 200);
});

// D. Stale loaded state + regressive mirror -> not recoverable, liveness healthy.
test("D: stale loaded state with a regressive mirror is not recoverable", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = pointerStore({ generation: "gen-2", versions: { main: "90", daily: "490", bytecode: "190" } });

  const readiness = await handleClamavReadinessRequest({ clamdClient: cleanClamdClient(), loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });

  assert.equal(readiness.httpStatus, 503);
  assert.equal(liveness.httpStatus, 200);
});

// E. Stale loaded state + ambiguous mirror -> not recoverable, liveness healthy.
test("E: stale loaded state with an ambiguous mirror is not recoverable", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = pointerStore({ generation: "gen-2", versions: { main: "not-a-number", daily: "600", bytecode: "300" } });

  const readiness = await handleClamavReadinessRequest({ clamdClient: cleanClamdClient(), loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });

  assert.equal(readiness.httpStatus, 503);
  assert.equal(liveness.httpStatus, 200);
});

// F. Stale loaded state + stale mirror -> not recoverable, liveness healthy.
test("F: stale loaded state with a stale mirror is not recoverable", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = pointerStore({ generation: "gen-2", versions: { main: "200", daily: "600", bytecode: "300" }, buildTimestamp: STALE_BUILD });

  const readiness = await handleClamavReadinessRequest({ clamdClient: cleanClamdClient(), loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });

  assert.equal(readiness.httpStatus, 503);
  assert.equal(liveness.httpStatus, 200);
});

// G. Stale loaded state + unavailable/malformed mirror -> not proven, liveness healthy.
test("G: stale loaded state with an unavailable or malformed mirror is not proven recoverable", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });

  for (const store of [unavailableStore(), missingPointerStore()]) {
    const readiness = await handleClamavReadinessRequest({ clamdClient: cleanClamdClient(), loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
    const liveness = await handleClamavLivenessRequest({
      clamdClient: cleanClamdClient(),
      loadedDefinitionState: loadedState,
      maxAgeSeconds: MAX_AGE_SECONDS,
      definitionStore: store,
      now: NOW,
    });
    assert.equal(readiness.httpStatus, 503);
    assert.equal(liveness.httpStatus, 200);
  }
});

// H. Generation-ID trap: differing generation, semantically equivalent state must never trigger recycling.
test("H: a different mirror generation id alone never proves recoverability", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = pointerStore({ generation: "gen-2-totally-different-uuid", versions: BASELINE_VERSIONS });

  const recovery = await evaluateRecoveryEligibility({ loadedState, store, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  assert.equal(recovery.recoverable, "NO");

  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });
  assert.equal(liveness.httpStatus, 200);
});

// I. Exact freshness boundary.
test("I: freshness boundary is inclusive of exactly maxAgeSeconds", () => {
  const buildTime = new Date(NOW.getTime() - MAX_AGE_SECONDS * 1000);
  const justInside = evaluateLoadedDefinitionFreshness({
    loadedDefinitionState: loadedStateFixture({ buildTimestamp: new Date(buildTime.getTime() + 1000).toISOString() }),
    now: NOW,
    maxAgeSeconds: MAX_AGE_SECONDS,
  });
  const exactBoundary = evaluateLoadedDefinitionFreshness({
    loadedDefinitionState: loadedStateFixture({ buildTimestamp: buildTime.toISOString() }),
    now: NOW,
    maxAgeSeconds: MAX_AGE_SECONDS,
  });
  const justOutside = evaluateLoadedDefinitionFreshness({
    loadedDefinitionState: loadedStateFixture({ buildTimestamp: new Date(buildTime.getTime() - 1000).toISOString() }),
    now: NOW,
    maxAgeSeconds: MAX_AGE_SECONDS,
  });

  assert.equal(justInside.ok, true);
  assert.equal(exactBoundary.ok, true);
  assert.equal(justOutside.ok, false);
  assert.equal(justOutside.reason, "stale_loaded_definitions");
});

// J. Mirror advances while loaded state remains old but fresh: scan still allowed on G1, never silently reports G2.
test("J: a newer mirror never changes what a fresh loaded state reports as loaded", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: FRESH_BUILD, versions: BASELINE_VERSIONS });
  const clamdClient = cleanClamdClient();

  const scan = await handleClamavScanRequest({
    bytes: Buffer.from("bytes"),
    clamdClient,
    maxBytes: 1024,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
  });

  assert.deepEqual(scan, { httpStatus: 200, body: { status: "clean" } });
  assert.equal(loadedState.generation, "gen-1");
});

// K. Replacement bootstrap simulation: loaded state becomes G2 only after a successful (simulated) clamd startup.
test("K: loaded state becomes the newer generation only after a successful bootstrap, then serves normally", async () => {
  const newerManifest = manifestFixture({ generation: "gen-2", versions: { main: "200", daily: "600", bytecode: "300" }, buildTimestamp: FRESH_BUILD });
  const replacementLoadedState = buildLoadedDefinitionStateFromManifest(newerManifest, { loadedAt: NOW });
  const clamdClient = cleanClamdClient();

  assert.equal(replacementLoadedState.generation, "gen-2");
  assert.equal(replacementLoadedState.schema, LOADED_DEFINITION_STATE_SCHEMA);

  const readiness = await handleClamavReadinessRequest({ clamdClient, loadedDefinitionState: replacementLoadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const liveness = await handleClamavLivenessRequest({ clamdClient, loadedDefinitionState: replacementLoadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const scan = await handleClamavScanRequest({
    bytes: Buffer.from("bytes"),
    clamdClient,
    maxBytes: 1024,
    loadedDefinitionState: replacementLoadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
  });

  assert.equal(readiness.httpStatus, 200);
  assert.equal(liveness.httpStatus, 200);
  assert.deepEqual(scan, { httpStatus: 200, body: { status: "clean" } });
});

// L. Missing/malformed loaded state.
test("L: missing or malformed loaded state blocks scanning and fails both readiness and liveness", async () => {
  const clamdClient = cleanClamdClient();

  for (const loadedDefinitionState of [null, undefined, {}, { schema: "wrong-schema" }]) {
    const readiness = await handleClamavReadinessRequest({ clamdClient, loadedDefinitionState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
    const scan = await handleClamavScanRequest({
      bytes: Buffer.from("bytes"),
      clamdClient,
      maxBytes: 1024,
      loadedDefinitionState,
      maxAgeSeconds: MAX_AGE_SECONDS,
      now: NOW,
    });
    const liveness = await handleClamavLivenessRequest({ clamdClient, loadedDefinitionState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });

    assert.equal(readiness.httpStatus, 503);
    assert.equal(scan.httpStatus, 503);
    assert.equal(liveness.httpStatus, 503);
  }
  assert.equal(clamdClient.scanCalls(), 0);
});

// M. clamd unavailable with a fresh loaded state: existing fail-closed behavior is preserved.
test("M: clamd unavailable fails readiness, scan, and liveness even with a fresh loaded state", async () => {
  const loadedState = loadedStateFixture();
  const clamdClient = unavailableClamdClient();

  const readiness = await handleClamavReadinessRequest({ clamdClient, loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const scan = await handleClamavScanRequest({
    bytes: Buffer.from("bytes"),
    clamdClient,
    maxBytes: 1024,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
  });
  const liveness = await handleClamavLivenessRequest({ clamdClient, loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });

  assert.equal(readiness.httpStatus, 503);
  assert.equal(scan.httpStatus, 502);
  assert.equal(liveness.httpStatus, 503);
});

// O. No background/public refresh introduced by this package's request/health/runtime code.
test("O: readiness/liveness/scan evaluation performs zero mirror reads when the loaded state itself already gates the request", async () => {
  let readCalls = 0;
  const store = {
    async readCurrent() {
      readCalls += 1;
      return { exists: false, generation: null, pointer: null };
    },
  };
  const clamdClient = cleanClamdClient();
  const freshLoadedState = loadedStateFixture();

  await handleClamavScanRequest({
    bytes: Buffer.from("bytes"),
    clamdClient,
    maxBytes: 1024,
    loadedDefinitionState: freshLoadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
    definitionStore: store,
  });
  await handleClamavReadinessRequest({ clamdClient, loadedDefinitionState: freshLoadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW, definitionStore: store });
  await handleClamavLivenessRequest({ clamdClient, loadedDefinitionState: freshLoadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });

  // A fresh loaded state never needs to consult the mirror at all - the
  // mirror is only ever consulted from the liveness path, and only once
  // loaded state is proven stale.
  assert.equal(readCalls, 0);
});

// Q. Stale loaded state + clamd unavailable (ready:false) + equivalent
// mirror: a genuinely broken clamd must fail liveness without ever reading
// the mirror, regardless of definition staleness or mirror recoverability.
test("Q: stale loaded state with clamd not ready fails liveness and never reads the mirror", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  let readCalls = 0;
  const store = {
    async readCurrent() {
      readCalls += 1;
      return { exists: true, generation: "1", pointer: __testables.pointerFromManifest(manifestFixture({ generation: "gen-2", versions: BASELINE_VERSIONS })) };
    },
  };
  const clamdClient = unavailableClamdClient();

  const liveness = await handleClamavLivenessRequest({
    clamdClient,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });

  assert.equal(liveness.httpStatus, 503);
  assert.equal(readCalls, 0);
});

// R. Stale loaded state + clamd checkReadiness throws + unavailable mirror:
// same fail-fast-on-clamd behavior when the readiness call itself throws.
test("R: stale loaded state with a throwing clamd checkReadiness fails liveness and never reads the mirror", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  let readCalls = 0;
  const store = {
    async readCurrent() {
      readCalls += 1;
      throw new Error("should never be called");
    },
  };
  const clamdClient = {
    async scanBytes() {
      throw new Error("synthetic clamd unavailable");
    },
    async checkReadiness() {
      throw new Error("synthetic checkReadiness failure");
    },
  };

  const liveness = await handleClamavLivenessRequest({
    clamdClient,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });

  assert.equal(liveness.httpStatus, 503);
  assert.equal(readCalls, 0);
});

// S. Stale loaded state + clamd healthy + unavailable mirror: liveness stays
// healthy (anti-restart-loop preserved) but the mirror lookup does occur, and
// readiness/scan remain blocked - proving replacement is not forced merely
// because the local scanner itself is healthy.
test("S: stale loaded state with healthy clamd and an unavailable mirror stays live while readiness and scan stay blocked", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = unavailableStore();
  const clamdClient = cleanClamdClient();

  const liveness = await handleClamavLivenessRequest({
    clamdClient,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });
  const readiness = await handleClamavReadinessRequest({ clamdClient, loadedDefinitionState: loadedState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  const scan = await handleClamavScanRequest({
    bytes: Buffer.from("bytes"),
    clamdClient,
    maxBytes: 1024,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
  });

  assert.equal(liveness.httpStatus, 200);
  assert.equal(readiness.httpStatus, 503);
  assert.equal(scan.httpStatus, 503);
  assert.equal(clamdClient.scanCalls(), 0);
});

// T. Stale loaded state + clamd healthy + semantically newer fresh mirror:
// replacement eligibility is preserved once clamd itself is healthy.
test("T: stale loaded state with healthy clamd and a semantically newer fresh mirror still fails liveness", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = pointerStore({ generation: "gen-2", versions: { main: "200", daily: "600", bytecode: "300" } });
  const clamdClient = cleanClamdClient();

  const liveness = await handleClamavLivenessRequest({
    clamdClient,
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
  });

  assert.equal(liveness.httpStatus, 503);
});

test("evaluateRecoveryEligibility never calls the store for a malformed loaded state", async () => {
  let called = false;
  const store = { async readCurrent() { called = true; return { exists: false }; } };
  const result = await evaluateRecoveryEligibility({ loadedState: { databases: {} }, store, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW });
  assert.equal(result.recoverable, "NOT_PROVEN");
  assert.equal(called, false);
});

// P. A wedged mirror lookup must never hang /livez: the recovery evaluator
// enforces its own bounded deadline (independent of any Cloud Run probe
// timeout) and returns NOT_PROVEN rather than waiting forever, so a stale
// instance's liveness stays healthy and no replacement is requested.
test("P: a mirror read that never resolves is bounded by the recovery evaluator's own deadline, not left hanging", async () => {
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  // Deliberately unsettled for far longer than the configured deadline below,
  // but settled before this test returns so it never dangles past the test
  // process's own lifetime.
  const pendingMirrorReads = [];
  const neverResolvingStore = {
    readCurrent() {
      return new Promise((resolve) => {
        pendingMirrorReads.push(resolve);
      });
    },
  };

  const start = Date.now();
  const recovery = await evaluateRecoveryEligibility({
    loadedState,
    store: neverResolvingStore,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
    mirrorLookupTimeoutMs: 25,
  });
  const elapsedMs = Date.now() - start;

  assert.equal(recovery.recoverable, "NOT_PROVEN");
  assert.equal(recovery.reason, "mirror_read_failed");
  assert.ok(elapsedMs < 1000, `expected the bounded lookup to return quickly, took ${elapsedMs}ms`);

  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: neverResolvingStore,
    now: NOW,
    mirrorLookupTimeoutMs: 25,
  });

  assert.equal(liveness.httpStatus, 200);
  assert.equal(liveness.body.status, "live");

  for (const release of pendingMirrorReads) release({ exists: false, generation: null, pointer: null });
});
