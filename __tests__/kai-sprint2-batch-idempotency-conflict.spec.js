import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { kaiIdempotentWriteConflict } from "../Backend/kai/internal/kaiIdempotentWriteConflict.js";
import {
  createIntakeBatch,
  reserveIntakeFileMetadata,
} from "../Backend/kai/services/kaiIntakeService.js";

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const engagementId = "2e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeBatchId = "8e426ea1-2be3-4e48-b80f-9783ddbacda0";
const intakeFileId = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const idempotencyKey = "batch-write-conflict-001";
const actorContext = Object.freeze({
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    { organization_id: organizationId, role_name: "gk_operator", membership_status: "active" },
  ],
});

const batchInput = Object.freeze({
  actorContext,
  organizationId,
  engagementId,
  batchCode: "KAI-P0-BATCH-WRITE-CONFLICT-001",
  payload: Object.freeze({ idempotency_key: idempotencyKey }),
});

const expectedLookup = Object.freeze({
  organizationId,
  operation: "create_intake_batch",
  idempotencyKey,
});

function baseDependencies(overrides = {}) {
  return {
    env: { KAI_SPRINT2_ENABLED: "true" },
    async getEngagementTenantState() {
      return { engagement_id: engagementId, organization_id: organizationId };
    },
    ...overrides,
  };
}

function existingBatch(batchMetadata) {
  return {
    intake_batch_id: intakeBatchId,
    organization_id: organizationId,
    engagement_id: engagementId,
    batch_code: batchInput.batchCode,
    processing_status: "received",
    review_status: "proposed",
    idempotency_key: idempotencyKey,
    batch_metadata: batchMetadata,
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

test("batch write conflict re-reads the same scoped dependency once and returns the existing replay DTO", async () => {
  const lookupCalls = [];
  let insertCalls = 0;
  let conflictRow = null;

  const result = await createIntakeBatch(batchInput, baseDependencies({
    async findIntakeBatchByIdempotencyKey(scope) {
      lookupCalls.push(scope);
      return lookupCalls.length === 1 ? null : conflictRow;
    },
    async insertIntakeBatchMetadata(batch) {
      insertCalls += 1;
      conflictRow = existingBatch(batch.batchMetadata);
      throw kaiIdempotentWriteConflict;
    },
  }));

  assert.deepEqual(result, {
    ok: true,
    data: {
      intake_batch_id: intakeBatchId,
      organization_id: organizationId,
      engagement_id: engagementId,
      batch_code: batchInput.batchCode,
      processing_status: "received",
      review_status: "proposed",
      metadata_only: true,
    },
    warnings: [],
    audit_context: {
      actor_user_id: actorContext.actorUserId,
      actor_type: actorContext.actorType,
      operation: "create_intake_batch",
    },
  });
  assert.equal(insertCalls, 1);
  assert.equal(lookupCalls.length, 2);
  assert.deepEqual(lookupCalls, [expectedLookup, expectedLookup]);
});

test("batch write conflict returns duplicate_conflict when the single re-read finds no row", async () => {
  let lookupCalls = 0;
  let insertCalls = 0;
  const result = await createIntakeBatch(batchInput, baseDependencies({
    async findIntakeBatchByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      return null;
    },
    async insertIntakeBatchMetadata() {
      insertCalls += 1;
      throw kaiIdempotentWriteConflict;
    },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "duplicate_conflict");
  assert.equal(result.error.status, 409);
  assert.equal(insertCalls, 1);
  assert.equal(lookupCalls, 2);
});

test("batch conflict re-read fails closed for missing, malformed, or different stored fingerprints", async (t) => {
  for (const fingerprintCase of ["missing", "malformed", "different"]) {
    await t.test(fingerprintCase, async () => {
      let lookupCalls = 0;
      let insertCalls = 0;
      let conflictRow = null;
      const result = await createIntakeBatch(batchInput, baseDependencies({
        async findIntakeBatchByIdempotencyKey(scope) {
          lookupCalls += 1;
          assert.deepEqual(scope, expectedLookup);
          return lookupCalls === 1 ? null : conflictRow;
        },
        async insertIntakeBatchMetadata(batch) {
          insertCalls += 1;
          const requestedFingerprint = batch.batchMetadata.normalized_payload_hash;
          const { normalized_payload_hash: omitted, ...metadataWithoutFingerprint } = batch.batchMetadata;
          assert.match(requestedFingerprint, /^[0-9a-f]{64}$/);
          assert.equal(typeof omitted, "string");
          const batchMetadata = fingerprintCase === "missing"
            ? metadataWithoutFingerprint
            : {
                ...metadataWithoutFingerprint,
                normalized_payload_hash: fingerprintCase === "malformed"
                  ? "not-a-current-format-fingerprint"
                  : requestedFingerprint === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64),
              };
          conflictRow = existingBatch(batchMetadata);
          throw kaiIdempotentWriteConflict;
        },
      }));

      assert.equal(result.ok, false);
      assert.equal(result.error.code, "duplicate_conflict");
      assert.equal(result.error.status, 409);
      assert.equal(insertCalls, 1);
      assert.equal(lookupCalls, 2);
    });
  }
});

test("an unrelated signal-shaped insert failure is rethrown as the identical object", async () => {
  let lookupCalls = 0;
  let insertCalls = 0;
  const unrelatedError = new Error(kaiIdempotentWriteConflict.message);
  unrelatedError.name = kaiIdempotentWriteConflict.name;

  const failure = await captureFailure(() => createIntakeBatch(batchInput, baseDependencies({
    async findIntakeBatchByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      return null;
    },
    async insertIntakeBatchMetadata() {
      insertCalls += 1;
      throw unrelatedError;
    },
  })));

  assert.equal(failure, unrelatedError);
  assert.equal(insertCalls, 1);
  assert.equal(lookupCalls, 1);
});

test("an initial lookup failure is not classified as an insert write conflict", async () => {
  let lookupCalls = 0;
  let insertCalls = 0;
  const failure = await captureFailure(() => createIntakeBatch(batchInput, baseDependencies({
    async findIntakeBatchByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      throw kaiIdempotentWriteConflict;
    },
    async insertIntakeBatchMetadata() {
      insertCalls += 1;
    },
  })));

  assert.equal(failure, kaiIdempotentWriteConflict);
  assert.equal(lookupCalls, 1);
  assert.equal(insertCalls, 0);
});

test("a conflict re-read failure is preserved and is not classified as replay success", async () => {
  let lookupCalls = 0;
  let insertCalls = 0;
  const rereadFailure = new Error("conflict re-read failed");
  const failure = await captureFailure(() => createIntakeBatch(batchInput, baseDependencies({
    async findIntakeBatchByIdempotencyKey(scope) {
      lookupCalls += 1;
      assert.deepEqual(scope, expectedLookup);
      if (lookupCalls === 1) return null;
      throw rereadFailure;
    },
    async insertIntakeBatchMetadata() {
      insertCalls += 1;
      throw kaiIdempotentWriteConflict;
    },
  })));

  assert.equal(failure, rereadFailure);
  assert.equal(lookupCalls, 2);
  assert.equal(insertCalls, 1);
});

test("the conflict signal is not barrel-exported or route-imported", () => {
  const kaiBarrel = readFileSync("Backend/kai/index.js", "utf8");
  const rootEntry = readFileSync("index.js", "utf8");
  const routeSources = readdirSync("Backend/kai/routes", { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name) === ".js")
    .map((entry) => readFileSync(path.join("Backend/kai/routes", entry.name), "utf8"))
    .join("\n");
  const forbidden = /kaiIdempotentWriteConflict|KaiIdempotentWriteConflict/;

  assert.doesNotMatch(kaiBarrel, forbidden);
  assert.doesNotMatch(rootEntry, forbidden);
  assert.doesNotMatch(routeSources, forbidden);
});

test("intake-file reservation does not classify the batch conflict signal", async () => {
  let idempotencyLookupCalls = 0;
  let checksumLookupCalls = 0;
  let insertCalls = 0;
  const failure = await captureFailure(() => reserveIntakeFileMetadata({
    actorContext,
    organizationId,
    engagementId,
    intakeBatchId,
    intakeFileId,
    idempotencyKey: "file-reservation-unchanged-001",
    safeFilename: "reservation.csv",
    checksum: "a".repeat(64),
    hashAlgorithm: "sha256",
  }, baseDependencies({
    async getIntakeBatchTenantState(requestedBatchId, requestedOrganizationId) {
      assert.equal(requestedBatchId, intakeBatchId);
      assert.equal(requestedOrganizationId, organizationId);
      return { intake_batch_id: intakeBatchId, organization_id: organizationId, engagement_id: engagementId };
    },
    async findIntakeFileReservationByIdempotencyKey() {
      idempotencyLookupCalls += 1;
      return null;
    },
    async findIntakeFileReservationByChecksum() {
      checksumLookupCalls += 1;
      return null;
    },
    async insertIntakeFileMetadata() {
      insertCalls += 1;
      throw kaiIdempotentWriteConflict;
    },
  })));

  assert.equal(failure, kaiIdempotentWriteConflict);
  assert.equal(idempotencyLookupCalls, 1);
  assert.equal(checksumLookupCalls, 1);
  assert.equal(insertCalls, 1);
});
