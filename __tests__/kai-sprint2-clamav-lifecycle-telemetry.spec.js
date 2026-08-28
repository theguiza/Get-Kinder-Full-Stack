import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";

import { handleClamavLivenessRequest } from "../Backend/kai/clamavScannerService/clamavScanRequestHandler.js";
import { createClamavScannerHttpApp } from "../Backend/kai/clamavScannerService/server.js";
import { buildLoadedDefinitionStateFromManifest } from "../Backend/kai/clamavScannerService/loadedDefinitionState.js";
import {
  computeLoadedStateFingerprint,
  createLivenessDecisionTelemetryRecorder,
  emitLoadedStateFinalizedTelemetry,
} from "../Backend/kai/clamavScannerService/clamavScannerTelemetry.js";
import { __testables } from "../Backend/kai/clamavScannerService/clamavDefinitionMirror.js";

// Package 3D: minimum structured lifecycle telemetry proving stale-instance
// recycling actually happened, without changing scan/readiness/liveness
// behavior or the HTTP response contract.

const NOW = new Date("2026-08-28T12:00:00.000Z");
const MAX_AGE_SECONDS = 172800;
const FRESH_BUILD = "2026-08-28T06:00:00.000Z";
const STALE_BUILD = "2026-08-20T00:00:00.000Z";
const RAW_SHA = "a".repeat(64);
const BASELINE_VERSIONS = { main: "100", daily: "500", bytecode: "200" };

function manifestFixture({ generation, versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD } = {}) {
  return {
    schema: __testables.MANIFEST_SCHEMA,
    generation,
    created_at: NOW.toISOString(),
    artifacts: Object.entries(versions).map(([database, version]) => ({
      filename: `${database}.cvd`,
      database,
      sha256: RAW_SHA,
      metadata: { version, build_timestamp: buildTimestamp, functionality_level: "90" },
    })),
  };
}

function loadedStateFixture({ generation = "gen-loaded", versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD, loadedAt = NOW } = {}) {
  return buildLoadedDefinitionStateFromManifest(manifestFixture({ generation, versions, buildTimestamp }), { loadedAt });
}

function pointerStore({ generation, versions, buildTimestamp } = {}) {
  const manifest = manifestFixture({ generation, versions, buildTimestamp });
  return { async readCurrent() { return { exists: true, generation: "1", pointer: __testables.pointerFromManifest(manifest) }; } };
}

function unavailableStore() {
  return { async readCurrent() { throw new Error("synthetic mirror read failure"); } };
}

function cleanClamdClient() {
  return {
    async scanBytes() { return { status: "clean" }; },
    async checkReadiness() { return { ready: true }; },
  };
}

function deadClamdClient() {
  return {
    async scanBytes() { throw new Error("synthetic clamd unavailable"); },
    async checkReadiness() { return { ready: false }; },
  };
}

function capturingLogger() {
  const lines = [];
  return { logger: { log: (line) => lines.push(line) }, entries: () => lines.map((line) => JSON.parse(line)) };
}

// A/C: successful finalization emits exactly one event with the required fields.
test("A/C: successful loaded-state finalization emits exactly one structured event with correlation fields", () => {
  const { logger, entries } = capturingLogger();
  const loadedState = loadedStateFixture();

  emitLoadedStateFinalizedTelemetry({ loadedState, logger });

  const events = entries();
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.component, "kai_clamav_scanner");
  assert.equal(event.event, "clamav_loaded_state_finalized");
  assert.equal(typeof event.loaded_state_fingerprint, "string");
  assert.ok(event.loaded_state_fingerprint.length > 0);
  assert.equal(event.controlling_build_timestamp, loadedState.controlling_build_timestamp);
  assert.equal(event.loaded_at, loadedState.loaded_at);
  assert.equal(event.main_version, "100");
  assert.equal(event.daily_version, "500");
  assert.equal(event.bytecode_version, "200");
});

// B: failed/malformed finalization emits nothing.
test("B: malformed or missing loaded state emits no successful-finalization event", () => {
  const { logger, entries } = capturingLogger();

  for (const loadedState of [null, undefined, {}, { schema: "wrong" }, { databases: {} }]) {
    emitLoadedStateFinalizedTelemetry({ loadedState, logger });
  }

  assert.equal(entries().length, 0);
});

// D: no raw storage paths, credentials, environment values, or raw definition bytes.
test("D: finalization telemetry never leaks raw checksums, storage paths, or environment values", () => {
  const { logger, entries } = capturingLogger();
  const loadedState = loadedStateFixture({ generation: "gen-loaded-secret-path-id" });

  emitLoadedStateFinalizedTelemetry({ loadedState, logger });

  const [event] = entries();
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /gen-loaded-secret-path-id/);
  assert.doesNotMatch(serialized, new RegExp(RAW_SHA));
  assert.doesNotMatch(serialized, /generations\//);
  assert.doesNotMatch(serialized, /gs:\/\//);
  assert.doesNotMatch(serialized, /DATABASE_URL|process\.env/);
});

// Deterministic + identity-sensitive fingerprint.
test("fingerprint is deterministic and changes only when loaded identity changes", () => {
  const a = computeLoadedStateFingerprint(loadedStateFixture({ generation: "gen-1" }));
  const aAgain = computeLoadedStateFingerprint(loadedStateFixture({ generation: "gen-1" }));
  const differentGeneration = computeLoadedStateFingerprint(loadedStateFixture({ generation: "gen-2" }));
  const differentVersion = computeLoadedStateFingerprint(
    loadedStateFixture({ generation: "gen-1", versions: { main: "999", daily: "500", bytecode: "200" } }),
  );

  assert.equal(a, aAgain);
  assert.notEqual(a, differentGeneration);
  assert.notEqual(a, differentVersion);
});

// E: fresh + healthy clamd.
test("E: fresh healthy liveness emits fresh_loaded_state_healthy", async () => {
  const { logger, entries } = capturingLogger();
  const telemetry = createLivenessDecisionTelemetryRecorder({ logger });
  const loadedState = loadedStateFixture();

  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: NOW,
    telemetry,
  });

  assert.equal(liveness.httpStatus, 200);
  const [event] = entries();
  assert.equal(event.event, "clamav_liveness_decision");
  assert.equal(event.freshness, "fresh");
  assert.equal(event.clamd, "healthy");
  assert.equal(event.recovery_evaluated, "no");
  assert.equal(event.liveness, "live");
  assert.equal(event.decision_reason, "fresh_loaded_state_healthy");
});

// F: stale + healthy clamd + unavailable mirror -> not proven, still live.
test("F: stale with an unavailable mirror emits live + not_proven", async () => {
  const { logger, entries } = capturingLogger();
  const telemetry = createLivenessDecisionTelemetryRecorder({ logger });
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });

  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: unavailableStore(),
    now: NOW,
    telemetry,
  });

  assert.equal(liveness.httpStatus, 200);
  const [event] = entries();
  assert.equal(event.freshness, "stale");
  assert.equal(event.recovery_evaluated, "yes");
  assert.equal(event.recovery_result, "not_proven");
  assert.equal(event.liveness, "live");
  assert.equal(event.decision_reason, "stale_loaded_state_recovery_not_proven");
  assert.equal(event.mirror_state_fingerprint, "not_applicable");
});

// G: stale + healthy clamd + semantically newer fresh mirror -> recoverable, not live.
test("G: stale with a semantically newer fresh mirror emits not_live + recoverable and a real mirror fingerprint", async () => {
  const { logger, entries } = capturingLogger();
  const telemetry = createLivenessDecisionTelemetryRecorder({ logger });
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const store = pointerStore({ generation: "gen-2", versions: { main: "200", daily: "600", bytecode: "300" } });

  const liveness = await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
    telemetry,
  });

  assert.equal(liveness.httpStatus, 503);
  assert.equal(liveness.body.status, "not_live");
  const [event] = entries();
  assert.equal(event.recovery_result, "recoverable");
  assert.equal(event.liveness, "not_live");
  assert.equal(event.decision_reason, "stale_loaded_state_recoverable");
  assert.equal(typeof event.mirror_state_fingerprint, "string");
  assert.ok(event.mirror_state_fingerprint.length > 0);
  assert.notEqual(event.mirror_state_fingerprint, event.loaded_state_fingerprint);
});

// H: stale + dead clamd -> not_live + clamd_unhealthy, zero mirror reads.
test("H: stale with dead clamd emits clamd_unhealthy and performs zero mirror reads", async () => {
  const { logger, entries } = capturingLogger();
  const telemetry = createLivenessDecisionTelemetryRecorder({ logger });
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  let readCalls = 0;
  const store = { async readCurrent() { readCalls += 1; return { exists: false, generation: null, pointer: null }; } };

  const liveness = await handleClamavLivenessRequest({
    clamdClient: deadClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: store,
    now: NOW,
    telemetry,
  });

  assert.equal(liveness.httpStatus, 503);
  assert.equal(readCalls, 0);
  const [event] = entries();
  assert.equal(event.clamd, "unhealthy");
  assert.equal(event.recovery_evaluated, "no");
  assert.equal(event.liveness, "not_live");
  assert.equal(event.decision_reason, "clamd_unhealthy");
});

// I: malformed/missing loaded state emits invalid_loaded_state.
test("I: missing or malformed loaded state emits invalid_loaded_state", async () => {
  for (const loadedDefinitionState of [null, undefined, {}, { schema: "wrong-schema" }]) {
    const { logger, entries } = capturingLogger();
    const telemetry = createLivenessDecisionTelemetryRecorder({ logger });

    const liveness = await handleClamavLivenessRequest({
      clamdClient: cleanClamdClient(),
      loadedDefinitionState,
      maxAgeSeconds: MAX_AGE_SECONDS,
      now: NOW,
      telemetry,
    });

    assert.equal(liveness.httpStatus, 503);
    const [event] = entries();
    assert.equal(event.freshness, "invalid");
    assert.equal(event.clamd, "not_checked");
    assert.equal(event.decision_reason, "invalid_loaded_state");
  }
});

// J: repeated identical liveness state does not produce duplicate transition logs.
test("J: repeated identical liveness evaluations do not emit duplicate transition events", async () => {
  const { logger, entries } = capturingLogger();
  const telemetry = createLivenessDecisionTelemetryRecorder({ logger });
  const loadedState = loadedStateFixture();
  const clamdClient = cleanClamdClient();

  for (let i = 0; i < 5; i += 1) {
    await handleClamavLivenessRequest({
      clamdClient,
      loadedDefinitionState: loadedState,
      maxAgeSeconds: MAX_AGE_SECONDS,
      now: NOW,
      telemetry,
    });
  }

  assert.equal(entries().length, 1);
});

// K: a meaningful transition emits a new event.
test("K: a meaningful liveness-state transition emits a new event", async () => {
  const { logger, entries } = capturingLogger();
  const telemetry = createLivenessDecisionTelemetryRecorder({ logger });
  const freshState = loadedStateFixture({ generation: "gen-1", buildTimestamp: FRESH_BUILD });
  const staleState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const clamdClient = cleanClamdClient();

  await handleClamavLivenessRequest({ clamdClient, loadedDefinitionState: freshState, maxAgeSeconds: MAX_AGE_SECONDS, now: NOW, telemetry });
  await handleClamavLivenessRequest({
    clamdClient,
    loadedDefinitionState: staleState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: unavailableStore(),
    now: NOW,
    telemetry,
  });

  const events = entries();
  assert.equal(events.length, 2);
  assert.equal(events[0].decision_reason, "fresh_loaded_state_healthy");
  assert.equal(events[1].decision_reason, "stale_loaded_state_recovery_not_proven");
});

function listenHttp(app) {
  return new Promise((resolve) => {
    const server = createHttpServer(app);
    server.listen(0, "127.0.0.1", () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}
function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// L/M/N: HTTP response contract is unchanged and never exposes telemetry fields.
test("L/M/N: /livez, /readyz, and /scan responses stay exactly the sanitized existing shape", async () => {
  const loadedDefinitionState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  const app = createClamavScannerHttpApp({
    maxBytes: 1024,
    loadedDefinitionState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    now: () => NOW,
    definitionStore: unavailableStore(),
    clamdClient: cleanClamdClient(),
  });
  const { server, baseUrl } = await listenHttp(app);
  try {
    const live = await fetch(`${baseUrl}/livez`);
    const liveBody = await live.json();
    assert.deepEqual(liveBody, { status: "live" });
    assert.deepEqual(Object.keys(liveBody), ["status"]);

    const ready = await fetch(`${baseUrl}/readyz`);
    assert.deepEqual(await ready.json(), { status: "not_ready" });

    const scan = await fetch(`${baseUrl}/scan`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from("bytes", "utf8"),
    });
    assert.equal(scan.status, 503);
    assert.deepEqual(await scan.json(), { status: "error", reason: "scanner_unavailable" });
  } finally {
    await closeServer(server);
  }
});

// O: telemetry itself never causes an additional mirror read.
test("O: emitting liveness telemetry never adds an extra mirror read beyond the existing recovery lookup", async () => {
  const { logger } = capturingLogger();
  const telemetry = createLivenessDecisionTelemetryRecorder({ logger });
  const loadedState = loadedStateFixture({ generation: "gen-1", buildTimestamp: STALE_BUILD });
  let readCalls = 0;
  const store = pointerStore({ generation: "gen-2", versions: { main: "200", daily: "600", bytecode: "300" } });
  const wrappedStore = {
    async readCurrent() {
      readCalls += 1;
      return store.readCurrent();
    },
  };

  await handleClamavLivenessRequest({
    clamdClient: cleanClamdClient(),
    loadedDefinitionState: loadedState,
    maxAgeSeconds: MAX_AGE_SECONDS,
    definitionStore: wrappedStore,
    now: NOW,
    telemetry,
  });

  assert.equal(readCalls, 1);
});
