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
  compareDefinitionStates,
  readClamavDefinitionMirrorConfig,
  runCvdUpdate,
  updateClamavDefinitionMirror,
  validateDefinitionManifest,
} from "../Backend/kai/clamavScannerService/clamavDefinitionMirror.js";

const FRESH_NOW = new Date("2026-08-13T12:00:00.000Z");
const FRESH_BUILD = "2026-08-13T06:00:00.000Z";
const STALE_BUILD = "2026-07-01T00:00:00.000Z";
const BASELINE_VERSIONS = { main: "100", daily: "500", bytecode: "200" };

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

// Per-database version-aware metadata extractor used by every test that
// exercises semantic ordering (the comparator keys off the authoritative
// per-database `Version` field, not the aggregate build_timestamp).
function makeVersionedExtractor({ versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD } = {}) {
  return async (filePath) => {
    const database = path.basename(filePath).split(".")[0];
    return {
      version: versions[database],
      build_timestamp: buildTimestamp,
      functionality_level: "90",
    };
  };
}

// Minimal in-memory manifest fixture for pure compareDefinitionStates unit tests.
// `versions[db] === null` simulates missing/malformed per-database ordering metadata.
function fixtureManifest(generation, versions, { sha256s = {} } = {}) {
  return {
    schema: __testables.MANIFEST_SCHEMA,
    generation,
    created_at: FRESH_NOW.toISOString(),
    artifacts: Object.entries(versions).map(([database, version]) => ({
      filename: `${database}.cvd`,
      database,
      sha256: sha256s[database] || "a".repeat(64),
      metadata: version === null ? {} : { version, build_timestamp: FRESH_BUILD, functionality_level: "90" },
    })),
  };
}

async function manifestForGeneration({ generation = "gen-valid", versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-manifest-"));
  await writeDefinitionSet(dir);
  return buildManifestFromDirectory({
    definitionsDir: dir,
    generationId: generation,
    now: FRESH_NOW,
    extractDatabaseMetadata: makeVersionedExtractor({ versions, buildTimestamp }),
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

async function seedValidGeneration(store, { generation = "gen-valid", versions = BASELINE_VERSIONS, buildTimestamp = FRESH_BUILD } = {}) {
  const manifest = await manifestForGeneration({ generation, versions, buildTimestamp });
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
    extractDatabaseMetadata: makeVersionedExtractor(),
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
    extractDatabaseMetadata: makeVersionedExtractor(),
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
      maxAgeSeconds: 86400,
      runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
      extractDatabaseMetadata: syntheticMetadata,
    }),
    /synthetic interrupted upload/,
  );

  assert.deepEqual(store.pointer(), existingPointer);
  assert.equal(store.calls.replaceCurrent.length, 0);
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

// --- Semantic per-database ordering matrix (ORDER A-I) -----------------------
// These are pure compareDefinitionStates unit tests: they prove the comparator
// itself, independent of the CAS publication path.

test("ORDER A - exact equivalent per-database state is EQUIVALENT", () => {
  const current = fixtureManifest("gen-current", { main: "100", daily: "500", bytecode: "200" });
  const candidate = fixtureManifest("gen-candidate", { main: "100", daily: "500", bytecode: "200" });
  assert.equal(compareDefinitionStates(candidate, current), "EQUIVALENT");
});

test("ORDER B - one component advances is NEWER", () => {
  const current = fixtureManifest("gen-current", { main: "100", daily: "500", bytecode: "200" });
  const candidate = fixtureManifest("gen-candidate", { main: "100", daily: "501", bytecode: "200" });
  assert.equal(compareDefinitionStates(candidate, current), "NEWER");
});

test("ORDER C - multiple components advance and none regress is NEWER", () => {
  const current = fixtureManifest("gen-current", { main: "100", daily: "500", bytecode: "200" });
  const candidate = fixtureManifest("gen-candidate", { main: "101", daily: "501", bytecode: "200" });
  assert.equal(compareDefinitionStates(candidate, current), "NEWER");
});

test("ORDER D - a mixed advance/regression is REGRESSIVE even though another component advanced", () => {
  const current = fixtureManifest("gen-current", { main: "100", daily: "500", bytecode: "200" });
  const candidate = fixtureManifest("gen-candidate", { main: "100", daily: "501", bytecode: "199" });
  assert.equal(compareDefinitionStates(candidate, current), "REGRESSIVE");
});

test("ORDER E - a later aggregate build_timestamp must not mask a per-database version regression", () => {
  const current = fixtureManifest("gen-current", { main: "100", daily: "500", bytecode: "200" });
  const candidate = fixtureManifest("gen-candidate", { main: "100", daily: "500", bytecode: "199" });
  // The candidate's own maximum build_timestamp is materially later than current's
  // (proving the previous single-max-timestamp comparator would have called this NEWER),
  // while bytecode has regressed.
  candidate.artifacts = candidate.artifacts.map((artifact) =>
    artifact.database === "daily"
      ? { ...artifact, metadata: { ...artifact.metadata, build_timestamp: "2026-08-20T00:00:00.000Z" } }
      : artifact,
  );
  assert.equal(compareDefinitionStates(candidate, current), "REGRESSIVE");
});

test("ORDER F - equal build_timestamp with materially different per-database versions follows version ordering", () => {
  const current = fixtureManifest("gen-current", { main: "100", daily: "500", bytecode: "200" });
  const candidate = fixtureManifest("gen-candidate", { main: "100", daily: "501", bytecode: "200" });
  // Every artifact on both sides shares FRESH_BUILD as its build_timestamp (fixtureManifest default);
  // timestamp equality must not imply EQUIVALENT when versions differ.
  assert.equal(compareDefinitionStates(candidate, current), "NEWER");
});

test("ORDER G - missing ordering metadata for a required database is AMBIGUOUS and blocks publication", () => {
  const current = fixtureManifest("gen-current", { main: "100", daily: "500", bytecode: "200" });
  const candidate = fixtureManifest("gen-candidate", { main: "100", daily: null, bytecode: "200" });
  assert.equal(compareDefinitionStates(candidate, current), "AMBIGUOUS");
});

test("ORDER H - equal version with contradictory identity metadata is AMBIGUOUS, not EQUIVALENT", () => {
  const current = fixtureManifest("gen-current", { main: "100", daily: "500", bytecode: "200" }, { sha256s: { daily: "a".repeat(64) } });
  const candidate = fixtureManifest("gen-candidate", { main: "100", daily: "500", bytecode: "200" }, { sha256s: { daily: "b".repeat(64) } });
  assert.equal(compareDefinitionStates(candidate, current), "AMBIGUOUS");
});

test("ORDER I - no current generation is INITIAL for a complete candidate", () => {
  const candidate = fixtureManifest("gen-candidate", { main: "100", daily: "500", bytecode: "200" });
  assert.equal(compareDefinitionStates(candidate, null), "INITIAL");
});

// --- Publication safety cases (CASE 1-6, 8) ----------------------------------

test("CASE 1 - duplicate execution against equivalent upstream state is a safe no-op", async () => {
  const store = createMemoryStore();
  const { manifest: seeded } = await seedValidGeneration(store, { generation: "gen-first" });
  const pointerBefore = store.pointer();
  const generationBefore = store.pointerGeneration();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const result = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-duplicate",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor(),
  });

  assert.deepEqual(result, { ok: true, generation: "gen-duplicate", artifact_count: seeded.artifacts.length, published: false, reason: "candidate_equivalent_to_current" });
  assert.deepEqual(store.pointer(), pointerBefore);
  assert.equal(store.pointerGeneration(), generationBefore);
  assert.equal(store.calls.replaceCurrent.length, 0);
});

test("CASE 2 - a run holding a fresh pointer token must not regress current to semantically older data", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-new-baseline", versions: { main: "100", daily: "500", bytecode: "200" } });
  const currentBefore = store.pointer();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const result = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-late-old-writer",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: { main: "90", daily: "490", bytecode: "190" } }),
  });

  assert.equal(result.published, false);
  assert.equal(result.reason, "candidate_older_than_current");
  assert.deepEqual(store.pointer(), currentBefore);
  assert.equal(store.calls.replaceCurrent.length, 0);
});

test("CASE 3 - candidate failing validation before publication leaves current unchanged", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-good" });
  const currentBefore = store.pointer();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  await assert.rejects(
    updateClamavDefinitionMirror({
      store,
      workDir,
      generationIdFactory: () => "gen-stale-candidate",
      now: FRESH_NOW,
      maxAgeSeconds: 86400,
      runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
      extractDatabaseMetadata: makeVersionedExtractor({ buildTimestamp: STALE_BUILD }),
    }),
    /failed validation/,
  );

  assert.deepEqual(store.pointer(), currentBefore);
  assert.equal(store.calls.replaceCurrent.length, 0);
  assert.equal(store.calls.writes.some((write) => write.filename === "manifest.json"), false);
});

test("CASE 4/5 - failure immediately before pointer publication leaves the candidate orphaned and current authoritative", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-good" });
  const currentBefore = store.pointer();
  const currentGenerationBefore = store.pointerGeneration();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));
  const originalReplaceCurrent = store.replaceCurrent.bind(store);
  store.replaceCurrent = async () => {
    throw new Error("synthetic crash immediately before pointer publication");
  };

  await assert.rejects(
    updateClamavDefinitionMirror({
      store,
      workDir,
      generationIdFactory: () => "gen-candidate-orphan",
      now: FRESH_NOW,
      maxAgeSeconds: 86400,
      runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
      extractDatabaseMetadata: makeVersionedExtractor({ versions: { main: "150", daily: "550", bytecode: "250" } }),
    }),
    /synthetic crash immediately before pointer publication/,
  );

  assert.deepEqual(store.pointer(), currentBefore);
  assert.equal(store.pointerGeneration(), currentGenerationBefore);
  assert.equal(store.calls.writes.some((write) => write.generationId === "gen-candidate-orphan" && write.filename === "manifest.json"), true);
  store.replaceCurrent = originalReplaceCurrent;
});

test("CASE 6 - duplicate execution immediately after a successful publish remains a safe no-op", async () => {
  const store = createMemoryStore();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const first = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-first-success",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor(),
  });
  assert.equal(first.published, true);
  const pointerAfterFirst = store.pointer();

  const second = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-second-duplicate",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor(),
  });

  assert.equal(second.published, false);
  assert.equal(second.reason, "candidate_equivalent_to_current");
  assert.deepEqual(store.pointer(), pointerAfterFirst);
});

test("CASE 8 - successful pointer publication is the commit point and survives a later process failure", async () => {
  const store = createMemoryStore();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const result = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-committed",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor(),
  });

  assert.equal(result.published, true);
  assert.equal(store.pointer().generation, "gen-committed");

  const recovery = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-after-crash",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor(),
  });

  assert.equal(recovery.published, false);
  assert.equal(recovery.reason, "candidate_equivalent_to_current");
  assert.equal(store.pointer().generation, "gen-committed");
});

// --- CAS conflict reconciliation matrix (CASE 7A-7F) -------------------------
// These prove reconciliation (re-read -> semantic recompare -> supersede or
// bounded conditional retry), not merely conflict rejection.

test("CASE 7A - a real generation conflict against an equivalent winner is superseded without a second write", async () => {
  const winnerVersions = { main: "150", daily: "550", bytecode: "250" };
  const winnerManifest = await manifestForGeneration({ generation: "gen-winner-7a", versions: winnerVersions });
  const winnerPointer = __testables.pointerFromManifest(winnerManifest);

  let raceApplied = false;
  const store = createMemoryStore({
    beforeReplaceCurrent: (memoryStore) => {
      if (raceApplied) return;
      raceApplied = true;
      memoryStore.forcePointer(winnerPointer, "2");
    },
  });
  await seedValidGeneration(store, { generation: "gen-baseline-7a", versions: { main: "100", daily: "500", bytecode: "200" } });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const result = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-loser-equivalent-7a",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: winnerVersions }),
  });

  assert.equal(result.published, false);
  assert.equal(result.reason, "candidate_equivalent_to_current");
  assert.deepEqual(store.pointer(), winnerPointer);
  assert.equal(store.calls.replaceCurrent.length, 1);
});

test("CASE 7B - a real generation conflict against an older winner retries and publishes the genuinely newer candidate", async () => {
  const winnerVersions = { main: "150", daily: "550", bytecode: "250" };
  const winnerManifest = await manifestForGeneration({ generation: "gen-winner-7b", versions: winnerVersions });
  const winnerPointer = __testables.pointerFromManifest(winnerManifest);
  const candidateVersions = { main: "200", daily: "600", bytecode: "300" };

  let raceApplied = false;
  const store = createMemoryStore({
    beforeReplaceCurrent: (memoryStore) => {
      if (raceApplied) return;
      raceApplied = true;
      memoryStore.forcePointer(winnerPointer, "2");
    },
  });
  await seedValidGeneration(store, { generation: "gen-baseline-7b", versions: { main: "100", daily: "500", bytecode: "200" } });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const result = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-newer-7b",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: candidateVersions }),
  });

  assert.equal(result.published, true);
  assert.equal(store.pointer().generation, "gen-newer-7b");
  assert.equal(store.calls.replaceCurrent.length, 2);
});

test("CASE 7C - a real generation conflict exposing a mixed regression against the winner never publishes", async () => {
  const winnerVersions = { main: "150", daily: "550", bytecode: "250" };
  const winnerManifest = await manifestForGeneration({ generation: "gen-winner-7c", versions: winnerVersions });
  const winnerPointer = __testables.pointerFromManifest(winnerManifest);
  const candidateVersions = { main: "160", daily: "540", bytecode: "250" }; // main newer, daily regressive, bytecode equal

  let raceApplied = false;
  const store = createMemoryStore({
    beforeReplaceCurrent: (memoryStore) => {
      if (raceApplied) return;
      raceApplied = true;
      memoryStore.forcePointer(winnerPointer, "2");
    },
  });
  await seedValidGeneration(store, { generation: "gen-baseline-7c", versions: { main: "100", daily: "500", bytecode: "200" } });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const result = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-mixed-7c",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: candidateVersions }),
  });

  assert.equal(result.published, false);
  assert.equal(result.reason, "candidate_older_than_current");
  assert.deepEqual(store.pointer(), winnerPointer);
  assert.equal(store.calls.replaceCurrent.length, 1);
});

test("CASE 7D - repeated legitimate generation conflicts exhaust the bounded retry without an unconditional write", async () => {
  const candidateVersions = { main: "500", daily: "900", bytecode: "700" };
  let phantomCounter = 0;
  const store = createMemoryStore({
    beforeReplaceCurrent: (memoryStore) => {
      phantomCounter += 1;
      const phantomVersions = {
        main: String(100 + phantomCounter * 10),
        daily: String(500 + phantomCounter * 10),
        bytecode: String(200 + phantomCounter * 10),
      };
      const phantomManifest = fixtureManifest(`gen-phantom-${phantomCounter}`, phantomVersions);
      memoryStore.forcePointer(__testables.pointerFromManifest(phantomManifest), String(phantomCounter + 1));
    },
  });
  await seedValidGeneration(store, { generation: "gen-baseline-7d", versions: { main: "100", daily: "500", bytecode: "200" } });
  const currentBefore = store.pointer();
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const result = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-exhausted-7d",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: candidateVersions }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.published, false);
  assert.equal(result.reason, "pointer_publication_conflict_retry_exhausted");
  assert.notDeepEqual(store.pointer(), currentBefore);
  assert.equal(store.calls.replaceCurrent.length, 3);
});

test("CASE 7E - a non-CAS storage failure never enters the conflict re-read/retry path", async () => {
  const store = createMemoryStore();
  await seedValidGeneration(store, { generation: "gen-baseline-7e" });
  const currentBefore = store.pointer();
  const originalReplaceCurrent = store.replaceCurrent.bind(store);
  let calls = 0;
  store.replaceCurrent = async () => {
    calls += 1;
    const error = new Error("synthetic storage outage");
    error.code = 503;
    throw error;
  };
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  await assert.rejects(
    updateClamavDefinitionMirror({
      store,
      workDir,
      generationIdFactory: () => "gen-non-cas-7e",
      now: FRESH_NOW,
      maxAgeSeconds: 86400,
      runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
      extractDatabaseMetadata: makeVersionedExtractor({ versions: { main: "150", daily: "550", bytecode: "250" } }),
    }),
    /synthetic storage outage/,
  );

  assert.equal(calls, 1);
  assert.deepEqual(store.pointer(), currentBefore);
  store.replaceCurrent = originalReplaceCurrent;
});

test("CASE 7F - a real conflict whose re-read state is ambiguous fails closed without a second write", async () => {
  const ambiguousManifest = fixtureManifest("gen-ambiguous-7f", { main: "150", daily: null, bytecode: "250" });
  const ambiguousPointer = __testables.pointerFromManifest(ambiguousManifest);

  let raceApplied = false;
  const store = createMemoryStore({
    beforeReplaceCurrent: (memoryStore) => {
      if (raceApplied) return;
      raceApplied = true;
      memoryStore.forcePointer(ambiguousPointer, "2");
    },
  });
  await seedValidGeneration(store, { generation: "gen-baseline-7f", versions: { main: "100", daily: "500", bytecode: "200" } });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "kai-clamav-update-"));

  const result = await updateClamavDefinitionMirror({
    store,
    workDir,
    generationIdFactory: () => "gen-ambiguous-candidate-7f",
    now: FRESH_NOW,
    maxAgeSeconds: 86400,
    runUpdate: async ({ outputDir }) => writeDefinitionSet(outputDir),
    extractDatabaseMetadata: makeVersionedExtractor({ versions: { main: "150", daily: "550", bytecode: "250" } }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.published, false);
  assert.equal(result.reason, "ambiguous_definition_ordering");
  assert.deepEqual(store.pointer(), ambiguousPointer);
  assert.equal(store.calls.replaceCurrent.length, 1);
});
