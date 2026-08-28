import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";

import { createClamdInstreamClient } from "../Backend/kai/clamavScannerService/clamdInstreamClient.js";
import {
  handleClamavReadinessRequest,
  handleClamavScanRequest,
} from "../Backend/kai/clamavScannerService/clamavScanRequestHandler.js";
import { createClamavScannerHttpApp } from "../Backend/kai/clamavScannerService/server.js";
import { buildLoadedDefinitionStateFromManifest } from "../Backend/kai/clamavScannerService/loadedDefinitionState.js";

// Pre-existing-behavior fixtures: these tests predate the runtime
// loaded-definition-freshness gate and only ever exercised clamd
// transport/HTTP-boundary behavior, so they use a fixed fresh loaded state
// and fixed "now" that always passes that gate rather than re-deriving it.
const FIXTURE_NOW = new Date("2026-08-28T12:00:00.000Z");
const FIXTURE_MAX_AGE_SECONDS = 172800;
const FRESH_LOADED_DEFINITION_STATE = buildLoadedDefinitionStateFromManifest(
  {
    generation: "gen-fixture-fresh",
    artifacts: [
      { database: "main", sha256: "a".repeat(64), metadata: { version: "100", build_timestamp: "2026-08-28T06:00:00.000Z" } },
      { database: "daily", sha256: "b".repeat(64), metadata: { version: "500", build_timestamp: "2026-08-28T06:00:00.000Z" } },
      { database: "bytecode", sha256: "c".repeat(64), metadata: { version: "200", build_timestamp: "2026-08-28T06:00:00.000Z" } },
    ],
  },
  { loadedAt: FIXTURE_NOW },
);

function startFakeClamd(onData) {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        onData(socket, buffer);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function listenHttp(app) {
  return new Promise((resolve) => {
    const server = createHttpServer(app);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function endsWithZeroLengthTerminator(buffer) {
  return buffer.length >= 4 && buffer.readUInt32BE(buffer.length - 4) === 0;
}

test("clamd INSTREAM client reports clean for a normal stream: OK response", async () => {
  const { server, port } = await startFakeClamd((socket, buffer) => {
    if (endsWithZeroLengthTerminator(buffer)) {
      socket.end("stream: OK\0");
    }
  });
  try {
    const client = createClamdInstreamClient({ host: "127.0.0.1", port, timeoutMs: 2000 });
    const result = await client.scanBytes(Buffer.from("clean synthetic bytes", "utf8"));
    assert.deepEqual(result, { status: "clean" });
  } finally {
    await closeServer(server);
  }
});

test("clamd INSTREAM client reports found for a ... FOUND response and never leaks the signature name", async () => {
  const { server, port } = await startFakeClamd((socket, buffer) => {
    if (endsWithZeroLengthTerminator(buffer)) {
      socket.end("stream: Synthetic-Test-Signature FOUND\0");
    }
  });
  try {
    const client = createClamdInstreamClient({ host: "127.0.0.1", port, timeoutMs: 2000 });
    const result = await client.scanBytes(Buffer.from("infected synthetic bytes", "utf8"));
    assert.deepEqual(result, { status: "found" });
    assert.doesNotMatch(JSON.stringify(result), /Synthetic-Test-Signature/);
  } finally {
    await closeServer(server);
  }
});

test("clamd malformed, disconnect, and signature-unready responses are scanner failures, never clean", async () => {
  const malformed = await startFakeClamd((socket, buffer) => {
    if (endsWithZeroLengthTerminator(buffer)) socket.end("not a real clamd response");
  });
  const disconnect = await startFakeClamd((socket, buffer) => {
    if (endsWithZeroLengthTerminator(buffer)) socket.end();
  });
  const unready = await startFakeClamd((socket, buffer) => {
    if (endsWithZeroLengthTerminator(buffer)) {
      socket.end("stream: LibClamAV Warning: no signatures loaded\0");
    }
  });

  try {
    const malformedClient = createClamdInstreamClient({ host: "127.0.0.1", port: malformed.port, timeoutMs: 2000 });
    const disconnectClient = createClamdInstreamClient({ host: "127.0.0.1", port: disconnect.port, timeoutMs: 2000 });
    const unreadyClient = createClamdInstreamClient({ host: "127.0.0.1", port: unready.port, timeoutMs: 2000 });

    const malformedResult = await malformedClient.scanBytes(Buffer.from("bytes", "utf8"));
    const disconnectResult = await disconnectClient.scanBytes(Buffer.from("bytes", "utf8"));
    const unreadyResult = await unreadyClient.scanBytes(Buffer.from("bytes", "utf8"));

    for (const result of [malformedResult, disconnectResult, unreadyResult]) {
      assert.equal(result.status, "error");
      assert.notEqual(result.status, "clean");
    }
  } finally {
    await Promise.all([closeServer(malformed.server), closeServer(disconnect.server), closeServer(unready.server)]);
  }
});

test("clamd timeout never returns clean", async () => {
  const { server, port } = await startFakeClamd(() => {
    // Never respond - simulates a stuck/slow clamd connection.
  });
  try {
    const client = createClamdInstreamClient({ host: "127.0.0.1", port, timeoutMs: 100 });
    const result = await client.scanBytes(Buffer.from("bytes", "utf8"));
    assert.deepEqual(result, { status: "error", reason: "timeout" });
  } finally {
    await closeServer(server);
  }
});

test("clamd client rejects input larger than the configured max without connecting", async () => {
  const { server, port } = await startFakeClamd(() => {
    throw new Error("clamd must not receive oversized input");
  });
  try {
    const client = createClamdInstreamClient({ host: "127.0.0.1", port, timeoutMs: 2000, maxBytes: 4 });
    const result = await client.scanBytes(Buffer.from("way too many bytes", "utf8"));
    assert.deepEqual(result, { status: "error", reason: "size_limit_exceeded" });
  } finally {
    await closeServer(server);
  }
});

test("readiness check requires PING plus an EICAR detection and not PING alone", async () => {
  const readyServer = await startFakeClamd((socket, buffer) => {
    const text = buffer.toString("utf8");
    if (text.includes("zPING")) socket.end("PONG\0");
    if (text.includes("zINSTREAM") && endsWithZeroLengthTerminator(buffer)) {
      socket.end("stream: Eicar-Test-Signature FOUND\0");
    }
  });
  const pingOnlyServer = await startFakeClamd((socket, buffer) => {
    const text = buffer.toString("utf8");
    if (text.includes("zPING")) socket.end("PONG\0");
    if (text.includes("zINSTREAM") && endsWithZeroLengthTerminator(buffer)) socket.end("stream: OK\0");
  });
  try {
    const readyClient = createClamdInstreamClient({ host: "127.0.0.1", port: readyServer.port, timeoutMs: 2000 });
    const pingOnlyClient = createClamdInstreamClient({ host: "127.0.0.1", port: pingOnlyServer.port, timeoutMs: 2000 });

    assert.deepEqual(await readyClient.checkReadiness(), { ready: true });
    assert.deepEqual(await pingOnlyClient.checkReadiness(), { ready: false });
  } finally {
    await Promise.all([closeServer(readyServer.server), closeServer(pingOnlyServer.server)]);
  }
});

test("scan request handler rejects oversized input before invoking clamd", async () => {
  let clamdCalled = false;
  const response = await handleClamavScanRequest({
    bytes: Buffer.from("way too many bytes for the configured max", "utf8"),
    maxBytes: 4,
    clamdClient: {
      async scanBytes() {
        clamdCalled = true;
        return { status: "clean" };
      },
    },
  });

  assert.equal(response.httpStatus, 413);
  assert.equal(response.body.status, "error");
  assert.equal(clamdCalled, false);
});

test("scan request handler maps clean and found results and fails closed on scanner error", async () => {
  const fixture = {
    maxBytes: 1024,
    loadedDefinitionState: FRESH_LOADED_DEFINITION_STATE,
    maxAgeSeconds: FIXTURE_MAX_AGE_SECONDS,
    now: FIXTURE_NOW,
  };
  const cleanResponse = await handleClamavScanRequest({
    ...fixture,
    bytes: Buffer.from("bytes", "utf8"),
    clamdClient: { async scanBytes() { return { status: "clean" }; } },
  });
  const foundResponse = await handleClamavScanRequest({
    ...fixture,
    bytes: Buffer.from("bytes", "utf8"),
    clamdClient: { async scanBytes() { return { status: "found" }; } },
  });
  const errorResponse = await handleClamavScanRequest({
    ...fixture,
    bytes: Buffer.from("bytes", "utf8"),
    clamdClient: { async scanBytes() { return { status: "error", reason: "timeout" }; } },
  });
  const throwingResponse = await handleClamavScanRequest({
    ...fixture,
    bytes: Buffer.from("bytes", "utf8"),
    clamdClient: { async scanBytes() { throw new Error("synthetic clamd throw"); } },
  });

  assert.deepEqual(cleanResponse, { httpStatus: 200, body: { status: "clean" } });
  assert.deepEqual(foundResponse, { httpStatus: 200, body: { status: "found" } });
  assert.equal(errorResponse.httpStatus, 502);
  assert.equal(errorResponse.body.status, "error");
  assert.equal(throwingResponse.httpStatus, 502);
  assert.doesNotMatch(JSON.stringify(throwingResponse), /synthetic clamd throw|stack/i);
});

test("readiness handler reports ready/not_ready without leaking clamd infrastructure detail", async () => {
  const freshFixture = { loadedDefinitionState: FRESH_LOADED_DEFINITION_STATE, maxAgeSeconds: FIXTURE_MAX_AGE_SECONDS, now: FIXTURE_NOW };
  const ready = await handleClamavReadinessRequest({ ...freshFixture, clamdClient: { async checkReadiness() { return { ready: true }; } } });
  const notReady = await handleClamavReadinessRequest({ ...freshFixture, clamdClient: { async checkReadiness() { return { ready: false }; } } });
  const missingClient = await handleClamavReadinessRequest({});
  const throwing = await handleClamavReadinessRequest({
    ...freshFixture,
    clamdClient: { async checkReadiness() { throw new Error("127.0.0.1:3310 unreachable"); } },
  });

  assert.deepEqual(ready, { httpStatus: 200, body: { status: "ready" } });
  assert.deepEqual(notReady, { httpStatus: 503, body: { status: "not_ready" } });
  assert.deepEqual(missingClient, { httpStatus: 503, body: { status: "not_ready" } });
  assert.deepEqual(throwing, { httpStatus: 503, body: { status: "not_ready" } });
  assert.doesNotMatch(JSON.stringify(throwing), /127\.0\.0\.1|3310/);
});

test("HTTP scanner boundary accepts octet-stream scans, rejects other routes, and sanitizes responses", async () => {
  const app = createClamavScannerHttpApp({
    maxBytes: 16,
    loadedDefinitionState: FRESH_LOADED_DEFINITION_STATE,
    maxAgeSeconds: FIXTURE_MAX_AGE_SECONDS,
    now: () => FIXTURE_NOW,
    clamdClient: {
      async checkReadiness() {
        return { ready: true };
      },
      async scanBytes(bytes) {
        assert.equal(Buffer.compare(Buffer.from(bytes), Buffer.from("clean bytes", "utf8")), 0);
        return { status: "clean" };
      },
    },
  });
  const { server, baseUrl } = await listenHttp(app);
  try {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "up" });

    const ready = await fetch(`${baseUrl}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ready" });

    const scan = await fetch(`${baseUrl}/scan`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from("clean bytes", "utf8"),
    });
    assert.equal(scan.status, 200);
    assert.deepEqual(await scan.json(), { status: "clean" });

    const notFound = await fetch(`${baseUrl}/missing`);
    assert.equal(notFound.status, 404);
    assert.deepEqual(await notFound.json(), { status: "error", reason: "not_found" });
  } finally {
    await closeServer(server);
  }
});

test("HTTP scanner boundary enforces the configured hard byte limit before clamd", async () => {
  let clamdCalled = false;
  const app = createClamavScannerHttpApp({
    maxBytes: 4,
    clamdClient: {
      async checkReadiness() {
        return { ready: true };
      },
      async scanBytes() {
        clamdCalled = true;
        return { status: "clean" };
      },
    },
  });
  const { server, baseUrl } = await listenHttp(app);
  try {
    const response = await fetch(`${baseUrl}/scan`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from("12345", "utf8"),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { status: "error", reason: "oversized_input" });
    assert.equal(clamdCalled, false);
  } finally {
    await closeServer(server);
  }
});
