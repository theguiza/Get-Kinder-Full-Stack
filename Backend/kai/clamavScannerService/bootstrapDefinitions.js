#!/usr/bin/env node
import { bootstrapClamavDefinitionsFromEnv } from "./clamavDefinitionMirror.js";

const result = await bootstrapClamavDefinitionsFromEnv(process.env);
if (result.ok !== true) {
  console.error(`[kai-clamav-scanner] definition bootstrap failed closed: ${result.reason || "unavailable"}`);
  process.exit(1);
}

console.log("[kai-clamav-scanner] definition bootstrap accepted");
