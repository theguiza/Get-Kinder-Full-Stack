import crypto, { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

import { Storage } from "@google-cloud/storage";

const MANIFEST_SCHEMA = "kai_gate_c_clamav_definition_manifest_v1";
const POINTER_SCHEMA = "kai_gate_c_clamav_definition_current_v1";
const ARTIFACT_PATTERN = /^(main|daily|bytecode)\.(?:cvd|cld)$/;
const REQUIRED_DATABASES = new Set(["main", "daily", "bytecode"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_CVDUPDATE_COMMAND = "cvdupdate";
const MAX_PREFIX_LENGTH = 512;
const MAX_AGE_SECONDS_MIN = 1;
const MAX_AGE_SECONDS_MAX = 60 * 60 * 24 * 30;

function normalizePrefix(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed.length === 0 || trimmed.length > MAX_PREFIX_LENGTH) return null;
  if (trimmed.includes("..") || trimmed.includes("//")) return null;
  return trimmed;
}

function isUsableBucketName(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 222;
}

export function readClamavDefinitionMirrorConfig(env = process.env) {
  const bucketName = env.KAI_GATE_C_CLAMAV_DEFINITION_BUCKET;
  if (!isUsableBucketName(bucketName)) return { ok: false, reason: "missing_or_malformed_definition_bucket" };

  const prefix = normalizePrefix(env.KAI_GATE_C_CLAMAV_DEFINITION_PREFIX);
  if (!prefix) return { ok: false, reason: "missing_or_malformed_definition_prefix" };

  const maxAgeSeconds = Number.parseInt(env.KAI_GATE_C_CLAMAV_DEFINITION_MAX_AGE_SECONDS, 10);
  if (
    !Number.isSafeInteger(maxAgeSeconds) ||
    maxAgeSeconds < MAX_AGE_SECONDS_MIN ||
    maxAgeSeconds > MAX_AGE_SECONDS_MAX
  ) {
    return { ok: false, reason: "missing_or_malformed_definition_max_age_seconds" };
  }

  const localDir = env.KAI_GATE_C_CLAMAV_DEFINITION_LOCAL_DIR || "/var/lib/clamav";
  if (typeof localDir !== "string" || localDir.trim().length === 0 || !path.isAbsolute(localDir)) {
    return { ok: false, reason: "missing_or_malformed_definition_local_dir" };
  }

  const loadedStatePath = env.KAI_GATE_C_CLAMAV_LOADED_STATE_PATH || "/var/run/kai-clamav/loaded-definition-state.json";
  if (typeof loadedStatePath !== "string" || loadedStatePath.trim().length === 0 || !path.isAbsolute(loadedStatePath)) {
    return { ok: false, reason: "missing_or_malformed_loaded_state_path" };
  }

  return { ok: true, bucketName, prefix, maxAgeSeconds, localDir, loadedStatePath };
}

export function createGcsClamavDefinitionStore({ storageClient = new Storage(), bucketName, prefix } = {}) {
  const normalizedPrefix = normalizePrefix(prefix);
  if (!isUsableBucketName(bucketName) || !normalizedPrefix) {
    throw new Error("ClamAV definition store configuration is unavailable.");
  }
  const bucket = storageClient.bucket(bucketName);
  const key = (suffix) => `${normalizedPrefix}/${suffix}`;
  const readFileObject = async (objectKey) => {
    const file = bucket.file(objectKey);
    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();
    return { bytes: buffer, generation: String(metadata?.generation || "") };
  };

  return Object.freeze({
    pointerKey: key("current.json"),
    generationObjectKey(generationId, filename) {
      return key(`generations/${generationId}/${filename}`);
    },
    async readCurrent() {
      const file = bucket.file(key("current.json"));
      try {
        const [metadata] = await file.getMetadata();
        const [buffer] = await file.download();
        return { exists: true, generation: String(metadata?.generation || ""), pointer: JSON.parse(buffer.toString("utf8")) };
      } catch (error) {
        if (error?.code === 404) return { exists: false, generation: null, pointer: null };
        throw error;
      }
    },
    async writeGenerationObject({ generationId, filename, bytes, contentType = "application/octet-stream" }) {
      const file = bucket.file(key(`generations/${generationId}/${filename}`));
      await file.save(Buffer.from(bytes), {
        resumable: false,
        metadata: { contentType },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    },
    async readGenerationObject({ generationId, filename }) {
      return readFileObject(key(`generations/${generationId}/${filename}`));
    },
    async replaceCurrent({ pointer, ifGenerationMatch }) {
      const file = bucket.file(key("current.json"));
      await file.save(Buffer.from(JSON.stringify(pointer), "utf8"), {
        resumable: false,
        metadata: { contentType: "application/json" },
        preconditionOpts: { ifGenerationMatch },
      });
    },
  });
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

function databaseNameFromFilename(filename) {
  return filename.split(".")[0];
}

function assertNoUpdaterInput(args) {
  if (Array.isArray(args) && args.length > 0) {
    throw new Error("The ClamAV definition updater accepts no intake or client file input.");
  }
}

function parseSigtoolTimestamp(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function parseSigtoolDatabaseInfo(output) {
  const text = typeof output === "string" ? output : "";
  const metadata = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2];
    if (key === "version") metadata.version = value;
    if (key === "build time" || key === "build timestamp") metadata.build_timestamp = parseSigtoolTimestamp(value);
    if (key === "functionality level" || key === "f-level") metadata.functionality_level = value;
  }
  if (!metadata.version || !metadata.build_timestamp) {
    throw new Error("ClamAV database metadata is malformed.");
  }
  return metadata;
}

export function extractClamavDatabaseMetadataWithSigtool(filePath, { command = "sigtool" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["--info", filePath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || "sigtool failed"));
        return;
      }
      try {
        resolve(parseSigtoolDatabaseInfo(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function runCvdUpdateCommand(command, args, { homeDir } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, HOME: homeDir },
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "cvdupdate failed"));
    });
  });
}

export async function runCvdUpdate({ outputDir, command = DEFAULT_CVDUPDATE_COMMAND } = {}) {
  const homeDir = path.join(outputDir, ".cvdupdate-home");
  await mkdir(homeDir, { recursive: true });
  await runCvdUpdateCommand(command, ["config", "set", "--dbdir", outputDir], { homeDir });
  await runCvdUpdateCommand(command, ["update"], { homeDir });
}

export async function buildManifestFromDirectory({
  definitionsDir,
  generationId,
  extractDatabaseMetadata = extractClamavDatabaseMetadataWithSigtool,
  now = new Date(),
} = {}) {
  const entries = await readdir(definitionsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && ARTIFACT_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const presentDatabases = new Set(files.map(databaseNameFromFilename));
  for (const required of REQUIRED_DATABASES) {
    if (!presentDatabases.has(required)) throw new Error("ClamAV definition generation is incomplete.");
  }

  const artifacts = [];
  for (const filename of files) {
    const filePath = path.join(definitionsDir, filename);
    artifacts.push({
      filename,
      sha256: await sha256File(filePath),
      database: databaseNameFromFilename(filename),
      metadata: await extractDatabaseMetadata(filePath),
    });
  }

  return {
    schema: MANIFEST_SCHEMA,
    generation: generationId,
    created_at: now.toISOString(),
    artifacts,
  };
}

export function validateDefinitionManifest(manifest, { maxAgeSeconds, now = new Date() } = {}) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || typeof manifest.generation !== "string") {
    return { ok: false, reason: "malformed_manifest" };
  }
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    return { ok: false, reason: "missing_or_invalid_max_age" };
  }
  if (!Array.isArray(manifest.artifacts)) return { ok: false, reason: "malformed_manifest" };
  const databases = new Set();
  let newestBuildTime = null;
  for (const artifact of manifest.artifacts) {
    if (!artifact || !ARTIFACT_PATTERN.test(artifact.filename) || !SHA256_PATTERN.test(artifact.sha256 || "")) {
      return { ok: false, reason: "malformed_manifest" };
    }
    if (artifact.database !== databaseNameFromFilename(artifact.filename)) return { ok: false, reason: "malformed_manifest" };
    const buildTimestamp = artifact.metadata?.build_timestamp;
    if (typeof artifact.metadata?.version !== "string" || artifact.metadata.version.length === 0) {
      return { ok: false, reason: "malformed_database_metadata" };
    }
    const buildTime = new Date(buildTimestamp);
    if (typeof buildTimestamp !== "string" || Number.isNaN(buildTime.getTime())) {
      return { ok: false, reason: "malformed_database_metadata" };
    }
    if (!newestBuildTime || buildTime > newestBuildTime) newestBuildTime = buildTime;
    databases.add(artifact.database);
  }
  for (const required of REQUIRED_DATABASES) {
    if (!databases.has(required)) return { ok: false, reason: "incomplete_generation" };
  }
  const ageSeconds = (now.getTime() - newestBuildTime.getTime()) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > maxAgeSeconds) {
    return { ok: false, reason: "stale_definitions" };
  }
  return { ok: true };
}

function pointerFromManifest(manifest) {
  return {
    schema: POINTER_SCHEMA,
    generation: manifest.generation,
    manifest,
  };
}

export function manifestFromPointer(pointer) {
  if (!pointer || pointer.schema !== POINTER_SCHEMA || typeof pointer.generation !== "string") {
    return null;
  }
  if (pointer.manifest?.generation !== pointer.generation) return null;
  return pointer.manifest;
}

function parseComparableVersion(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  if (!/^\d+$/.test(value.trim())) return null;
  return Number.parseInt(value.trim(), 10);
}

function artifactsByDatabase(manifest) {
  const map = new Map();
  for (const artifact of manifest.artifacts) {
    if (map.has(artifact.database)) return null;
    map.set(artifact.database, artifact);
  }
  return map;
}

// Per-database semantic verdict, derived from the CVD's own authoritative
// `Version` field (sigtool-reported). Distinct from freshness (build_timestamp)
// and from the storage generation token, neither of which may substitute for
// this comparison.
function compareDatabaseArtifact(candidateArtifact, currentArtifact) {
  const candidateVersion = parseComparableVersion(candidateArtifact?.metadata?.version);
  const currentVersion = parseComparableVersion(currentArtifact?.metadata?.version);
  if (candidateVersion === null || currentVersion === null) return "AMBIGUOUS";
  if (candidateVersion > currentVersion) return "NEWER";
  if (candidateVersion < currentVersion) return "REGRESSIVE";
  if (typeof candidateArtifact.sha256 !== "string" || typeof currentArtifact.sha256 !== "string") return "AMBIGUOUS";
  return candidateArtifact.sha256 === currentArtifact.sha256 ? "EQUIVALENT" : "AMBIGUOUS";
}

// Semantic ClamAV definition ordering, derived from a deterministic per-database
// comparison of authoritative CVD versions (and identity/checksum metadata to
// disambiguate equal versions). This is distinct from definition freshness
// (build_timestamp) and from the storage generation token used only as an
// optimistic-concurrency precondition on the current-pointer write; neither
// timing nor a single aggregate timestamp may substitute for this comparison.
// A single component moving backward makes the whole candidate REGRESSIVE,
// even when other required components advanced.
export function compareDefinitionStates(candidateManifest, currentManifest) {
  if (!currentManifest) return "INITIAL";
  const candidateByDatabase = artifactsByDatabase(candidateManifest);
  const currentByDatabase = artifactsByDatabase(currentManifest);
  if (!candidateByDatabase || !currentByDatabase) return "AMBIGUOUS";

  const verdicts = [];
  for (const database of REQUIRED_DATABASES) {
    const candidateArtifact = candidateByDatabase.get(database);
    const currentArtifact = currentByDatabase.get(database);
    if (!candidateArtifact || !currentArtifact) {
      verdicts.push("AMBIGUOUS");
      continue;
    }
    verdicts.push(compareDatabaseArtifact(candidateArtifact, currentArtifact));
  }
  if (verdicts.includes("AMBIGUOUS")) return "AMBIGUOUS";
  if (verdicts.includes("REGRESSIVE")) return "REGRESSIVE";
  return verdicts.includes("NEWER") ? "NEWER" : "EQUIVALENT";
}

const MAX_POINTER_PUBLISH_ATTEMPTS = 3;

// A failed `ifGenerationMatch` precondition surfaces from @google-cloud/storage
// (via gaxios) as a GaxiosError whose `code` carries the HTTP status (412);
// see node_modules/gaxios/build/esm/src/common.js. Only that structured signal
// may enter the CAS reconciliation path — any other failure (auth, network,
// malformed request) must propagate untouched.
function isGenerationPreconditionConflict(error) {
  return Boolean(error) && Number(error.code) === 412;
}

async function reconcileAndPublish({ store, manifest, current, maxAttempts = MAX_POINTER_PUBLISH_ATTEMPTS }) {
  let currentState = current;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentManifest = manifestFromPointer(currentState.pointer);
    const ordering = compareDefinitionStates(manifest, currentManifest);

    if (ordering === "AMBIGUOUS") return { published: false, reason: "ambiguous_definition_ordering" };
    if (ordering === "REGRESSIVE") return { published: false, reason: "candidate_older_than_current" };
    if (ordering === "EQUIVALENT") return { published: false, reason: "candidate_equivalent_to_current" };

    try {
      await store.replaceCurrent({
        pointer: pointerFromManifest(manifest),
        ifGenerationMatch: currentState.exists ? currentState.generation : 0,
      });
      return { published: true };
    } catch (error) {
      if (!isGenerationPreconditionConflict(error)) throw error;
      if (attempt >= maxAttempts) return { published: false, reason: "pointer_publication_conflict_retry_exhausted" };
      currentState = await store.readCurrent();
    }
  }
  return { published: false, reason: "pointer_publication_conflict_retry_exhausted" };
}

export async function updateClamavDefinitionMirror({
  store,
  workDir,
  runUpdate = runCvdUpdate,
  extractDatabaseMetadata = extractClamavDatabaseMetadataWithSigtool,
  generationIdFactory = randomUUID,
  maxAgeSeconds,
  args = [],
  now = new Date(),
} = {}) {
  assertNoUpdaterInput(args);
  if (!store) throw new Error("ClamAV definition store is required.");
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error("ClamAV definition mirror update requires maxAgeSeconds configuration.");
  }
  const parentDir = workDir || os.tmpdir();
  const downloadDir = path.join(parentDir, `kai-clamav-definitions-${randomUUID()}`);
  await mkdir(downloadDir, { recursive: true });
  const generationId = generationIdFactory();
  try {
    const current = await store.readCurrent();

    await runUpdate({ outputDir: downloadDir });
    const manifest = await buildManifestFromDirectory({
      definitionsDir: downloadDir,
      generationId,
      extractDatabaseMetadata,
      now,
    });

    const validation = validateDefinitionManifest(manifest, { maxAgeSeconds, now });
    if (!validation.ok) throw new Error(`ClamAV definition candidate failed validation: ${validation.reason}`);

    for (const artifact of manifest.artifacts) {
      const bytes = await readFile(path.join(downloadDir, artifact.filename));
      await store.writeGenerationObject({ generationId, filename: artifact.filename, bytes });
    }
    await store.writeGenerationObject({
      generationId,
      filename: "manifest.json",
      bytes: Buffer.from(JSON.stringify(manifest), "utf8"),
      contentType: "application/json",
    });

    for (const artifact of manifest.artifacts) {
      const stored = await store.readGenerationObject({ generationId, filename: artifact.filename });
      if (sha256(stored.bytes) !== artifact.sha256) throw new Error("Uploaded ClamAV definition checksum mismatch.");
    }
    const storedManifest = JSON.parse((await store.readGenerationObject({ generationId, filename: "manifest.json" })).bytes.toString("utf8"));
    if (JSON.stringify(storedManifest) !== JSON.stringify(manifest)) {
      throw new Error("Uploaded ClamAV definition manifest validation failed.");
    }

    const publication = await reconcileAndPublish({ store, manifest, current });
    if (!publication.published) {
      const executionFailed =
        publication.reason === "ambiguous_definition_ordering" ||
        publication.reason === "pointer_publication_conflict_retry_exhausted";
      return {
        ok: !executionFailed,
        generation: generationId,
        artifact_count: manifest.artifacts.length,
        published: false,
        reason: publication.reason,
      };
    }
    return { ok: true, generation: generationId, artifact_count: manifest.artifacts.length, published: true };
  } finally {
    await rm(downloadDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function bootstrapClamavDefinitions({
  store,
  localDir,
  maxAgeSeconds,
  extractDatabaseMetadata = extractClamavDatabaseMetadataWithSigtool,
  now = new Date(),
} = {}) {
  if (!store || typeof localDir !== "string" || !path.isAbsolute(localDir)) {
    return { ok: false, reason: "bootstrap_configuration_unavailable" };
  }
  const current = await store.readCurrent();
  if (!current.exists) return { ok: false, reason: "missing_current_pointer" };
  const manifest = manifestFromPointer(current.pointer);
  const validation = validateDefinitionManifest(manifest, { maxAgeSeconds, now });
  if (!validation.ok) return validation;

  const tempDir = path.join(path.dirname(localDir), `.clamav-definitions-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  try {
    for (const artifact of manifest.artifacts) {
      const stored = await store.readGenerationObject({ generationId: manifest.generation, filename: artifact.filename });
      const bytes = Buffer.from(stored.bytes);
      if (sha256(bytes) !== artifact.sha256) return { ok: false, reason: "checksum_mismatch" };
      const destination = path.join(tempDir, artifact.filename);
      await writeFile(destination, bytes, { flag: "wx" });
      const metadata = await extractDatabaseMetadata(destination);
      if (
        metadata.version !== artifact.metadata.version ||
        metadata.build_timestamp !== artifact.metadata.build_timestamp
      ) {
        return { ok: false, reason: "database_metadata_mismatch" };
      }
    }
    await rm(localDir, { recursive: true, force: true });
    await rename(tempDir, localDir);
    return { ok: true, generation: manifest.generation, manifest };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === 404) return { ok: false, reason: "incomplete_generation" };
    return { ok: false, reason: "definition_bootstrap_failed" };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function bootstrapClamavDefinitionsFromEnv(env = process.env) {
  const config = readClamavDefinitionMirrorConfig(env);
  if (!config.ok) return config;
  const store = createGcsClamavDefinitionStore({
    bucketName: config.bucketName,
    prefix: config.prefix,
  });
  return bootstrapClamavDefinitions({
    store,
    localDir: config.localDir,
    maxAgeSeconds: config.maxAgeSeconds,
  });
}

export const __testables = Object.freeze({
  ARTIFACT_PATTERN,
  REQUIRED_DATABASES,
  MANIFEST_SCHEMA,
  POINTER_SCHEMA,
  pointerFromManifest,
  manifestFromPointer,
  sha256,
});
