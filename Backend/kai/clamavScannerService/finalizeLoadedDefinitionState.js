#!/usr/bin/env node
// Run by the container entrypoint only after it has independently confirmed
// clamd is responding against the artifacts bootstrapDefinitions.js
// installed. Promotes the pending loaded-definition state written by that
// step into the final state the HTTP service reads at startup. Never runs
// on a timer and never re-validates definitions itself - it only records
// that clamd successfully started against what was already validated.
import { readClamavDefinitionMirrorConfig } from "./clamavDefinitionMirror.js";
import { finalizeLoadedDefinitionState } from "./loadedDefinitionState.js";

const config = readClamavDefinitionMirrorConfig(process.env);
if (!config.ok) {
  console.error(`[kai-clamav-scanner] loaded-state path configuration failed closed: ${config.reason}`);
  process.exit(1);
}

const result = await finalizeLoadedDefinitionState({ filePath: config.loadedStatePath });
if (result.ok !== true) {
  console.error(`[kai-clamav-scanner] loaded-state finalization failed closed: ${result.reason}`);
  process.exit(1);
}

console.log("[kai-clamav-scanner] loaded definition state finalized");
