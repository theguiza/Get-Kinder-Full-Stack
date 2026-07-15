import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { kaiIdempotentWriteConflict } from "../Backend/kai/internal/kaiIdempotentWriteConflict.js";
import { reserveIntakeFileMetadata } from "../Backend/kai/services/kaiIntakeService.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeFileId = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const idempotencyKey = "file-write-conflict-001";
const checksum = "a".repeat(64);
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
  ],
});

const fileInput = Object.freeze({
  actorContext,
  organizationId,
  engagementId,
  intakeBatchId,
  intakeFileId,
  idempotencyKey,
  originalFilename: "reservation.csv",
  safeFilename: "reservation.csv",
  mimeType: "text/csv",
  fileExtension: ".csv",
  fileSizeBytes: 0,
  checksum,
  hashAlgorithm: "sha256",
});

const expectedLookup = Object.freeze({
  organizationId,
  operation: "reserve_intake_file_metadata",
  engagementId,
  intakeBatchId,
  idempotencyKey,
});

function baseDependencies(overrides = {}) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getIntakeBatchTenantState(requestedBatchId, requestedOrganizationId) {
      assert.equal(requestedBatchId, intakeBatchId);
      assert.equal(requestedOrganizationId, organizationId);
      return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
    },
    ...overrides,
  };
}

function existingFile(fileMetadata, extras = {}) {
  return {
    intake_file_id: intakeFileId,
    intake_batch_id: intakeBatchId,
    organization_id: organizationId,
    engagement_id: engagementId,
    safe_filename: "reservation.csv",
    file_policy_status: "pending",
    malware_scan_status: "not_configured",
    processing_status: "quarantined",
    parse_status: "quarantined",
    review_status: "proposed",
    file_metadata: fileMetadata,
    ...extras,
  };
}

async function captureFailure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  assert.fail("Expected operation to reject.");
}

test("file write conflict preserves lookup/checksum/insert order, reuses one scoped lookup object, and returns the existing replay DTO", async () => {
  const events = [];
  const lookupCalls = [];
  const checksumCalls = [];
  let insertCalls = 0;
  let conflictRow = null;

  const result = await reserveIntakeFileMetadata(fileInput, baseDependencies({
    async findIntakeFileReservationByIdempotencyKey(scope) {
      events.push("idempotency_lookup");
      lookupCalls.push(scope);
      return lookupCalls.length === 1 ? null : conflictRow;
    },
    async findIntakeFileReservationByChecksum(scope) {
      events.push("checksum_lookup");
      checksumCalls.push(scope);
      return null;
    },
    async insertIntakeFileMetadata(file) {
      events.push("insert");
      insertCalls += 1;
      const differentBatchFingerprint = file.fileMetadata.reservation_payload_hash === "0".repeat(64)
        ? "1".repeat(64)
        : "0".repeat(64);
      conflictRow = existingFile(file.fileMetadata, {
        batch_metadata: { normalized_payload_hash: differentBatchFingerprint },
      });
      throw kaiIdempotentWriteConflict;
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    data: {
      intake_file_id: intakeFileId,
      intake_batch_id: intakeBatchId,
      organization_id: organizationId,
      engagement_id: engagementId,
      safe_filename: "reservation.csv",
      file_policy_status: "pending",
      malware_scan_status: "not_configured",
      processing_status: "quarantined",
      parse_status: "quarantined",
      review_status: "proposed",
      metadata_only: true,
    },
    warnings: [],
    audit_context: {
      actor_user_id: actorContext.actorUserId,
      actor_type: actorContext.actorType,
      operation: "reserve_intake_file_metadata",
    },
  });
  assert.deepEqual(events, ["idempotency_lookup", "checksum_lookup", "insert", "idempotency_lookup"]);
  assert.equal(insertCalls, 1);
  assert.equal(lookupCalls.length, 2);
  assert.equal(checksumCalls.length, 1);
  assert.deepEqual(checksumCalls[0], { organizationId, checksum });
  assert.deepEqual(lookupCalls[0], expectedLookup);
  assert.deepEqual(lookupCalls[1], expectedLookup);
  assert.equal(lookupCalls[0], lookupCalls[1]);
  assert.equal(Object.isFrozen(lookupCalls[0]), true);
});

test("file write conflict returns duplicate_conflict when the single re-read finds no row", async () => {
  let lookupCalls = 0;
  let checksumCalls = 0;
  let insertCalls = 0;
  const result = await reserveIntakeFileMetadata(fileInput, baseDependencies({
    async findIntakeFileReservationByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      return null;
    },
    async findIntakeFileReservationByChecksum(scope) {
      checksumCalls += 1;
      assert.deepEqual(scope, { organizationId, checksum });
      return null;
    },
    async insertIntakeFileMetadata() {
      insertCalls += 1;
      throw kaiIdempotentWriteConflict;
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "duplicate_conflict");
  assert.equal(result.error.status, 409);
  assert.equal(lookupCalls, 2);
  assert.equal(checksumCalls, 1);
  assert.equal(insertCalls, 1);
});

test("file conflict re-read fails closed for every missing, malformed, or different stored fingerprint", async (t) => {
  const cases = [
    ["missing", (metadata) => {
      const { reservation_payload_hash: omitted, ...withoutFingerprint } = metadata;
      assert.equal(typeof omitted, "string");
      return withoutFingerprint;
    }],
    ["null", (metadata) => ({ ...metadata, reservation_payload_hash: null })],
    ["empty", (metadata) => ({ ...metadata, reservation_payload_hash: "" })],
    ["non-string", (metadata) => ({ ...metadata, reservation_payload_hash: 64 })],
    ["wrong-length", (metadata) => ({ ...metadata, reservation_payload_hash: "a".repeat(63) })],
    ["non-hexadecimal", (metadata) => ({ ...metadata, reservation_payload_hash: "g".repeat(64) })],
    ["uppercase", (metadata) => ({ ...metadata, reservation_payload_hash: "A".repeat(64) })],
    ["different-valid-lowercase", (metadata) => ({
      ...metadata,
      reservation_payload_hash: metadata.reservation_payload_hash === "0".repeat(64)
        ? "1".repeat(64)
        : "0".repeat(64),
    })],
  ];

  for (const [name, storedMetadata] of cases) {
    await t.test(name, async () => {
      const lookupCalls = [];
      let checksumCalls = 0;
      let insertCalls = 0;
      let conflictRow = null;
      const result = await reserveIntakeFileMetadata(fileInput, baseDependencies({
        async findIntakeFileReservationByIdempotencyKey(scope) {
          lookupCalls.push(scope);
          return lookupCalls.length === 1 ? null : conflictRow;
        },
        async findIntakeFileReservationByChecksum() {
          checksumCalls += 1;
          return null;
        },
        async insertIntakeFileMetadata(file) {
          insertCalls += 1;
          assert.match(file.fileMetadata.reservation_payload_hash, /^[0-9a-f]{64}$/);
          conflictRow = existingFile(storedMetadata(file.fileMetadata));
          throw kaiIdempotentWriteConflict;
        },
      }));

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "duplicate_conflict");
      assert.equal(result.error.status, 409);
      assert.equal(lookupCalls.length, 2);
      assert.equal(lookupCalls[0], lookupCalls[1]);
      assert.deepEqual(lookupCalls[0], expectedLookup);
      assert.equal(checksumCalls, 1);
      assert.equal(insertCalls, 1);
    });
  }
});

test("an unrelated signal-shaped file insert failure is rethrown as the identical object", async () => {
  let lookupCalls = 0;
  let checksumCalls = 0;
  let insertCalls = 0;
  const unrelatedError = new Error(kaiIdempotentWriteConflict.message);
  unrelatedError.name = kaiIdempotentWriteConflict.name;
  const failure = await captureFailure(() => reserveIntakeFileMetadata(fileInput, baseDependencies({
    async findIntakeFileReservationByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      return null;
    },
    async findIntakeFileReservationByChecksum() {
      checksumCalls += 1;
      return null;
    },
    async insertIntakeFileMetadata() {
      insertCalls += 1;
      throw unrelatedError;
    },
  })));

  assert.equal(failure, unrelatedError);
  assert.equal(lookupCalls, 1);
  assert.equal(checksumCalls, 1);
  assert.equal(insertCalls, 1);
});

test("an initial file idempotency lookup failure is not classified as a write conflict", async () => {
  let lookupCalls = 0;
  let checksumCalls = 0;
  let insertCalls = 0;
  const failure = await captureFailure(() => reserveIntakeFileMetadata(fileInput, baseDependencies({
    async findIntakeFileReservationByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      throw kaiIdempotentWriteConflict;
    },
    async findIntakeFileReservationByChecksum() {
      checksumCalls += 1;
    },
    async insertIntakeFileMetadata() {
      insertCalls += 1;
    },
  })));

  assert.equal(failure, kaiIdempotentWriteConflict);
  assert.equal(lookupCalls, 1);
  assert.equal(checksumCalls, 0);
  assert.equal(insertCalls, 0);
});

test("a checksum lookup failure is not classified as a write conflict", async () => {
  let lookupCalls = 0;
  let checksumCalls = 0;
  let insertCalls = 0;
  const failure = await captureFailure(() => reserveIntakeFileMetadata(fileInput, baseDependencies({
    async findIntakeFileReservationByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      return null;
    },
    async findIntakeFileReservationByChecksum(scope) {
      checksumCalls += 1;
      assert.deepEqual(scope, { organizationId, checksum });
      throw kaiIdempotentWriteConflict;
    },
    async insertIntakeFileMetadata() {
      insertCalls += 1;
    },
  })));

  assert.equal(failure, kaiIdempotentWriteConflict);
  assert.equal(lookupCalls, 1);
  assert.equal(checksumCalls, 1);
  assert.equal(insertCalls, 0);
});

test("a file conflict re-read failure is preserved and is not converted into replay success", async () => {
  let lookupCalls = 0;
  let checksumCalls = 0;
  let insertCalls = 0;
  const rereadFailure = new Error("file conflict re-read failed");
  const failure = await captureFailure(() => reserveIntakeFileMetadata(fileInput, baseDependencies({
    async findIntakeFileReservationByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      if (lookupCalls === 1) return null;
      throw rereadFailure;
    },
    async findIntakeFileReservationByChecksum() {
      checksumCalls += 1;
      return null;
    },
    async insertIntakeFileMetadata() {
      insertCalls += 1;
      throw kaiIdempotentWriteConflict;
    },
  })));

  assert.equal(failure, rereadFailure);
  assert.equal(lookupCalls, 2);
  assert.equal(checksumCalls, 1);
  assert.equal(insertCalls, 1);
});

test("batch creation and file reservation share the singleton without production exposure or database mapping", () => {
  const sourceFiles = [];
  function collectSourceFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if ([".git", "node_modules", "coverage", "dist", "build"].includes(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collectSourceFiles(entryPath);
      else if (entry.isFile() && [".js", ".mjs", ".cjs", ".ts", ".tsx"].includes(path.extname(entry.name))) {
        sourceFiles.push(entryPath);
      }
    }
  }
  collectSourceFiles(process.cwd());

  const importers = sourceFiles
    .filter((file) => /(?:from\s*|import\s*\(|require\s*\()["'][^"']*kaiIdempotentWriteConflict\.js["']/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(process.cwd(), file).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(importers, [
    "Backend/kai/services/kaiIntakeService.js",
    "__tests__/kai-sprint2-batch-idempotency-conflict.spec.js",
    "__tests__/kai-sprint2-file-idempotency-conflict.spec.js",
  ]);

  const serviceSource = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");
  const querySource = readFileSync("Backend/kai/db/kaiIntakeQueries.js", "utf8");
  const contract = readFileSync("Backend/kai/contracts/KAI_SPRINT2_P0_REPOSITORY_CONTRACT.md", "utf8");
  assert.equal((serviceSource.match(/if \(error !== kaiIdempotentWriteConflict\) throw error;/g) || []).length, 2);
  assert.doesNotMatch(querySource, /kaiIdempotentWriteConflict|KaiIdempotentWriteConflict|23505|unique_violation|ON\s+CONFLICT/i);
  assert.match(contract, /Batch creation and intake-file metadata reservation both use that same exact-identity signal/);
  assert.match(contract, /Neither live SQL insert adapter is claimed to emit it/);
  assert.match(contract, /PostgreSQL mapping, constraints, two-session proof, and atomicity remain Gate-A-dependent/);
  assert.match(contract, /deployed-schema compatibility remains `NOT_CONFIRMED`/);
});
