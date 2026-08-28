import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { __testables, buildManifestFromDirectory } from "../Backend/kai/clamavScannerService/clamavDefinitionMirror.js";
import { runCli } from "../scripts/kai-clamav-definition-mirror-update.js";

// Proves the actual production CLI process-boundary mapping (scripts/kai-clamav-definition-mirror-update.js),
// not just the internal updateClamavDefinitionMirror() result contract. runCli() is the same function the
// real executable entrypoint calls, so these cases exercise the real success/failure -> exit-code decision.

const FRESH_NOW = new Date("2026-08-13T12:00:00.000Z");
const FRESH_BUILD = "2026-08-13T06:00:00.000Z";
const BASELINE_VERSIONS = { main: "100", daily: "500", bytecode: "200" };

const BASE_ENV = {
  KAI_GATE_C_CLAMAV_DEFINITION_BUCKET: "synthetic-definition-bucket",
  KAI_GATE_C_CLAMAV_DEFINITION_PREFIX: "clamav/private-mirror",
  KAI_GATE_C_CLAMAV_DEFINITION_MAX_AGE_SECONDS: "86400",
};

function definitionBytes(filename) {
  return Buffer.from(`synthetic ${filename} definition bytes`, "utf8");
}

async function writeDefinitionSet(dir, filenames = ["bytecode.cvd", "daily.cvd", "main.cvd"]) {
  for (const filename of filenames) {
    await writeFile(path.join(dir, filename), definitionBytes(filename));
  }
}

function makeVersionedExtractor({ versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD } = {}) {
  return async (filePath) => {
    const database = path.basename(filePath).split(".")[0];
    return { version: versions[database], build_timestamp: buildTimestamp, functionality_level: "90" };
  };
}

async function manifestForGeneration({ generation, versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cli-manifest-"));
  await writeDefinitionSet(dir);
  return buildManifestFromDirectory({
    definitionsDir: dir,
    generationId: generation,
    now: FRESH_NOW,
    extractDatabaseMetadata: makeVersionedExtractor({ versions, buildTimestamp }),
  });
}

function createMemoryStore({ currentPointer = null, currentGeneration = null, beforeReplaceCurrent = null } = {}) {
  const objects = new Map();
  let pointer = currentPointer;
  let pointerGeneration = currentGeneration;
  const objectKey = (generationId, filename) => `${generationId}/${filename}`;

  return {
    pointer() {
      return pointer;
    },
    async readCurrent() {
      return pointer ? { exists: true, generation: pointerGeneration, pointer } : { exists: false, generation: null, pointer: null };
    },
    async writeGenerationObject({ generationId, filename, bytes }) {
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
      if (beforeReplaceCurrent) beforeReplaceCurrent({ forcePointer });
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

  function forcePointer(nextPointer, nextGeneration) {
    pointer = nextPointer;
    pointerGeneration = nextGeneration;
  }
}

async function seedValidGeneration(store, { generation = "gen-valid", versions = BASELINE_VERSIONS } = {}) {
  const manifest = await manifestForGeneration({ generation, versions });
  const pointer = __testables.pointerFromManifest(manifest);
  store.forcePointer(pointer, "7");
  for (const artifact of manifest.artifacts) {
    await store.writeGenerationObject({ generationId: generation, filename: artifact.filename, bytes: definitionBytes(artifact.filename) });
  }
  await store.writeGenerationObject({ generationId: generation, filename: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest), "utf8") });
  return manifest;
}

test("CLI CASE 1 - published candidate exits 0 with successful updated output", async () => {
  const store = createMemoryStore();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cli-"));

  const { exitCode, output, errorMessage } = await runCli({
    env: BASE_ENV,
    args: [],
    createStore: () => store,
    workDir,
    now: FRESH_NOW,
    generationIdFactory: () => "gen-cli-published",
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor(),
  });

  assert.equal(exitCode, 0);
  assert.equal(errorMessage, null);
  assert.equal(output.status, "updated");
  assert.equal(output.published, true);
});

test("CLI CASE 2 - equivalent candidate exits 0 with safe superseded output", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-cli-baseline" });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cli-"));

  const { exitCode, output, errorMessage } = await runCli({
    env: BASE_ENV,
    args: [],
    createStore: () => store,
    workDir,
    now: FRESH_NOW,
    generationIdFactory: () => "gen-cli-equivalent",
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor(),
  });

  assert.equal(exitCode, 0);
  assert.equal(errorMessage, null);
  assert.equal(output.status, "superseded");
  assert.equal(output.published, false);
  assert.equal(output.reason, "candidate_equivalent_to_current");
});

test("CLI CASE 3 - older/regressive candidate exits 0 with safe superseded output", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-cli-baseline-older" });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cli-"));

  const { exitCode, output, errorMessage } = await runCli({
    env: BASE_ENV,
    args: [],
    createStore: () => store,
    workDir,
    now: FRESH_NOW,
    generationIdFactory: () => "gen-cli-older",
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: { main: "90", daily: "490", bytecode: "190" } }),
  });

  assert.equal(exitCode, 0);
  assert.equal(errorMessage, null);
  assert.equal(output.status, "superseded");
  assert.equal(output.published, false);
  assert.equal(output.reason, "candidate_older_than_current");
});

test("CLI CASE 4 - ambiguous definition ordering exits non-zero and is never reported as superseded", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-cli-baseline-ambiguous" });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cli-"));

  const { exitCode, output, errorMessage } = await runCli({
    env: BASE_ENV,
    args: [],
    createStore: () => store,
    workDir,
    now: FRESH_NOW,
    generationIdFactory: () => "gen-cli-ambiguous",
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: { main: "not-a-number", daily: "550", bytecode: "250" } }),
  });

  assert.equal(exitCode, 1);
  assert.equal(output, null);
  assert.match(errorMessage, /ambiguous_definition_ordering/);
});

test("CLI CASE 5 - CAS retry exhaustion exits non-zero and is never reported as superseded", async () => {
  let phantomCounter = 0;
  const store = createMemoryStore({
    beforeReplaceCurrent: ({ forcePointer }) => {
      phantomCounter += 1;
      const phantomVersions = {
        main: String(100 + phantomCounter * 10),
        daily: String(500 + phantomCounter * 10),
        bytecode: String(200 + phantomCounter * 10),
      };
      const phantomManifest = {
        schema: __testables.MANIFEST_SCHEMA,
        generation: `gen-cli-phantom-${phantomCounter}`,
        created_at: FRESH_NOW.toISOString(),
        artifacts: Object.entries(phantomVersions).map(([database, version]) => ({
          filename: `${database}.cvd`,
          database,
          sha256: "a".repeat(64),
          metadata: { version, build_timestamp: FRESH_BUILD, functionality_level: "90" },
        })),
      };
      forcePointer(__testables.pointerFromManifest(phantomManifest), String(phantomCounter + 1));
    },
  });
  await seedValidGeneration(store, { generation: "gen-cli-baseline-retry" });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cli-"));

  const { exitCode, output, errorMessage } = await runCli({
    env: BASE_ENV,
    args: [],
    createStore: () => store,
    workDir,
    now: FRESH_NOW,
    generationIdFactory: () => "gen-cli-exhausted",
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: { main: "500", daily: "900", bytecode: "700" } }),
  });

  assert.equal(exitCode, 1);
  assert.equal(output, null);
  assert.match(errorMessage, /pointer_publication_conflict_retry_exhausted/);
});

test("CLI CASE 6 - a thrown updater failure (acquisition) exits non-zero", async () => {
  const store = createMemoryStore();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cli-"));

  const { exitCode, output, errorMessage } = await runCli({
    env: BASE_ENV,
    args: [],
    createStore: () => store,
    workDir,
    now: FRESH_NOW,
    generationIdFactory: () => "gen-cli-acquisition-failure",
    runUpdate: async () => {
      throw new Error("synthetic cvdupdate acquisition failure");
    },
    extractDatabaseMetadata: makeVersionedExtractor(),
  });

  assert.equal(exitCode, 1);
  assert.equal(output, null);
  assert.match(errorMessage, /synthetic cvdupdate acquisition failure/);
});

test("CLI CASE 6b - candidate validation failure exits non-zero", async () => {
  const store = createMemoryStore();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-cli-"));

  const { exitCode, output, errorMessage } = await runCli({
    env: BASE_ENV,
    args: [],
    createStore: () => store,
    workDir,
    now: FRESH_NOW,
    generationIdFactory: () => "gen-cli-validation-failure",
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir, ["main.cvd"]),
    extractDatabaseMetadata: makeVersionedExtractor(),
  });

  assert.equal(exitCode, 1);
  assert.equal(output, null);
  assert.match(errorMessage, /failed validation|incomplete/i);
});

test("CLI CASE 6c - configuration failure exits non-zero", async () => {
  const { exitCode, output, errorMessage } = await runCli({
    env: {},
    args: [],
  });

  assert.equal(exitCode, 1);
  assert.equal(output, null);
  assert.match(errorMessage, /configuration failed closed/);
});
