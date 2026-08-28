import { fileURLToPath } from "node:url";

import express from "express";

import { KAI_SPRINT2_MAX_FILE_SIZE_BYTES } from "../config/kaiSprint2P0Contract.js";
import {
  handleClamavLivenessRequest,
  handleClamavReadinessRequest,
  handleClamavScanRequest,
} from "./clamavScanRequestHandler.js";
import { createClamdInstreamClient } from "./clamdInstreamClient.js";
import { createGcsClamavDefinitionStore, readClamavDefinitionMirrorConfig } from "./clamavDefinitionMirror.js";
import { readLoadedDefinitionState } from "./loadedDefinitionState.js";

// Small HTTP boundary for the ClamAV scanner. Cloud Run IAM is expected to
// sit in front of this process; this file performs no authentication of its
// own. It listens on process.env.PORT and talks to clamd only over loopback.
// Definition updates/freshness are a runtime prerequisite for this package.
// Readiness still requires clamd to detect EICAR, so PING alone is not enough.
const PORT = Number.parseInt(process.env.PORT, 10) || 8080;

// Reads this instance's own loaded-definition state and freshness policy
// once, from the same config/store the bootstrap step and the definition
// mirror use - never re-derived or duplicated here. Returns nulls (fail
// closed downstream) when configuration or the finalized loaded state is
// unavailable.
async function readScannerRuntimeDefaultsFromEnv(env = process.env) {
  const config = readClamavDefinitionMirrorConfig(env);
  if (!config.ok) return { loadedDefinitionState: null, maxAgeSeconds: null, definitionStore: null };
  const loadedDefinitionState = await readLoadedDefinitionState({ filePath: config.loadedStatePath });
  const definitionStore = createGcsClamavDefinitionStore({ bucketName: config.bucketName, prefix: config.prefix });
  return { loadedDefinitionState, maxAgeSeconds: config.maxAgeSeconds, definitionStore };
}

export function createClamavScannerHttpApp({
  clamdClient = createClamdInstreamClient({ maxBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES }),
  maxBytes = KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
  loadedDefinitionState = null,
  maxAgeSeconds = null,
  definitionStore = null,
  now = () => new Date(),
} = {}) {
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "up" });
  });

  app.get("/readyz", async (_req, res) => {
    const readiness = await handleClamavReadinessRequest({ clamdClient, loadedDefinitionState, maxAgeSeconds, now: now() });
    res.status(readiness.httpStatus).json(readiness.body);
  });

  app.get("/livez", async (_req, res) => {
    const liveness = await handleClamavLivenessRequest({
      clamdClient,
      loadedDefinitionState,
      maxAgeSeconds,
      definitionStore,
      now: now(),
    });
    res.status(liveness.httpStatus).json(liveness.body);
  });

  app.post(
    "/scan",
    express.raw({ type: "application/octet-stream", limit: maxBytes }),
    async (req, res) => {
      const bytes = req.body instanceof Uint8Array ? req.body : undefined;
      const result = await handleClamavScanRequest({
        bytes,
        clamdClient,
        maxBytes,
        loadedDefinitionState,
        maxAgeSeconds,
        now: now(),
      });
      res.status(result.httpStatus).json(result.body);
    },
  );

  app.use((error, _req, res, next) => {
    if (!error) {
      next();
      return;
    }
    if (error.type === "entity.too.large") {
      res.status(413).json({ status: "error", reason: "oversized_input" });
      return;
    }
    res.status(400).json({ status: "error", reason: "invalid_body" });
  });

  app.use((_req, res) => {
    res.status(404).json({ status: "error", reason: "not_found" });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtimeDefaults = await readScannerRuntimeDefaultsFromEnv(process.env);
  createClamavScannerHttpApp(runtimeDefaults).listen(PORT, () => {
    console.log(`[kai-clamav-scanner] listening on ${PORT}`);
  });
}
