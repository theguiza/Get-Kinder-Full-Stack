#!/usr/bin/env node
import {
  createGcsClamavDefinitionStore,
  readClamavDefinitionMirrorConfig,
  updateClamavDefinitionMirror,
} from "../Backend/kai/clamavScannerService/clamavDefinitionMirror.js";

export async function runClamavDefinitionMirrorUpdate({
  env = process.env,
  args = process.argv.slice(2),
  createStore = createGcsClamavDefinitionStore,
  ...updateOverrides
} = {}) {
  const config = readClamavDefinitionMirrorConfig(env);
  if (!config.ok) {
    throw new Error(`ClamAV definition mirror configuration failed closed: ${config.reason}`);
  }
  const store = createStore({
    bucketName: config.bucketName,
    prefix: config.prefix,
  });
  const result = await updateClamavDefinitionMirror({
    store,
    maxAgeSeconds: config.maxAgeSeconds,
    args,
    ...updateOverrides,
  });
  if (!result.ok) {
    throw new Error(`ClamAV definition mirror execution failed: ${result.reason}`);
  }
  return result;
}

// Single process-boundary function shared by the real executable entrypoint
// and tests, so the success/failure -> exit-code mapping is never duplicated.
export async function runCli(overrides = {}) {
  try {
    const result = await runClamavDefinitionMirrorUpdate(overrides);
    return {
      exitCode: 0,
      output: {
        status: result.published ? "updated" : "superseded",
        generation: result.generation,
        artifact_count: result.artifact_count,
        published: result.published,
        reason: result.reason,
      },
      errorMessage: null,
    };
  } catch (error) {
    return { exitCode: 1, output: null, errorMessage: error?.message || "ClamAV definition mirror update failed." };
  }
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runCli().then(({ exitCode, output, errorMessage }) => {
    if (output) console.log(JSON.stringify(output));
    if (errorMessage) console.error(errorMessage);
    process.exitCode = exitCode;
  });
}
