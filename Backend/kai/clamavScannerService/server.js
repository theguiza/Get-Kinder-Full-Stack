import { fileURLToPath } from "node:url";

import express from "express";

import { KAI_SPRINT2_MAX_FILE_SIZE_BYTES } from "../config/kaiSprint2P0Contract.js";
import { handleClamavReadinessRequest, handleClamavScanRequest } from "./clamavScanRequestHandler.js";
import { createClamdInstreamClient } from "./clamdInstreamClient.js";

// Small HTTP boundary for the ClamAV scanner. Cloud Run IAM is expected to
// sit in front of this process; this file performs no authentication of its
// own. It listens on process.env.PORT and talks to clamd only over loopback.
// Definition updates/freshness are a runtime prerequisite for this package.
// Readiness still requires clamd to detect EICAR, so PING alone is not enough.
const PORT = Number.parseInt(process.env.PORT, 10) || 8080;

export function createClamavScannerHttpApp({
  clamdClient = createClamdInstreamClient({ maxBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES }),
  maxBytes = KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
} = {}) {
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "up" });
  });

  app.get("/readyz", async (_req, res) => {
    const readiness = await handleClamavReadinessRequest({ clamdClient });
    res.status(readiness.httpStatus).json(readiness.body);
  });

  app.post(
    "/scan",
    express.raw({ type: "application/octet-stream", limit: maxBytes }),
    async (req, res) => {
      const bytes = req.body instanceof Uint8Array ? req.body : undefined;
      const result = await handleClamavScanRequest({ bytes, clamdClient, maxBytes });
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
  createClamavScannerHttpApp().listen(PORT, () => {
    console.log(`[kai-clamav-scanner] listening on ${PORT}`);
  });
}
