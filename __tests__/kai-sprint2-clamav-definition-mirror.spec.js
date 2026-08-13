import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { handleClamavReadinessRequest } from "../Backend/kai/clamavScannerService/clamavScanRequestHandler.js";
import {
  __testables,
  bootstrapClamavDefinitions,
  buildManifestFromDirectory,
  readClamavDefinitionMirrorConfig,
  runCvdUpdate,
  updateClamavDefinitionMirror,
  validateDefinitionManifest,
} from "../Backend/kai/clamavScannerService/clamavDefinitionMirror.js";

const FRESH_NOW = new Date("2026-08-13T12:00:00.000Z");
const FRESH_BUILD = "2026-08-13T06:00:00.000Z";
const STALE_BUILD = "2026-07-01T00:00:00.000Z";

function definitionBytes(filename) {
  return Buffer.from(`synthetic ${filename} definition bytes`, "utf8");
}

async function writeDefinitionSet(dir, filenames = ["bytecode.cvd", "daily.cvd", "main.cvd"]) {
  for (const filename of filenames) {
    await writeFile(path.join(dir, filename), definitionBytes(filename));
  }
}

async function syntheticMetadata(filePath, buildTimestamp = FRESH_BUILD) {
  const filename = path.basename(filePath);
  return {
    version: `${filename}-version`,
    build_timestamp: buildTimestamp,
    functionality_level: "90",
  };
}

async function manifestForGeneration({ generation = "gen-valid", buildTimestamp = FRESH_BUILD } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-manifest-"));
  await writeDefinitionSet(dir);
  return buildManifestFromDirectory({
    definitionsDir: dir,
    generationId: generation,
    now: FRESH_NOW,
    extractDatabaseMetadata: (filePath) => syntheticMetadata(filePath, buildTimestamp),
  });
}

function createMemoryStore({ currentPointer = null, currentGeneration = null, failWriteFor = null, beforeReplaceCurrent = null } = {}) {
  const objects = new Map();
  let pointer = currentPointer;
  let pointerGeneration = currentGeneration;
  const calls = { writes: [], replaceCurrent: [] };

  function objectKey(generationId, filename) {
    return `${generationId}/${filename}`;
  }

  return {
    calls,
    seedObject(generationId, filename, bytes) {
      objects.set(objectKey(generationId, filename), Buffer.from(bytes));
    },
    overwriteObject(generationId, filename, bytes) {
      objects.set(objectKey(generationId, filename), Buffer.from(bytes));
    },
    pointer() {
      return pointer;
    },
    pointerGeneration() {
      return pointerGeneration;
    },
    async readCurrent() {
      return pointer
        ? { exists: true, generation: pointerGeneration, pointer }
        : { exists: false, generation: null, pointer: null };
    },
    async writeGenerationObject({ generationId, filename, bytes }) {
      calls.writes.push({ generationId, filename });
      assert.equal(objects.has(objectKey(generationId, filename)), false, "generation objects must be create-only");
      if (failWriteFor === filename) throw new Error("synthetic interrupted upload");
      objects.set(objectKey(generationId, filename), Buffer.from(bytes));
    },
    async readGenerationObject({ generationId, filename }) {
      const bytes = objects.get(objectKey(generationId, filename));
      if (!bytes) {
        const error = new Error("not found");
        error.code = 404;
        throw error;
      }
      return { bytes };
    },
    async replaceCurrent({ pointer: nextPointer, ifGenerationMatch }) {
      calls.replaceCurrent.push({ ifGenerationMatch });
      if (beforeReplaceCurrent) beforeReplaceCurrent(this);
      const expected = pointer ? pointerGeneration : 0;
      if (ifGenerationMatch !== expected) {
        const error = new Error("precondition failed");
        error.code = 412;
        throw error;
      }
      pointer = nextPointer;
      pointerGeneration = pointerGeneration ? String(Number(pointerGeneration) + 1) : "1";
    },
    forcePointer(nextPointer, nextGeneration) {
      pointer = nextPointer;
      pointerGeneration = nextGeneration;
    },
  };
}

async function seedValidGeneration(store, { generation = "gen-valid", buildTimestamp = FRESH_BUILD } = {}) {
  const manifest = await manifestForGeneration({ generation, buildTimestamp });
  const pointer = __testables.pointerFromManifest(manifest);
  store.forcePointer(pointer, "7");
  for (const artifact of manifest.artifacts) {
    store.seedObject(generation, artifact.filename, definitionBytes(artifact.filename));
  }
  store.seedObject(generation, "manifest.json", Buffer.from(JSON.stringify(manifest), "utf8"));
  return { manifest, pointer };
}

test("ClamAV definition mirror config fails closed when max-age is missing or invalid", () => {
  const base = {
    KAI_GATE_C_CLAMAV_DEFINITION_BUCKET: "synthetic-definition-bucket",
    KAI_GATE_C_CLAMAV_DEFINITION_PREFIX: "clamav/private-mirror",
    KAI_GATE_C_CLAMAV_DEFINITION_LOCAL_DIR: "/tmp/clamav",
  };

  assert.equal(readClamavDefinitionMirrorConfig(base).ok, false);
  assert.equal(readClamavDefinitionMirrorConfig({ ...base, KAI_GATE_C_CLAMAV_DEFINITION_MAX_AGE_SECONDS: "0" }).ok, false);
  assert.equal(readClamavDefinitionMirrorConfig({
    ...base,
    KAI_GATE_C_CLAMAV_DEFINITION_MAX_AGE_SECONDS: "86400",
  }).ok, true);
});

test("missing or unavailable current mirror pointer refuses scanner bootstrap readiness", async () => {
  const store = createMemoryStore();
  const localDir = path.join(await mkdtemp(path.join(os.tmpdir(), "kai-clamav-bootstrap-")), "defs");

  const result = await bootstrapClamavDefinitions({
    store,
    localDir,
    maxAgeSeconds: 86400,
    extractDatabaseMetadata: syntheticMetadata,
    now: FRESH_NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "missing_current_pointer" });
});

test("incomplete immutable generation refuses scanner bootstrap readiness", async () => {
  const manifest = await manifestForGeneration({ generation: "gen-incomplete" });
  manifest.artifacts = manifest.artifacts.filter((artifact) => artifact.database !== "bytecode");
  const store = createMemoryStore({
    currentPointer: __testables.pointerFromManifest(manifest),
    currentGeneration: "3",
  });
  const localDir = path.join(await mkdtemp(path.join(os.tmpdir(), "kai-clamav-bootstrap-")), "defs");

  const result = await bootstrapClamavDefinitions({
    store,
    localDir,
    maxAgeSeconds: 86400,
    extractDatabaseMetadata: syntheticMetadata,
    now: FRESH_NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "incomplete_generation" });
});

test("checksum mismatch in referenced immutable generation refuses scanner bootstrap readiness", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-checksum" });
  store.overwriteObject("gen-checksum", "daily.cvd", Buffer.from("tampered bytes", "utf8"));
  const localDir = path.join(await mkdtemp(path.join(os.tmpdir(), "kai-clamav-bootstrap-")), "defs");

  const result = await bootstrapClamavDefinitions({
    store,
    localDir,
    maxAgeSeconds: 86400,
    extractDatabaseMetadata: syntheticMetadata,
    now: FRESH_NOW,
  });

  assert.deepEqual(result, { ok: false, reason: "checksum_mismatch" });
});

test("stale ClamAV database metadata refuses scanner bootstrap readiness", async () => {
  const manifest = await manifestForGeneration({ generation: "gen-stale", buildTimestamp: STALE_BUILD });
  const result = validateDefinitionManifest(manifest, { maxAgeSeconds: 86400, now: FRESH_NOW });

  assert.deepEqual(result, { ok: false, reason: "stale_definitions" });
});

test("valid fresh checksum-verified definitions can bootstrap before EICAR readiness", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-ready" });
  const localDir = path.join(await mkdtemp(path.join(os.tmpdir(), "kai-clamav-bootstrap-")), "defs");

  const bootstrap = await bootstrapClamavDefinitions({
    store,
    localDir,
    maxAgeSeconds: 86400,
    extractDatabaseMetadata: syntheticMetadata,
    now: FRESH_NOW,
  });
  const ready = await handleClamavReadinessRequest({
    clamdClient: { async checkReadiness() { return { ready: true }; } },
  });

  assert.deepEqual(bootstrap, { ok: true, generation: "gen-ready" });
  assert.equal((await readFile(path.join(localDir, "daily.cvd"))).toString("utf8"), definitionBytes("daily.cvd").toString("utf8"));
  assert.deepEqual(ready, { httpStatus: 200, body: { status: "ready" } });
});

test("interrupted updater cannot change current pointer", async () => {
  const existingManifest = await manifestForGeneration({ generation: "gen-existing" });
  const existingPointer = __testables.pointerFromManifest(existingManifest);
  const store = createMemoryStore({
    currentPointer: existingPointer,
    currentGeneration: "11",
    failWriteFor: "daily.cvd",
  });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  await assert.rejects(
    updateClamavDefinitionMirror({
      store,
      workDir,
      generationIdFactory: () => "gen-interrupted",
      now: FRESH_NOW,
      runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
      extractDatabaseMetadata: syntheticMetadata,
    }),
    /synthetic interrupted upload/,
  );

  assert.deepEqual(store.pointer(), existingPointer);
  assert.equal(store.calls.replaceCurrent.length, 0);
});

test("stale concurrent updater fails current pointer generation precondition", async () => {
  const existingManifest = await manifestForGeneration({ generation: "gen-existing" });
  const concurrentManifest = await manifestForGeneration({ generation: "gen-concurrent" });
  const concurrentPointer = __testables.pointerFromManifest(concurrentManifest);
  const store = createMemoryStore({
    currentPointer: __testables.pointerFromManifest(existingManifest),
    currentGeneration: "11",
    beforeReplaceCurrent: (memoryStore) => memoryStore.forcePointer(concurrentPointer, "12"),
  });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  await assert.rejects(
    updateClamavDefinitionMirror({
      store,
      workDir,
      generationIdFactory: () => "gen-stale-updater",
      now: FRESH_NOW,
      runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
      extractDatabaseMetadata: syntheticMetadata,
    }),
    /precondition failed/,
  );

  assert.deepEqual(store.pointer(), concurrentPointer);
  assert.deepEqual(store.calls.replaceCurrent.map((call) => call.ifGenerationMatch), ["11"]);
});

test("definition updater rejects intake/client file input before invoking CVDUpdate", async () => {
  let cvdUpdateCalled = false;
  const store = createMemoryStore();

  await assert.rejects(
    updateClamavDefinitionMirror({
      store,
      args: ["/tmp/client-upload.pdf"],
      runUpdate: async () => {
        cvdUpdateCalled = true;
      },
      extractDatabaseMetadata: syntheticMetadata,
    }),
    /accepts no intake or client file input/,
  );
  assert.equal(cvdUpdateCalled, false);
});

test("CVDUpdate wrapper uses the private-mirror config/update command path", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cvdupdate-"));
  const logPath = path.join(dir, "calls.log");
  const commandPath = path.join(dir, "cvdupdate");
  await writeFile(commandPath, [
    "#!/bin/sh",
    `printf '%s|%s\\n' "$HOME" "$*" >> ${JSON.stringify(logPath)}`,
    "exit 0",
    "",
  ].join("\n"));
  await chmod(commandPath, 0o700);

  await runCvdUpdate({ outputDir: dir, command: commandPath });

  const calls = (await readFile(logPath, "utf8")).trim().split("\n");
  assert.deepEqual(calls, [
    `${path.join(dir, ".cvdupdate-home")}|config set --dbdir ${dir}`,
    `${path.join(dir, ".cvdupdate-home")}|update`,
  ]);
});
