#!/usr/bin/env node
import {
  createGcsClamavDefinitionStore,
  readClamavDefinitionMirrorConfig,
  updateClamavDefinitionMirror,
} from "../Backend/kai/clamavScannerService/clamavDefinitionMirror.js";

async function main() {
  const config = readClamavDefinitionMirrorConfig(process.env);
  if (!config.ok) {
    throw new Error(`ClamAV definition mirror configuration failed closed: ${config.reason}`);
  }
  const store = createGcsClamavDefinitionStore({
    bucketName: config.bucketName,
    prefix: config.prefix,
  });
  const result = await updateClamavDefinitionMirror({
    store,
    maxAgeSeconds: config.maxAgeSeconds,
    args: process.argv.slice(2),
  });
  console.log(JSON.stringify({
    status: result.published ? "updated" : "superseded",
    generation: result.generation,
    artifact_count: result.artifact_count,
    published: result.published,
    reason: result.reason,
  }));
}

main().catch((error) => {
  console.error(error?.message || "ClamAV definition mirror update failed.");
  process.exitCode = 1;
});
