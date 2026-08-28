#!/usr/bin/env node
import { bootstrapClamavDefinitionsFromEnv, readClamavDefinitionMirrorConfig } from "./clamavDefinitionMirror.js";
import { buildLoadedDefinitionStateFromManifest, writePendingLoadedDefinitionState } from "./loadedDefinitionState.js";

const result = await bootstrapClamavDefinitionsFromEnv(process.env);
if (result.ok !== true) {
  console.error(`[kai-clamav-scanner] definition bootstrap failed closed: ${result.reason || "unavailable"}`);
  process.exit(1);
}

// The loaded-definition state is only *pending* here - clamd has not yet
// been started against these installed artifacts. The entrypoint promotes
// it to the final loaded state only after independently confirming clamd is
// responding, so a container that dies before clamd starts never leaves a
// stale-but-confirmed loaded state behind.
const config = readClamavDefinitionMirrorConfig(process.env);
if (!config.ok) {
  console.error(`[kai-clamav-scanner] loaded-state path configuration failed closed: ${config.reason}`);
  process.exit(1);
}

const loadedState = buildLoadedDefinitionStateFromManifest(result.manifest, { loadedAt: new Date() });
await writePendingLoadedDefinitionState({ filePath: config.loadedStatePath, state: loadedState });

console.log("[kai-clamav-scanner] definition bootstrap accepted");
