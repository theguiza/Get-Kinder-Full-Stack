import { connect } from "node:net";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3310;
const DEFAULT_TIMEOUT_MS = 15000;
const INSTREAM_CHUNK_BYTES = 1024 * 1024;
const ZERO_LENGTH_TERMINATOR = Buffer.alloc(4);
const EICAR_TEST_BYTES = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "ascii",
);

function lengthPrefixedChunk(chunk) {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(chunk.byteLength, 0);
  return Buffer.concat([header, chunk]);
}

// Default-deny classification: only an exact "...: OK" suffix is clean and
// only an exact "... FOUND" suffix is a detection. Every other clamd
// response - including size-limit, malformed, and signature-unready
// messages - is treated as a scanner failure, never clean.
function classifyStreamResponse(text) {
  const trimmed = text.replace(/\0+$/, "").trim();
  if (trimmed.length === 0) return { status: "error", reason: "empty_response" };
  if (trimmed.endsWith("FOUND")) return { status: "found" };
  if (trimmed.endsWith("OK")) return { status: "clean" };
  return { status: "error", reason: "unrecognized_response" };
}

/**
 * Talks to a local clamd only, over loopback/Unix socket, using the
 * zINSTREAM protocol. Never exposed externally by this client; the caller
 * (the scanner service's HTTP boundary) is the only authenticated entry
 * point. Never logs or returns raw scanned bytes or infrastructure detail.
 */
export function createClamdInstreamClient({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  path,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes,
} = {}) {
  const connectOptions = path ? { path } : { host, port };

  function withSocket(onConnect) {
    return new Promise((resolve) => {
      const socket = connect(connectOptions);
      let settled = false;
      let responseBuffer = Buffer.alloc(0);

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };

      const timer = setTimeout(() => finish({ status: "error", reason: "timeout" }), timeoutMs);

      socket.on("error", () => finish({ status: "error", reason: "connection_failed" }));
      socket.on("data", (chunk) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);
      });
      socket.on("close", () => {
        if (settled) return;
        finish(classifyStreamResponse(responseBuffer.toString("utf8")));
      });
      socket.on("connect", () => {
        try {
          onConnect(socket);
        } catch {
          finish({ status: "error", reason: "write_failed" });
        }
      });
    });
  }

  return Object.freeze({
    async scanBytes(bytes) {
      if (!(bytes instanceof Uint8Array)) return { status: "error", reason: "invalid_input" };
      if (Number.isSafeInteger(maxBytes) && bytes.byteLength > maxBytes) {
        return { status: "error", reason: "size_limit_exceeded" };
      }

      return withSocket((socket) => {
        socket.write("zINSTREAM\0");
        let offset = 0;
        while (offset < bytes.byteLength) {
          const end = Math.min(offset + INSTREAM_CHUNK_BYTES, bytes.byteLength);
          socket.write(lengthPrefixedChunk(Buffer.from(bytes.subarray(offset, end))));
          offset = end;
        }
        socket.write(ZERO_LENGTH_TERMINATOR);
      });
    },

    async checkReadiness() {
      const ping = await new Promise((resolve) => {
        const socket = connect(connectOptions);
        let settled = false;
        let responseBuffer = Buffer.alloc(0);

        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.removeAllListeners();
          socket.destroy();
          resolve(result);
        };

        const timer = setTimeout(() => finish({ ready: false }), timeoutMs);

        socket.on("error", () => finish({ ready: false }));
        socket.on("data", (chunk) => {
          responseBuffer = Buffer.concat([responseBuffer, chunk]);
          if (responseBuffer.toString("utf8").includes("PONG")) finish({ ready: true });
        });
        socket.on("close", () => finish({ ready: responseBuffer.toString("utf8").includes("PONG") }));
        socket.on("connect", () => {
          try {
            socket.write("zPING\0");
          } catch {
            finish({ ready: false });
          }
        });
      });
      if (ping.ready !== true) return { ready: false };

      const signatureProbe = await this.scanBytes(EICAR_TEST_BYTES);
      return { ready: signatureProbe.status === "found" };
    },
  });
}

export const __testables = Object.freeze({
  classifyStreamResponse,
});
