import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";

import { Client } from "pg";

import { KAI_SPRINT2_MAX_FILE_SIZE_BYTES } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import { createGoogleCloudStorageProvider } from "../Backend/kai/storage/googleCloudStorageProvider.js";
import { createImpersonatedStorageClient } from "../Backend/kai/storage/gcsImpersonatedStorageClientFactory.js";
import { buildObjectKey } from "../Backend/kai/storage/storagePathPolicy.js";

const SENTINEL_DATABASE_URL = "postgres://127.0.0.1:9/kai_sentinel";
const SYNTHETIC_ORGANIZATION_ID = "00000000-0000-4000-8000-00000000b101";
const SYNTHETIC_BATCH_ID = "10000000-0000-4000-8000-00000000b101";
const SYNTHETIC_NOW = "2026-08-09T12:00:00.000Z";
const SYNTHETIC_CONTENT_TYPE = "text/plain";
const SYNTHETIC_SAFE_FILENAME = "gate-b1-synthetic.txt";

function fail(message) {
  throw new Error(`Gate B-1 verifier failed: ${message}`);
}

function assertCondition(value, message) {
  if (!value) fail(message);
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function syntheticObjectVersionId(intakeFileId) {
  return `ov_${sha256Hex(Buffer.from(intakeFileId)).slice(0, 32)}`;
}

async function collectByteSource(byteSource) {
  const chunks = [];
  for await (const chunk of byteSource) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parseSignedHeaders(url) {
  const parsed = new URL(url);
  return new Set((parsed.searchParams.get("X-Goog-SignedHeaders") || "").split(";").filter(Boolean));
}

function assertSignedPutContract(result) {
  assertCondition(result.ok, "signed PUT creation did not succeed");
  assertCondition(result.data.method === "PUT", "signed URL method was not PUT");
  assertCondition(result.data.expires_in_seconds > 0 && result.data.expires_in_seconds <= 900, "signed URL expiry was not short");
  assertCondition(result.data.headers["Content-Type"] === SYNTHETIC_CONTENT_TYPE, "Content-Type header was not returned");
  assertCondition(
    result.data.headers["x-goog-content-length-range"] === `0,${KAI_SPRINT2_MAX_FILE_SIZE_BYTES}`,
    "content-length range header was not returned",
  );
  assertCondition(result.data.headers["x-goog-if-generation-match"] === "0", "create-only precondition was not returned");

  const signedHeaders = parseSignedHeaders(result.data.url);
  for (const header of ["content-type", "x-goog-content-length-range", "x-goog-if-generation-match"]) {
    assertCondition(signedHeaders.has(header), `${header} was not in V4 signed headers`);
  }
}

function assertSanitizedFailure(result, expectedCode, message) {
  assertCondition(result.ok === false, `${message}: expected failure`);
  assertCondition(result.error.code === expectedCode, `${message}: expected ${expectedCode}, got ${result.error.code}`);
  const serialized = JSON.stringify(result);
  assertCondition(!serialized.includes("gate-b1-synthetic"), `${message}: leaked synthetic object detail`);
  assertCondition(!serialized.includes("X-Goog-Signature"), `${message}: leaked signed URL detail`);
}

function nextWrongGeneration(generation) {
  const value = Number(generation);
  assertCondition(Number.isSafeInteger(value), "generation is not precision-safe for provider exact-generation calls");
  return String(value + 1);
}

async function proveExactGenerationReads({ readerProvider, objectKey, gcsGeneration, expectedBytes }) {
  const stat = await readerProvider.statExactGeneration({ objectKey, gcsGeneration });
  assertCondition(stat.ok, "exact-generation stat did not succeed");
  assertCondition(stat.data.size_bytes === expectedBytes.length, "exact-generation stat size mismatch");

  const read = await readerProvider.openExactGenerationReadStream({ objectKey, gcsGeneration });
  assertCondition(read.ok, "exact-generation read stream did not open");
  assertCondition(read.data.size_bytes === expectedBytes.length, "exact-generation read size mismatch");
  const actualBytes = await collectByteSource(read.data.byte_source);
  assertCondition(actualBytes.equals(expectedBytes), "exact-generation read bytes did not match");
  assertCondition(sha256Hex(actualBytes) === sha256Hex(expectedBytes), "independent SHA-256 verification failed");

  const wrongGeneration = nextWrongGeneration(gcsGeneration);
  const wrongStat = await readerProvider.statExactGeneration({ objectKey, gcsGeneration: wrongGeneration });
  assertSanitizedFailure(wrongStat, "not_found", "wrong-generation stat");
  const wrongRead = await readerProvider.openExactGenerationReadStream({ objectKey, gcsGeneration: wrongGeneration });
  assertSanitizedFailure(wrongRead, "not_found", "wrong-generation read");
}

function createMockStorage(label, state) {
  const calls = {
    label,
    getSignedUrl: [],
    sign: [],
    getMetadata: [],
    createReadStream: [],
  };
  const storage = {
    _kaiGcsSigningPrincipal: `${label}@example.invalid`,
    _kaiGcsSigner: {
      async sign(stringToSign) {
        calls.sign.push({ stringToSign });
        return { signedBlob: createHash("sha256").update(stringToSign).digest("base64") };
      },
    },
    bucket() {
      return {
        file(objectKey, opts = {}) {
          return {
            async getSignedUrl(config) {
              calls.getSignedUrl.push({ objectKey, config });
              const signedHeaders = [
                "content-type",
                ...Object.keys(config.extensionHeaders || {}).map((header) => header.toLowerCase()),
              ].sort().join(";");
              return [`https://example.invalid/gate-b1?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-SignedHeaders=${encodeURIComponent(signedHeaders)}&X-Goog-Signature=redacted`];
            },
            async getMetadata() {
              calls.getMetadata.push({ objectKey, opts });
              if (!state.object || opts.generation !== Number(state.generation)) {
                const error = new Error("mock object generation not found");
                error.code = 404;
                throw error;
              }
              return [{ generation: state.generation, size: String(state.object.length) }];
            },
            createReadStream(options) {
              calls.createReadStream.push({ objectKey, opts, options });
              const stream = new PassThrough();
              process.nextTick(() => {
                if (options?.validation !== "crc32c") {
                  stream.destroy(new Error("crc32c validation was not requested"));
                  return;
                }
                stream.end(Buffer.from(state.object));
              });
              return stream;
            },
          };
        },
      };
    },
  };
  return { storage, calls };
}

async function mockSignedPut({ state, signedUpload, bytes, contentType }) {
  assertSignedPutContract(signedUpload);
  assertCondition(signedUpload.data.headers["Content-Type"] === contentType, "mock PUT content type mismatch");
  assertCondition(bytes.length <= KAI_SPRINT2_MAX_FILE_SIZE_BYTES, "mock PUT exceeded configured size");
  if (state.object) return { status: 412, generation: null };
  state.object = Buffer.from(bytes);
  state.generation = "1700000000000001";
  return { status: 200, generation: state.generation };
}

export async function runGateB1MockGcsProof() {
  const intakeFileId = randomUUID();
  const bytes = Buffer.from("KAI Gate B-1 synthetic object\n", "utf8");
  const objectKeyResult = buildObjectKey({
    organizationId: SYNTHETIC_ORGANIZATION_ID,
    intakeBatchId: SYNTHETIC_BATCH_ID,
    intakeFileId,
    safeFilename: SYNTHETIC_SAFE_FILENAME,
  });
  assertCondition(objectKeyResult.ok, "synthetic object key policy failed");

  const state = { object: null, generation: null };
  const signerClient = createMockStorage("upload-signing", state);
  const readerClient = createMockStorage("parser-read", state);
  const signerProvider = createGoogleCloudStorageProvider({
    bucketName: "gate-b1-synthetic-bucket",
    enabled: true,
    maxUploadSizeBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
    storageClientFactory: () => signerClient.storage,
  });
  const readerProvider = createGoogleCloudStorageProvider({
    bucketName: "gate-b1-synthetic-bucket",
    enabled: true,
    maxUploadSizeBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
    storageClientFactory: () => readerClient.storage,
  });

  const signedUpload = await signerProvider.createSignedUploadUrl({
    objectKey: objectKeyResult.objectKey,
    contentType: SYNTHETIC_CONTENT_TYPE,
  });
  const firstCreate = await mockSignedPut({ state, signedUpload, bytes, contentType: SYNTHETIC_CONTENT_TYPE });
  assertCondition(firstCreate.status === 200, "first synthetic create did not succeed");
  const replay = await mockSignedPut({ state, signedUpload, bytes, contentType: SYNTHETIC_CONTENT_TYPE });
  assertCondition(replay.status === 412, "replay/create was not rejected");

  await proveExactGenerationReads({
    readerProvider,
    objectKey: objectKeyResult.objectKey,
    gcsGeneration: firstCreate.generation,
    expectedBytes: bytes,
  });

  assertCondition(signerClient.calls.sign.length === 1, "signer client was not used for signing");
  assertCondition(signerClient.calls.getSignedUrl.length === 0, "SDK getSignedUrl path was used for signing");
  assertCondition(readerClient.calls.getSignedUrl.length === 0, "reader client was used for signing");
  assertCondition(readerClient.calls.sign.length === 0, "reader client was used for signing");
  assertCondition(readerClient.calls.getMetadata.length >= 2, "reader client was not used for stat/read");
  assertCondition(signerClient.calls.getMetadata.length === 0, "signer client was used for stat/read");

  return {
    intakeFileId,
    objectVersionId: syntheticObjectVersionId(intakeFileId),
    gcsGeneration: firstCreate.generation,
    verifiedChecksum: sha256Hex(bytes),
    verifiedSizeBytes: bytes.length,
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: {
      ...process.env,
      DATABASE_URL: SENTINEL_DATABASE_URL,
      PGHOST: "127.0.0.1",
      PGPORT: options.port,
      PGDATABASE: options.dbName,
      PGUSER: options.user,
    },
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    fail(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

async function proveRunnerOwnedTarget(targetUrl, dbName, port) {
  const parsed = new URL(targetUrl);
  assertCondition(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase()), "PostgreSQL target is not loopback");
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT current_database() AS database_name,
             inet_server_addr()::text AS server_addr,
             inet_server_port()::text AS server_port,
             current_setting('listen_addresses') AS listen_addresses
    `);
    const row = result.rows[0];
    assertCondition(row.database_name === dbName, "PostgreSQL database name is not synthetic");
    assertCondition(row.server_port === port, "PostgreSQL port mismatch");
    assertCondition(row.listen_addresses === "127.0.0.1", "PostgreSQL listen_addresses is not loopback-only");
  } finally {
    await client.end();
  }
}

export async function withIsolatedPostgres(callback) {
  const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  const dbName = "kai_gate_b1_gcs_synthetic";
  const defaultServerBin = "/opt/homebrew/opt/postgresql@16/bin";
  const fallbackBin = "/opt/homebrew/opt/libpq/bin";
  const binDir = process.env.PG_BIN_DIR || (existsSync(join(defaultServerBin, "postgres")) ? defaultServerBin : fallbackBin);
  const initdb = join(binDir, "initdb");
  const pgCtl = join(binDir, "pg_ctl");
  const psql = join(binDir, "psql");
  const createdb = join(binDir, "createdb");
  const workDir = mkdtempSync(join(tmpdir(), "kai-gate-b1-pg-"));
  const dataDir = join(workDir, "data");
  const socketDir = join(workDir, "socket");
  const logFile = join(workDir, "postgres.log");
  const port = String(64100 + Math.floor(Math.random() * 800));
  const user = process.env.USER || "postgres";
  const targetUrl = `postgresql://${user}@127.0.0.1:${port}/${dbName}`;
  let started = false;

  function psqlFile(path) {
    return run(psql, ["-v", "ON_ERROR_STOP=1", "-d", dbName, "-f", path], {
      cwd: repoRoot,
      capture: true,
      port,
      dbName,
      user,
    }).stdout;
  }

  try {
    mkdirSync(socketDir, { recursive: true });
    run(initdb, ["-D", dataDir, "--no-locale", "--encoding=UTF8"], { cwd: repoRoot, capture: true, port, dbName, user });
    run(pgCtl, ["-D", dataDir, "-l", logFile, "-o", `-k ${socketDir} -h 127.0.0.1 -p ${port}`, "start"], {
      cwd: repoRoot,
      capture: true,
      port,
      dbName,
      user,
    });
    started = true;
    run(createdb, ["-h", "127.0.0.1", "-p", port, dbName], { cwd: repoRoot, capture: true, port, dbName, user });
    await proveRunnerOwnedTarget(targetUrl, dbName, port);

    psqlFile("scripts/kai-sprint2-gate-a-bootstrap-synthetic-schema.sql");
    psqlFile("migrations/kai_sprint2_gate_a_p0_upload_lifecycle.sql");
    psqlFile("migrations/kai_sprint2_gate_a_p0_policy_decision_replay.sql");
    psqlFile("migrations/kai_sprint2_gate_c1_gcs_generation_binding.sql");

    return await callback({ targetUrl });
  } finally {
    if (started) spawnSync(pgCtl, ["-D", dataDir, "stop", "-m", "fast"], { encoding: "utf8", stdio: "ignore" });
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function provePostgresGenerationBinding({
  targetUrl,
  intakeFileId,
  objectVersionId,
  gcsGeneration,
  verifiedChecksum,
  verifiedSizeBytes,
}) {
  const parsedTarget = new URL(targetUrl);
  const client = new Client({ connectionString: targetUrl, ssl: false });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO kai.intake_files (
         intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
         checksum, hash_algorithm, upload_state, object_version_id, created_at
       )
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4, $5, 'sha256', 'uploaded_unconfirmed', $6, $7::timestamptz)`,
      [
        intakeFileId,
        SYNTHETIC_BATCH_ID,
        SYNTHETIC_ORGANIZATION_ID,
        SYNTHETIC_SAFE_FILENAME,
        verifiedChecksum,
        objectVersionId,
        SYNTHETIC_NOW,
      ],
    );
  } finally {
    await client.end();
  }

  process.env.DATABASE_URL = "";
  process.env.DATABASE_URL_LOCAL = "";
  process.env.PGURL_LOCAL = "";
  process.env.RENDER_DATABASE_URL = "";
  process.env.PROD_DATABASE_URL = "";
  process.env.DB_HOST = parsedTarget.hostname;
  process.env.DB_PORT = parsedTarget.port;
  process.env.DB_NAME = parsedTarget.pathname.replace(/^\//, "");
  process.env.DB_USER = decodeURIComponent(parsedTarget.username);
  process.env.DB_PASSWORD = "";
  const [{ createPostgresUploadLifecycleRepository }, { default: pool }] = await Promise.all([
    import("../Backend/kai/upload/postgresUploadLifecycleRepository.js"),
    import("../Backend/kai/db/kaiDb.js"),
  ]);
  const repository = createPostgresUploadLifecycleRepository();
  try {
    const bind = await repository.bindGcsGeneration({
      organizationId: SYNTHETIC_ORGANIZATION_ID,
      intakeFileId,
      objectVersionId,
      gcsGeneration,
      now: SYNTHETIC_NOW,
    });
    assertCondition(bind.ok && bind.data.replayed === false, "initial PostgreSQL generation bind failed");
    const replay = await repository.bindGcsGeneration({
      organizationId: SYNTHETIC_ORGANIZATION_ID,
      intakeFileId,
      objectVersionId,
      gcsGeneration,
      now: SYNTHETIC_NOW,
    });
    assertCondition(replay.ok && replay.data.replayed === true, "PostgreSQL same-generation replay was not idempotent");
    const wrong = await repository.bindGcsGeneration({
      organizationId: SYNTHETIC_ORGANIZATION_ID,
      intakeFileId,
      objectVersionId,
      gcsGeneration: nextWrongGeneration(gcsGeneration),
      now: SYNTHETIC_NOW,
    });
    assertCondition(wrong.ok === false && wrong.error.code === "conflict_current_state_changed", "PostgreSQL wrong-generation bind was not rejected");
    const resolved = await repository.resolveGcsGenerationBinding({
      organizationId: SYNTHETIC_ORGANIZATION_ID,
      intakeFileId,
    });
    assertCondition(resolved.ok, "PostgreSQL generation binding did not resolve");
    assertCondition(resolved.data.object_version_id === objectVersionId, "PostgreSQL objectVersionId binding mismatch");
    assertCondition(resolved.data.gcs_generation === gcsGeneration, "PostgreSQL generation binding mismatch");
    assertCondition(Number.isSafeInteger(verifiedSizeBytes), "verifiedSizeBytes was not preserved as a safe integer");
  } finally {
    await pool.end();
  }
}

export async function runGateB1LocalVerifier() {
  const proof = await runGateB1MockGcsProof();
  await withIsolatedPostgres((pg) => provePostgresGenerationBinding({ ...pg, ...proof }));
  return proof;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) fail(`${name} is required for live Gate B-1 execution`);
  return value;
}

async function signedPut({ signedUpload, bytes }) {
  assertSignedPutContract(signedUpload);
  const response = await fetch(signedUpload.data.url, {
    method: "PUT",
    headers: signedUpload.data.headers,
    body: bytes,
  });
  return {
    status: response.status,
    generation: response.headers.get("x-goog-generation"),
  };
}

export async function runGateB1LiveVerifier() {
  const bucketName = requiredEnv("KAI_GATE_B1_GCS_BUCKET_NAME");
  const uploadSigningPrincipal = requiredEnv("KAI_GATE_B1_GCS_UPLOAD_SIGNER_TARGET_PRINCIPAL");
  const parserReadPrincipal = requiredEnv("KAI_GATE_B1_GCS_PARSER_READER_TARGET_PRINCIPAL");
  const intakeFileId = randomUUID();
  const bytes = Buffer.from("KAI Gate B-1 live synthetic object\n", "utf8");
  const objectKeyResult = buildObjectKey({
    organizationId: SYNTHETIC_ORGANIZATION_ID,
    intakeBatchId: SYNTHETIC_BATCH_ID,
    intakeFileId,
    safeFilename: SYNTHETIC_SAFE_FILENAME,
  });
  assertCondition(objectKeyResult.ok, "live synthetic object key policy failed");

  const uploadSigningClient = await createImpersonatedStorageClient({ targetPrincipal: uploadSigningPrincipal });
  const parserReadClient = await createImpersonatedStorageClient({ targetPrincipal: parserReadPrincipal });
  const signerProvider = createGoogleCloudStorageProvider({
    bucketName,
    enabled: true,
    maxUploadSizeBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
    storageClientFactory: () => uploadSigningClient,
  });
  const readerProvider = createGoogleCloudStorageProvider({
    bucketName,
    enabled: true,
    maxUploadSizeBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
    storageClientFactory: () => parserReadClient,
  });

  const signedUpload = await signerProvider.createSignedUploadUrl({
    objectKey: objectKeyResult.objectKey,
    contentType: SYNTHETIC_CONTENT_TYPE,
  });
  const firstCreate = await signedPut({ signedUpload, bytes });
  assertCondition(firstCreate.status >= 200 && firstCreate.status < 300, "first live synthetic create did not succeed");
  assertCondition(/^[1-9][0-9]{0,15}$/.test(String(firstCreate.generation || "")), "authoritative GCS generation was not captured");
  const replay = await signedPut({ signedUpload, bytes });
  assertCondition([403, 412].includes(replay.status), "live replay/create was not rejected");

  await proveExactGenerationReads({
    readerProvider,
    objectKey: objectKeyResult.objectKey,
    gcsGeneration: firstCreate.generation,
    expectedBytes: bytes,
  });

  const proof = {
    intakeFileId,
    objectVersionId: syntheticObjectVersionId(intakeFileId),
    gcsGeneration: firstCreate.generation,
    verifiedChecksum: sha256Hex(bytes),
    verifiedSizeBytes: bytes.length,
  };
  await withIsolatedPostgres((pg) => provePostgresGenerationBinding({ ...pg, ...proof }));
  return proof;
}

async function proveContentTypeMutationRejected({ signerProvider, objectKey }) {
  const signedUpload = await signerProvider.createSignedUploadUrl({
    objectKey,
    contentType: SYNTHETIC_CONTENT_TYPE,
  });
  assertSignedPutContract(signedUpload);
  const mutatedHeaders = { ...signedUpload.data.headers, "Content-Type": "application/octet-stream" };
  const response = await fetch(signedUpload.data.url, {
    method: "PUT",
    headers: mutatedHeaders,
    body: Buffer.from("gate-b1 negative content-type probe\n", "utf8"),
  });
  return response.status;
}

async function proveOutOfRangeBodyRejected({ signerProvider, objectKey }) {
  const signedUpload = await signerProvider.createSignedUploadUrl({
    objectKey,
    contentType: SYNTHETIC_CONTENT_TYPE,
  });
  assertSignedPutContract(signedUpload);
  const oversizedBody = Buffer.alloc(KAI_SPRINT2_MAX_FILE_SIZE_BYTES + 1, 0x4b);
  const response = await fetch(signedUpload.data.url, {
    method: "PUT",
    headers: signedUpload.data.headers,
    body: oversizedBody,
  });
  return { status: response.status, bytes: oversizedBody.length };
}

function freshSyntheticObjectKey() {
  const objectKeyResult = buildObjectKey({
    organizationId: SYNTHETIC_ORGANIZATION_ID,
    intakeBatchId: SYNTHETIC_BATCH_ID,
    intakeFileId: randomUUID(),
    safeFilename: SYNTHETIC_SAFE_FILENAME,
  });
  assertCondition(objectKeyResult.ok, "synthetic object key policy failed");
  return objectKeyResult.objectKey;
}

// Exercises only the two signed-request negative requirements against the real
// synthetic target: Content-Type enforcement and content-length-range enforcement.
// Deliberately does not repeat the full positive proof (no read-back, no Postgres
// binding) so it can be run in isolation from the already-proven assertions.
export async function runGateB1LiveNegativeSignedRequestProof() {
  const bucketName = requiredEnv("KAI_GATE_B1_GCS_BUCKET_NAME");
  const uploadSigningPrincipal = requiredEnv("KAI_GATE_B1_GCS_UPLOAD_SIGNER_TARGET_PRINCIPAL");
  const uploadSigningClient = await createImpersonatedStorageClient({ targetPrincipal: uploadSigningPrincipal });
  const signerProvider = createGoogleCloudStorageProvider({
    bucketName,
    enabled: true,
    maxUploadSizeBytes: KAI_SPRINT2_MAX_FILE_SIZE_BYTES,
    storageClientFactory: () => uploadSigningClient,
  });

  const contentTypeStatus = await proveContentTypeMutationRejected({
    signerProvider,
    objectKey: freshSyntheticObjectKey(),
  });
  const rangeResult = await proveOutOfRangeBodyRejected({
    signerProvider,
    objectKey: freshSyntheticObjectKey(),
  });

  return {
    contentTypeMutationRejected: contentTypeStatus < 200 || contentTypeStatus >= 300,
    contentTypeMutationStatus: contentTypeStatus,
    outOfRangeUploadRejected: rangeResult.status < 200 || rangeResult.status >= 300,
    outOfRangeStatus: rangeResult.status,
    outOfRangeBodyBytes: rangeResult.bytes,
  };
}

async function main() {
  process.env.DATABASE_URL = SENTINEL_DATABASE_URL;
  if (process.argv.includes("--live-negative-signed-request")) {
    const result = await runGateB1LiveNegativeSignedRequestProof();
    console.log(JSON.stringify(result));
    return;
  }
  if (process.argv.includes("--live")) {
    await runGateB1LiveVerifier();
    console.log("GATE_B1_SYNTHETIC_GCS_PROOF_COMPLETE");
    return;
  }
  await runGateB1LocalVerifier();
  console.log("GATE_B1_LOCAL_SYNTHETIC_VERIFIER_COMPLETE");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
