import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  __testables as intakeServiceTestables,
  confirmUpload,
  createIntakeBatch,
  reserveIntakeFileMetadata,
  requestUploadUrl,
  uploadReservedIntakeFile,
} from "../Backend/kai/services/kaiIntakeService.js";
import { getIntakeBatchTenantState } from "../Backend/kai/db/kaiQueries.js";

const actorContext = {
  actorType: "human",
  actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
  kaiRoles: ["gk_operator"],
  organizationMemberships: [
    {
      organization_id: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
      role_name: "gk_operator",
      membership_status: "active",
    },
  ],
};

const ids = {
  organizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
  engagementId: "2e426ea1-2be3-4e48-b80f-9783ddbacda0",
  intakeBatchId: "8e426ea1-2be3-4e48-b80f-9783ddbacda0",
  intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b",
};
const otherOrganizationId = "b5d17c5a-c55f-43af-9b21-fe63aafe733f";
const enabledUploadEnv = {
  KAI_SPRINT2_ENABLED: "true",
  KAI_FILE_UPLOAD_ENABLED: "true",
};
const uploadNow = "2026-07-23T10:00:00.000Z";
const objectVersionId = "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const otherIntakeFileId = "1fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const verifyExactObjectVersionStreamed = intakeServiceTestables.verifyExactObjectVersionStreamed;

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactVersionByteSource(chunks, hooks = {}) {
  let closeCount = 0;
  const source = {
    get closeCount() {
      return closeCount;
    },
    async close() {
      closeCount += 1;
      if (hooks.onClose) await hooks.onClose();
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        if (hooks.onBeforeChunk) await hooks.onBeforeChunk(chunk);
        yield chunk;
        if (hooks.onAfterChunk) await hooks.onAfterChunk(chunk);
      }
    },
  };
  return source;
}

function exactVersionStorageAdapter({
  chunks = [Buffer.from("exact bytes")],
  storageSizeBytes,
  returnedObjectVersionId = objectVersionId,
  result,
  source,
  onOpen,
} = {}) {
  const byteSource = source || exactVersionByteSource(chunks);
  const adapter = {
    calls: [],
    byteSource,
    async openObjectVersionReadStream(input) {
      adapter.calls.push(input);
      if (onOpen) return await onOpen(input);
      if (Object.hasOwn({ result }, "result") && result !== undefined) return result;
      return {
        ok: true,
        data: {
          object_version_id: returnedObjectVersionId,
          size_bytes: storageSizeBytes ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
          byte_source: byteSource,
        },
      };
    },
  };
  return adapter;
}

async function verifyExact(overrides = {}) {
  const chunks = overrides.chunks || [Buffer.from("exact bytes")];
  const bytes = Buffer.concat(chunks);
  const storageAdapter = overrides.storageAdapter || exactVersionStorageAdapter({
    chunks,
    ...(Object.hasOwn(overrides, "storageSizeBytes") ? { storageSizeBytes: overrides.storageSizeBytes } : {}),
    ...(Object.hasOwn(overrides, "returnedObjectVersionId") ? { returnedObjectVersionId: overrides.returnedObjectVersionId } : {}),
    ...(Object.hasOwn(overrides, "source") ? { source: overrides.source } : {}),
    ...(Object.hasOwn(overrides, "result") ? { result: overrides.result } : {}),
    ...(Object.hasOwn(overrides, "onOpen") ? { onOpen: overrides.onOpen } : {}),
  });
  return await verifyExactObjectVersionStreamed({
    storageAdapter,
    objectVersionId: overrides.objectVersionId ?? objectVersionId,
    declaredChecksum: overrides.declaredChecksum ?? sha256Hex(bytes),
    expectedSizeBytes: overrides.expectedSizeBytes ?? bytes.byteLength,
    hashAlgorithm: overrides.hashAlgorithm ?? "sha256",
    ...(Object.hasOwn(overrides, "signal") ? { signal: overrides.signal } : {}),
  });
}

function intakeFileRow(overrides = {}) {
  return {
    intake_file_id: ids.intakeFileId,
    intake_batch_id: ids.intakeBatchId,
    organization_id: ids.organizationId,
    engagement_id: ids.engagementId,
    ...overrides,
  };
}

function uploadInput(overrides = {}) {
  return {
    actorContext,
    organizationId: ids.organizationId,
    engagementId: ids.engagementId,
    intakeBatchId: ids.intakeBatchId,
    intakeFileId: ids.intakeFileId,
    now: uploadNow,
    bytes: Buffer.from("fresh upload bytes"),
    ...overrides,
  };
}

function safeUploadBoundary(result) {
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /fresh upload bytes|secret raw bytes|\/private\/|rootDirectory|objectsDirectory|\.bin|storage_object_key|bucket|storage_uri|signed_url|provider_private/i);
  assert.equal("bytes" in (result.data || {}), false);
}

function assertNoUploadObjectIdentity(result) {
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /object_version_id|size_bytes|internal_recovery|storage_object_key|bucket|storage_uri|signed_url/i);
}

function uploadDependencies({ transitions = [], storage = {}, row = intakeFileRow(), order = [] } = {}) {
  let transitionIndex = 0;
  return {
    env: enabledUploadEnv,
    async getIntakeFileMetadata(organizationId, intakeFileId) {
      order.push("file_authorized");
      assert.equal(organizationId, ids.organizationId);
      assert.equal(intakeFileId, ids.intakeFileId);
      return row;
    },
    uploadLifecycleRepository: {
      async transitionUploadLifecycle(input) {
        order.push(`${input.expectedUploadState}->${input.newUploadState}`);
        const next = transitions[transitionIndex++];
        if (typeof next === "function") return next(input);
        return next;
      },
    },
    storageAdapter: {
      async createObjectVersion(input) {
        order.push("storage_create");
        if (storage.onCreate) return storage.onCreate(input);
        return {
          ok: true,
          data: {
            object_version_id: objectVersionId,
            size_bytes: 18,
          },
        };
      },
      async deleteObjectVersion() {
        order.push("storage_delete");
        return { ok: true };
      },
    },
  };
}

function transitionSuccess(input, { replayed = false } = {}) {
  return {
    ok: true,
    data: {
      replayed,
      record: {
        organization_id: input.organizationId,
        intake_file_id: input.intakeFileId,
        intake_batch_id: ids.intakeBatchId,
        upload_state: input.newUploadState,
        object_version_id: input.objectVersionId || null,
      },
    },
    error: null,
  };
}

function transitionFailure(code = "conflict_current_state_changed", status = 409) {
  return {
    ok: false,
    data: null,
    error: { code, status },
  };
}

function assertNewReservationRequiredWithoutIdentity(result) {
  assert.equal(result.ok, false);
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
  safeUploadBoundary(result);
}

function tenantScopedBatchDb(batchRow) {
  return {
    async query(sql, params) {
      assert.match(sql, /WHERE intake_batch_id = \$1\s+AND organization_id = \$2/);
      const [requestedBatchId, requestedOrganizationId] = params;
      const matchesTenant = requestedBatchId === batchRow.intake_batch_id
        && requestedOrganizationId === batchRow.organization_id;
      return { rows: matchesTenant ? [batchRow] : [] };
    },
  };
}

test("getIntakeBatchTenantState retrieves a batch for the matching organization", async () => {
  const batchRow = {
    intake_batch_id: ids.intakeBatchId,
    organization_id: ids.organizationId,
    engagement_id: ids.engagementId,
  };

  const result = await getIntakeBatchTenantState(
    ids.intakeBatchId,
    ids.organizationId,
    tenantScopedBatchDb(batchRow),
  );

  assert.deepEqual(result, batchRow);
});

test("getIntakeBatchTenantState does not retrieve a batch for another organization", async () => {
  const batchRow = {
    intake_batch_id: ids.intakeBatchId,
    organization_id: ids.organizationId,
    engagement_id: ids.engagementId,
  };

  const result = await getIntakeBatchTenantState(
    ids.intakeBatchId,
    otherOrganizationId,
    tenantScopedBatchDb(batchRow),
  );

  assert.equal(result, null);
});

test("feature flag disabled blocks Sprint 2 service entry", async () => {
  const result = await createIntakeBatch({ actorContext }, { env: { KAI_SPRINT2_ENABLED: "false" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");
});

test("createIntakeBatch writes metadata through service dependency when enabled", async () => {
  let inserted = null;
  const result = await createIntakeBatch(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      batchCode: "NCWS-001",
      idempotencyKey: "kai-intake-batch-001",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getEngagementTenantState() {
        return { engagement_id: ids.engagementId, organization_id: ids.organizationId };
      },
      async findIntakeBatchByIdempotencyKey() {
        return null;
      },
      async insertIntakeBatchMetadata(batch) {
        inserted = batch;
        return { intake_batch_id: ids.intakeBatchId, batch_code: batch.batchCode };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(inserted.processing_status, undefined);
  assert.equal(inserted.createdBy, actorContext.actorUserId);
  assert.equal(inserted.batchMetadata.p0_pass, "pass2_admin_metadata_intake_verification");
  assert.equal(result.data.batch_code, "NCWS-001");
});

test("reserveIntakeFileMetadata returns validator blocker as ok false without raw upload", async () => {
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      intakeBatchId: ids.intakeBatchId,
      safeFilename: "../unsafe.csv",
      checksum: "abc",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "1" },
      async getIntakeBatchTenantState(intakeBatchId, organizationId) {
        assert.equal(intakeBatchId, ids.intakeBatchId);
        assert.equal(organizationId, ids.organizationId);
        return {
          intake_batch_id: ids.intakeBatchId,
          organization_id: ids.organizationId,
          engagement_id: ids.engagementId,
        };
      },
      async insertBlockedAttemptAuditEvent() {
        return { ok: true, skipped: true };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.error.status, 422);
  assert.equal(result.blockers[0].validator_key, "VAL-STO-004");
  assert.equal(result.blockers[0].blocking_reason, "unsafe_filename");
});

test("reserveIntakeFileMetadata stores metadata defaults without issuing signed URL", async () => {
  let inserted = null;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      intakeBatchId: ids.intakeBatchId,
      intakeFileId: ids.intakeFileId,
      idempotencyKey: "kai-intake-file-001",
      originalFilename: "safe.csv",
      storageBucket: "private-ca-bucket",
      checksum: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      hashAlgorithm: "sha256",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState(intakeBatchId, organizationId) {
        assert.equal(intakeBatchId, ids.intakeBatchId);
        assert.equal(organizationId, ids.organizationId);
        return {
          intake_batch_id: ids.intakeBatchId,
          organization_id: ids.organizationId,
          engagement_id: ids.engagementId,
        };
      },
      async findIntakeFileReservationByIdempotencyKey() {
        return null;
      },
      async findIntakeFileReservationByChecksum() {
        return null;
      },
      async insertIntakeFileMetadata(file) {
        inserted = file;
        return {
          intake_file_id: file.intakeFileId,
          intake_batch_id: file.intakeBatchId,
          organization_id: file.organizationId,
          engagement_id: file.engagementId,
          safe_filename: file.safeFilename,
          storage_provider: file.storageProvider,
          storage_object_key: file.storageObjectKey,
          file_policy_status: file.filePolicyStatus,
          malware_scan_status: file.malwareScanStatus,
          processing_status: "quarantined",
          parse_status: "quarantined",
          review_status: "proposed",
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(inserted.storageProvider, "gcs");
  assert.equal(inserted.filePolicyStatus, "pending");
  assert.equal(inserted.malwareScanStatus, "not_configured");
  assert.equal(inserted.rawFileRetained, false);
  assert.equal(inserted.fileMetadata.p0_pass, "pass2_admin_metadata_intake_verification");
  assert.equal(inserted.fileMetadata.checksum_scope, "metadata_reservation_no_raw_file");
  assert.equal(inserted.fileMetadata.checksum_source, "caller_declared");
  assert.equal(inserted.fileMetadata.checksum_verification_status, "unverified");
  assert.equal(inserted.checksum, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(inserted.hashAlgorithm, "sha256");
  assert.equal("storage_provider" in result.data, false);
  assert.equal("storage_bucket" in result.data, false);
  assert.equal("storage_object_key" in result.data, false);
  assert.equal("storage_uri" in result.data, false);
});

test("reserveIntakeFileMetadata blocks cross-org intake batch before file insert", async () => {
  let inserted = false;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      intakeBatchId: ids.intakeBatchId,
      intakeFileId: ids.intakeFileId,
      safeFilename: "safe.csv",
      checksum: "sha256abc",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return {
          intake_batch_id: ids.intakeBatchId,
          organization_id: "00000000-0000-4000-8000-000000000000",
          engagement_id: ids.engagementId,
        };
      },
      async insertIntakeFileMetadata() {
        inserted = true;
      },
      async insertBlockedAttemptAuditEvent() {
        return { ok: true, skipped: true };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
  assert.equal(result.blockers[0].validator_key, "VAL-TEN-001");
  assert.equal(inserted, false);
});

test("reserveIntakeFileMetadata ignores caller storage and malware configuration", async () => {
  let inserted = null;
  const result = await reserveIntakeFileMetadata(
    {
      actorContext,
      organizationId: ids.organizationId,
      engagementId: ids.engagementId,
      intakeBatchId: ids.intakeBatchId,
      intakeFileId: ids.intakeFileId,
      idempotencyKey: "server-controlled-storage-001",
      originalFilename: "safe.csv",
      checksum: "a".repeat(64),
      hashAlgorithm: "sha256",
      storageProvider: "google_cloud_storage",
      storageBucket: "caller-bucket",
      storageUri: "private://caller/object",
      malwareScanStatus: "manual",
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true" },
      async getIntakeBatchTenantState() {
        return {
          intake_batch_id: ids.intakeBatchId,
          organization_id: ids.organizationId,
          engagement_id: ids.engagementId,
        };
      },
      async findIntakeFileReservationByIdempotencyKey() {
        return null;
      },
      async findIntakeFileReservationByChecksum() {
        return null;
      },
      async insertIntakeFileMetadata(file) {
        inserted = file;
        return {
          intake_file_id: file.intakeFileId,
          intake_batch_id: file.intakeBatchId,
          organization_id: file.organizationId,
          engagement_id: file.engagementId,
          safe_filename: file.safeFilename,
          file_policy_status: file.filePolicyStatus,
          malware_scan_status: file.malwareScanStatus,
          processing_status: "quarantined",
          parse_status: "quarantined",
          review_status: "proposed",
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(inserted.storageProvider, "gcs");
  assert.equal(inserted.storageBucket, null);
  assert.notEqual(inserted.storageUri, "private://caller/object");
  assert.equal(inserted.malwareScanStatus, "not_configured");
});

test("requestUploadUrl remains fail-closed in P0", async () => {
  const result = await requestUploadUrl({ env: { KAI_SPRINT2_ENABLED: "true" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");

  const enabledResult = await requestUploadUrl({ env: enabledUploadEnv });
  assert.equal(enabledResult.ok, false);
  assert.equal(enabledResult.error.code, "storage_provider_not_configured");
});

test("confirmUpload remains fail-closed in P0", async () => {
  const result = await confirmUpload({ env: { KAI_SPRINT2_ENABLED: "true" } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "feature_disabled");

  const enabledResult = await confirmUpload({ env: enabledUploadEnv });
  assert.equal(enabledResult.ok, false);
  assert.equal(enabledResult.error.code, "storage_provider_not_configured");
});

test("internal exact-version verifier succeeds for exact bytes, size, and SHA-256", async () => {
  const bytes = Buffer.from("verified exact object bytes");
  const storageAdapter = exactVersionStorageAdapter({ chunks: [bytes] });
  const result = await verifyExact({ chunks: [bytes], storageAdapter });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    objectVersionId,
    verifiedChecksum: sha256Hex(bytes),
    verifiedSizeBytes: bytes.byteLength,
  });
  assert.deepEqual(storageAdapter.calls, [{ objectVersionId }]);
  assert.equal(storageAdapter.byteSource.closeCount, 1);
});

test("internal exact-version verifier hashes multiple chunks without whole-object buffering", async () => {
  const chunks = [Buffer.from("multi-"), new Uint8Array(Buffer.from("chunk-")), Buffer.from("hashing")];
  const source = exactVersionByteSource(chunks);
  const result = await verifyExact({ chunks, source });
  const serviceSource = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");
  const helperSource = serviceSource.slice(
    serviceSource.indexOf("async function verifyExactObjectVersionStreamed"),
    serviceSource.indexOf("function validUploadStartedTransitionSuccess"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.verifiedChecksum, sha256Hex(Buffer.concat(chunks)));
  assert.equal(source.closeCount, 1);
  assert.doesNotMatch(helperSource, /Buffer\.concat|await\s+Array\.from|\.join\(/);
});

test("internal exact-version verifier rejects unsupported algorithm before storage", async () => {
  let opened = false;
  const result = await verifyExact({
    hashAlgorithm: "sha512",
    storageAdapter: {
      async openObjectVersionReadStream() {
        opened = true;
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_request");
  assert.equal(opened, false);
});

test("internal exact-version verifier rejects malformed checksum before storage", async () => {
  for (const declaredChecksum of [
    "a".repeat(63),
    "A".repeat(64),
    "g".repeat(64),
    new String("a".repeat(64)),
  ]) {
    let opened = false;
    const result = await verifyExact({
      declaredChecksum,
      storageAdapter: {
        async openObjectVersionReadStream() {
          opened = true;
        },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid_request");
    assert.equal(opened, false);
  }
});

test("internal exact-version verifier rejects malformed expected size before storage", async () => {
  for (const expectedSizeBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "12"]) {
    let opened = false;
    const result = await verifyExact({
      expectedSizeBytes,
      storageAdapter: {
        async openObjectVersionReadStream() {
          opened = true;
        },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalid_request");
    assert.equal(opened, false);
  }
});

test("internal exact-version verifier fails closed when stream method is missing", async () => {
  const result = await verifyExact({ storageAdapter: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
});

for (const { name, onOpen } of [
  { name: "null", onOpen: async () => null },
  { name: "undefined", onOpen: async () => undefined },
  { name: "primitive", onOpen: async () => "file:///private/tmp/raw-object.bin" },
  { name: "malformed", onOpen: async () => ({ data: { storage_object_key: "private/key" } }) },
]) {
  test(`internal exact-version verifier sanitizes ${name} storage result`, async () => {
    const result = await verifyExact({ onOpen });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.doesNotMatch(JSON.stringify(result), /private|raw-object|storage_object_key|file:|key/i);
  });
}

test("internal exact-version verifier rejects non-boolean storage ok", async () => {
  for (const ok of ["true", 1, null]) {
    const result = await verifyExact({
      onOpen: async () => ({
        ok,
        data: {
          object_version_id: objectVersionId,
          size_bytes: 11,
          byte_source: exactVersionByteSource([Buffer.from("exact bytes")]),
          bucket: "private-bucket",
        },
      }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.doesNotMatch(JSON.stringify(result), /private-bucket|bucket/i);
  }
});

test("internal exact-version verifier rejects wrong returned object-version ID", async () => {
  const source = exactVersionByteSource([Buffer.from("exact bytes")]);
  const result = await verifyExact({
    source,
    returnedObjectVersionId: "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(source.closeCount, 1);
});

test("internal exact-version verifier closes malformed returned object-version ID", async () => {
  for (const returnedObjectVersionId of [
    "provider-generation-123",
    new String(objectVersionId),
    { toString: () => objectVersionId },
  ]) {
    const source = exactVersionByteSource([Buffer.from("exact bytes")]);
    const result = await verifyExact({ source, returnedObjectVersionId });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.equal(source.closeCount, 1);
  }
});

test("internal exact-version verifier rejects malformed storage size", async () => {
  for (const storageSizeBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "11"]) {
    const source = exactVersionByteSource([Buffer.from("exact bytes")]);
    const result = await verifyExact({ source, storageSizeBytes });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.equal(source.closeCount, 1);
  }
});

test("internal exact-version verifier sanitizes close failure after malformed returned object-version ID", async () => {
  const source = exactVersionByteSource([Buffer.from("exact bytes")], {
    async onClose() {
      throw new Error(`close failed for /private/tmp/${objectVersionId}/secret.bin in private-bucket`);
    },
  });
  const result = await verifyExact({
    source,
    returnedObjectVersionId: new String(objectVersionId),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(source.closeCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|bucket|tmp|ov_aaaaaaaa|close failed/i);
});

test("internal exact-version verifier sanitizes close failure after malformed storage size", async () => {
  const source = exactVersionByteSource([Buffer.from("exact bytes")], {
    async onClose() {
      throw new Error("provider close failed for file:///private/tmp/object.bin with raw byte 0xff");
    },
  });
  const result = await verifyExact({
    source,
    storageSizeBytes: "11",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(source.closeCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /provider|file:|private|object\.bin|raw byte|0xff|close failed/i);
});

test("internal exact-version verifier closes storage-size mismatch without consuming chunks", async () => {
  let consumed = false;
  const source = exactVersionByteSource([Buffer.from("exact bytes")], {
    onBeforeChunk() {
      consumed = true;
    },
  });
  const result = await verifyExact({
    source,
    storageSizeBytes: 12,
    expectedSizeBytes: 11,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(consumed, false);
  assert.equal(source.closeCount, 1);
});

test("internal exact-version verifier rejects malformed byte source", async () => {
  let closeCount = 0;
  const result = await verifyExact({
    source: {
      async close() {
        closeCount += 1;
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(closeCount, 1);
});

test("internal exact-version verifier rejects byte source missing close", async () => {
  const result = await verifyExact({
    source: {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("exact bytes");
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
});

test("internal exact-version verifier rejects non-byte chunks", async () => {
  const source = exactVersionByteSource([Buffer.from("exact "), "bytes"]);
  const result = await verifyExact({
    source,
    expectedSizeBytes: 11,
    storageSizeBytes: 11,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(source.closeCount, 1);
});

test("internal exact-version verifier rejects streamed bytes exceeding expected size", async () => {
  const source = exactVersionByteSource([Buffer.from("exact "), Buffer.from("bytes!")]);
  const result = await verifyExact({
    source,
    expectedSizeBytes: 11,
    storageSizeBytes: 11,
    declaredChecksum: sha256Hex(Buffer.from("exact bytes")),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(source.closeCount, 1);
});

test("internal exact-version verifier rejects streamed bytes below expected size", async () => {
  const source = exactVersionByteSource([Buffer.from("short")]);
  const result = await verifyExact({
    source,
    expectedSizeBytes: 11,
    storageSizeBytes: 11,
    declaredChecksum: sha256Hex(Buffer.from("exact bytes")),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(source.closeCount, 1);
});

test("internal exact-version verifier rejects checksum mismatch", async () => {
  const source = exactVersionByteSource([Buffer.from("exact bytes")]);
  const result = await verifyExact({
    source,
    declaredChecksum: "b".repeat(64),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(source.closeCount, 1);
});

test("internal exact-version verifier sanitizes read exception", async () => {
  const source = {
    closeCount: 0,
    async close() {
      this.closeCount += 1;
    },
    async *[Symbol.asyncIterator]() {
      throw new Error(`read failed for /private/tmp/${objectVersionId}/secret.bin`);
    },
  };
  const result = await verifyExact({
    source,
    expectedSizeBytes: 11,
    storageSizeBytes: 11,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(source.closeCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|object\.bin|ov_aaaaaaaa/i);
});

test("internal exact-version verifier handles abort before first chunk", async () => {
  const controller = new AbortController();
  controller.abort();
  const source = {
    closeCount: 0,
    async close() {
      this.closeCount += 1;
    },
    async *[Symbol.asyncIterator]() {
      throw new DOMException("storage_read_aborted", "AbortError");
    },
  };
  const result = await verifyExact({
    source,
    signal: controller.signal,
    expectedSizeBytes: 11,
    storageSizeBytes: 11,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_request");
  assert.equal(source.closeCount, 1);
});

test("internal exact-version verifier handles abort during hashing", async () => {
  const controller = new AbortController();
  const source = exactVersionByteSource([Buffer.from("exact "), Buffer.from("bytes")], {
    onAfterChunk() {
      controller.abort();
    },
  });
  const result = await verifyExact({
    source,
    signal: controller.signal,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_request");
  assert.equal(source.closeCount, 1);
});

test("internal exact-version verifier closes exactly once for every post-open outcome", async () => {
  const cases = [
    {
      name: "success",
      source: exactVersionByteSource([Buffer.from("exact bytes")]),
      overrides: {},
    },
    {
      name: "malformed returned object-version ID",
      source: exactVersionByteSource([Buffer.from("exact bytes")]),
      overrides: { returnedObjectVersionId: new String(objectVersionId) },
    },
    {
      name: "malformed storage size",
      source: exactVersionByteSource([Buffer.from("exact bytes")]),
      overrides: { storageSizeBytes: "11" },
    },
    {
      name: "storage-size mismatch",
      source: exactVersionByteSource([Buffer.from("exact bytes")]),
      overrides: { storageSizeBytes: 12, expectedSizeBytes: 11 },
    },
    {
      name: "malformed chunk",
      source: exactVersionByteSource(["not-bytes"]),
      overrides: { storageSizeBytes: 9, expectedSizeBytes: 9, declaredChecksum: sha256Hex(Buffer.from("not-bytes")) },
    },
    {
      name: "excess bytes",
      source: exactVersionByteSource([Buffer.from("exact bytes!")]),
      overrides: { storageSizeBytes: 11, expectedSizeBytes: 11, declaredChecksum: sha256Hex(Buffer.from("exact bytes")) },
    },
    {
      name: "insufficient bytes",
      source: exactVersionByteSource([Buffer.from("short")]),
      overrides: { storageSizeBytes: 11, expectedSizeBytes: 11, declaredChecksum: sha256Hex(Buffer.from("exact bytes")) },
    },
    {
      name: "checksum mismatch",
      source: exactVersionByteSource([Buffer.from("exact bytes")]),
      overrides: { declaredChecksum: "c".repeat(64) },
    },
    {
      name: "read exception",
      source: {
        closeCount: 0,
        async close() {
          this.closeCount += 1;
        },
        async *[Symbol.asyncIterator]() {
          throw new Error("read failure with provider_private details");
        },
      },
      overrides: {},
    },
  ];

  for (const item of cases) {
    await verifyExact({
      source: item.source,
      ...item.overrides,
    });
    assert.equal(item.source.closeCount, 1, item.name);
  }
});

test("internal exact-version verifier exposes no raw bytes or private storage details on failures", async () => {
  const raw = "secret raw bytes";
  const storageFailure = await verifyExact({
    onOpen: async () => ({
      ok: false,
      error: {
        code: "provider_private_failure",
        message: `failed at /private/tmp/object.bin with ${raw}`,
        status: 500,
      },
      data: {
        bucket: "private-bucket",
        storage_uri: "file:///private/tmp/object.bin",
        signed_url: "https://signed.example/private",
      },
    }),
  });
  const readFailure = await verifyExact({
    source: {
      closeCount: 0,
      async close() {
        this.closeCount += 1;
      },
      async *[Symbol.asyncIterator]() {
        throw new Error(`failed reading ${raw} from provider_private /private/tmp/object.bin`);
      },
    },
    expectedSizeBytes: 11,
    storageSizeBytes: 11,
  });

  for (const result of [storageFailure, readFailure]) {
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret raw bytes|private|bucket|storage_uri|signed_url|file:|provider_private|object\.bin/i);
  }
});

test("uploadReservedIntakeFile fails either feature gate before repository or storage calls", async () => {
  for (const env of [
    { KAI_SPRINT2_ENABLED: "false", KAI_FILE_UPLOAD_ENABLED: "true" },
    { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "false" },
  ]) {
    const result = await uploadReservedIntakeFile(uploadInput(), {
      env,
      async getIntakeFileMetadata() {
        throw new Error("file authorization should not run when gates are disabled");
      },
      uploadLifecycleRepository: {
        async transitionUploadLifecycle() {
          throw new Error("repository should not run when gates are disabled");
        },
      },
      storageAdapter: {
        async createObjectVersion() {
          throw new Error("storage should not run when gates are disabled");
        },
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");
  }
});

test("uploadReservedIntakeFile authorization failure happens before repository or storage calls", async () => {
  const unauthorizedActor = {
    ...actorContext,
    kaiRoles: [],
    organizationMemberships: [],
  };
  const result = await uploadReservedIntakeFile(uploadInput({ actorContext: unauthorizedActor }), {
    env: enabledUploadEnv,
    async getIntakeFileMetadata() {
      throw new Error("file read should not run after authorization failure");
    },
    uploadLifecycleRepository: {
      async transitionUploadLifecycle() {
        throw new Error("repository should not run after authorization failure");
      },
    },
    storageAdapter: {
      async createObjectVersion() {
        throw new Error("storage should not run after authorization failure");
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "authorization_denied");
});

test("uploadReservedIntakeFile fails closed without adapter injection before lifecycle transition", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), {
    env: enabledUploadEnv,
    async getIntakeFileMetadata(organizationId, intakeFileId) {
      order.push("file_authorized");
      assert.equal(organizationId, ids.organizationId);
      assert.equal(intakeFileId, ids.intakeFileId);
      return intakeFileRow();
    },
    uploadLifecycleRepository: {
      async transitionUploadLifecycle() {
        throw new Error("lifecycle must not run without injected storage adapter");
      },
    },
  });

  assert.deepEqual(order, ["file_authorized"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
  assertNoUploadObjectIdentity(result);
});

test("uploadReservedIntakeFile does not construct local adapter from root-directory dependency", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), {
    env: enabledUploadEnv,
    localDevStorageRootDirectory: "/private/tmp/kai-local-storage-root",
    objectVersionIdFactory() {
      throw new Error("service must not construct or configure a local adapter");
    },
    async getIntakeFileMetadata() {
      order.push("file_authorized");
      return intakeFileRow();
    },
    uploadLifecycleRepository: {
      async transitionUploadLifecycle() {
        throw new Error("lifecycle must not run without injected storage adapter");
      },
    },
  });

  assert.deepEqual(order, ["file_authorized"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
  assertNoUploadObjectIdentity(result);
  safeUploadBoundary(result);
});

test("uploadReservedIntakeFile upload_started failure performs no storage write", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [transitionFailure("state_transition_denied", 422)],
    storage: {
      onCreate() {
        throw new Error("storage must not run after upload_started failure");
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "state_transition_denied");
  assertNoUploadObjectIdentity(result);
});

test("uploadReservedIntakeFile thrown initial transition is sanitized before storage", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [
      () => {
        throw new Error(`initial transition leaked ${objectVersionId} at /private/tmp/kai-root/object.bin`);
      },
    ],
    storage: {
      onCreate() {
        throw new Error("storage must not run after thrown initial transition");
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started"]);
  assert.equal(result.error.code, "system_error");
  assertNewReservationRequiredWithoutIdentity(result);
});

test("uploadReservedIntakeFile malformed initial success is rejected before storage", async () => {
  for (const started of [
    { ok: true, data: null },
    { ok: true, data: { replayed: false } },
    { ok: true, data: { replayed: "false", record: transitionSuccess({
      organizationId: ids.organizationId,
      intakeFileId: ids.intakeFileId,
      newUploadState: "upload_started",
    }).data.record } },
  ]) {
    const order = [];
    const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
      order,
      transitions: [started],
      storage: {
        onCreate() {
          throw new Error("storage must not run after malformed initial success");
        },
      },
    }));

    assert.deepEqual(order, ["file_authorized", "reserved->upload_started"]);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assertNewReservationRequiredWithoutIdentity(result);
  }
});

for (const { name, recordOverrides } of [
  {
    name: "wrong organization",
    recordOverrides: { organization_id: otherOrganizationId },
  },
  {
    name: "wrong intake file",
    recordOverrides: { intake_file_id: otherIntakeFileId },
  },
  {
    name: "wrong state",
    recordOverrides: { upload_state: "reserved" },
  },
  {
    name: "assigned object version",
    recordOverrides: { object_version_id: objectVersionId },
  },
]) {
  test(`uploadReservedIntakeFile rejects initial ${name} before storage`, async () => {
    const order = [];
    const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
      order,
      transitions: [
        (input) => {
          const success = transitionSuccess(input);
          return {
            ...success,
            data: {
              ...success.data,
              record: {
                ...success.data.record,
                ...recordOverrides,
              },
            },
          };
        },
      ],
      storage: {
        onCreate() {
          throw new Error(`storage must not run after initial ${name}`);
        },
      },
    }));

    assert.deepEqual(order, ["file_authorized", "reserved->upload_started"]);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assertNewReservationRequiredWithoutIdentity(result);
  });
}

test("uploadReservedIntakeFile successful fresh upload uses required ordering", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [
      (input) => transitionSuccess(input),
      (input) => {
        assert.equal(input.objectVersionId, objectVersionId);
        return transitionSuccess(input);
      },
    ],
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(order, [
    "file_authorized",
    "reserved->upload_started",
    "storage_create",
    "upload_started->uploaded_unconfirmed",
  ]);
  assert.deepEqual(result.data, {
    organization_id: ids.organizationId,
    intake_file_id: ids.intakeFileId,
    intake_batch_id: ids.intakeBatchId,
    upload_state: "uploaded_unconfirmed",
    object_version_id: objectVersionId,
    size_bytes: 18,
    replayed: false,
  });
  safeUploadBoundary(result);
});

test("uploadReservedIntakeFile rejects malformed object-version identity after upload_started", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [(input) => transitionSuccess(input)],
    storage: {
      onCreate() {
        return {
          ok: true,
          data: {
            object_version_id: "provider-generation-123",
            size_bytes: 18,
          },
        };
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
});

test("uploadReservedIntakeFile rejects boxed-string object-version identity after upload_started", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [(input) => transitionSuccess(input)],
    storage: {
      onCreate() {
        return {
          ok: true,
          data: {
            object_version_id: new String(objectVersionId),
            size_bytes: 18,
          },
        };
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
  assert.equal(result.error.code, "system_error");
  assertNewReservationRequiredWithoutIdentity(result);
});

test("uploadReservedIntakeFile rejects object-version identity with matching toString after upload_started", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [(input) => transitionSuccess(input)],
    storage: {
      onCreate() {
        return {
          ok: true,
          data: {
            object_version_id: {
              toString() {
                return objectVersionId;
              },
            },
            size_bytes: 18,
          },
        };
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
  assert.equal(result.error.code, "system_error");
  assertNewReservationRequiredWithoutIdentity(result);
});

test("uploadReservedIntakeFile never returns path-like object-version identity", async () => {
  const pathLikeIdentity = "/private/tmp/kai-root/objects/ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bin";
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [(input) => transitionSuccess(input)],
    storage: {
      onCreate() {
        return {
          ok: true,
          data: {
            object_version_id: pathLikeIdentity,
            size_bytes: 18,
          },
        };
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assert.doesNotMatch(JSON.stringify(result), /\/private\/tmp\/kai-root|objects|\.bin/);
  assertNoUploadObjectIdentity(result);
  safeUploadBoundary(result);
});

test("uploadReservedIntakeFile rejects malformed storage success size_bytes", async () => {
  for (const sizeBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "18"]) {
    const order = [];
    const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
      order,
      transitions: [(input) => transitionSuccess(input)],
      storage: {
        onCreate() {
          return {
            ok: true,
            data: {
              object_version_id: objectVersionId,
              size_bytes: sizeBytes,
            },
          };
        },
      },
    }));

    assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.deepEqual(result.data, { new_reservation_required: true });
    assertNoUploadObjectIdentity(result);
  }
});

test("uploadReservedIntakeFile malformed storage success requires a new reservation", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [(input) => transitionSuccess(input)],
    storage: {
      onCreate() {
        return {
          ok: true,
          data: {},
        };
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
});

for (const { name, storageResult } of [
  { name: "null", storageResult: null },
  { name: "undefined", storageResult: undefined },
  { name: "empty object", storageResult: {} },
  { name: "primitive string", storageResult: "storage-provider-/private/tmp/raw-secret" },
  {
    name: "string ok",
    storageResult: {
      ok: "true",
      data: {
        object_version_id: objectVersionId,
        size_bytes: 18,
        storage_object_key: "provider_private/raw-key",
      },
    },
  },
  {
    name: "numeric ok",
    storageResult: {
      ok: 1,
      data: {
        object_version_id: objectVersionId,
        size_bytes: 18,
        storage_uri: "file:///private/tmp/kai-root/object.bin",
      },
    },
  },
]) {
  test(`uploadReservedIntakeFile malformed storage result ${name} is sanitized`, async () => {
    const order = [];
    const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
      order,
      transitions: [(input) => transitionSuccess(input)],
      storage: {
        onCreate() {
          return storageResult;
        },
      },
    }));

    assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "system_error");
    assert.deepEqual(result.data, { new_reservation_required: true });
    assert.equal(order.includes("upload_started->uploaded_unconfirmed"), false);
    assert.equal(order.includes("storage_delete"), false);
    assertNoUploadObjectIdentity(result);
    safeUploadBoundary(result);
  });
}

test("uploadReservedIntakeFile storage failure leaves uploaded_unconfirmed uncalled", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [(input) => transitionSuccess(input)],
    storage: {
      onCreate() {
        return {
          ok: false,
          error: {
            code: "system_error",
            status: 500,
            message: "private path /private/tmp/secret.bin should not escape",
          },
        };
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
  safeUploadBoundary(result);
});

test("uploadReservedIntakeFile thrown storage error is sanitized and requires a new reservation", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [(input) => transitionSuccess(input)],
    storage: {
      onCreate() {
        throw new Error("failed reading /private/tmp/kai-root/objects/secret.bin");
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
  safeUploadBoundary(result);
});

test("uploadReservedIntakeFile storage abort creates no completed result", async () => {
  const controller = new AbortController();
  controller.abort();
  const order = [];
  const result = await uploadReservedIntakeFile(
    uploadInput({ signal: controller.signal }),
    uploadDependencies({
      order,
      transitions: [(input) => transitionSuccess(input)],
      storage: {
        onCreate({ signal }) {
          assert.equal(signal.aborted, true);
          return {
            ok: false,
            error: { code: "invalid_request", status: 400 },
          };
        },
      },
    }),
  );

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started", "storage_create"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_request");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
});

test("uploadReservedIntakeFile final-transition failure performs no deletion and requires a new reservation", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [
      (input) => transitionSuccess(input),
      transitionFailure("conflict_current_state_changed", 409),
    ],
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
  assert.equal(order.includes("storage_delete"), false);
  safeUploadBoundary(result);
});

for (const { name, finalTransition } of [
  {
    name: "missing record",
    finalTransition: () => ({
      ok: true,
      data: { replayed: false },
      error: null,
    }),
  },
  {
    name: "non-boolean replayed",
    finalTransition: (input) => {
      const success = transitionSuccess(input);
      return {
        ...success,
        data: {
          ...success.data,
          replayed: "false",
        },
      };
    },
  },
  {
    name: "wrong organization",
    finalTransition: (input) => {
      const success = transitionSuccess(input);
      return {
        ...success,
        data: {
          ...success.data,
          record: {
            ...success.data.record,
            organization_id: otherOrganizationId,
          },
        },
      };
    },
  },
  {
    name: "wrong intake file",
    finalTransition: (input) => {
      const success = transitionSuccess(input);
      return {
        ...success,
        data: {
          ...success.data,
          record: {
            ...success.data.record,
            intake_file_id: otherIntakeFileId,
          },
        },
      };
    },
  },
  {
    name: "wrong state",
    finalTransition: (input) => {
      const success = transitionSuccess(input);
      return {
        ...success,
        data: {
          ...success.data,
          record: {
            ...success.data.record,
            upload_state: "upload_started",
          },
        },
      };
    },
  },
  {
    name: "wrong object-version ID",
    finalTransition: (input) => {
      const success = transitionSuccess(input);
      return {
        ...success,
        data: {
          ...success.data,
          record: {
            ...success.data.record,
            object_version_id: "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        },
      };
    },
  },
]) {
  test(`uploadReservedIntakeFile rejects final ${name} without object identity`, async () => {
    const order = [];
    const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
      order,
      transitions: [
        (input) => transitionSuccess(input),
        finalTransition,
      ],
    }));

    assert.deepEqual(order, [
      "file_authorized",
      "reserved->upload_started",
      "storage_create",
      "upload_started->uploaded_unconfirmed",
    ]);
    assert.equal(result.error.code, "conflict_current_state_changed");
    assertNewReservationRequiredWithoutIdentity(result);
    assert.equal(order.includes("storage_delete"), false);
  });
}

test("uploadReservedIntakeFile thrown final-transition error exposes no object identity and requires a new reservation", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [
      (input) => transitionSuccess(input),
      () => {
        throw new Error(`transition failed for ${objectVersionId} at /private/tmp/kai-root/object.bin`);
      },
    ],
  }));

  assert.deepEqual(order, [
    "file_authorized",
    "reserved->upload_started",
    "storage_create",
    "upload_started->uploaded_unconfirmed",
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
  safeUploadBoundary(result);
});

test("uploadReservedIntakeFile fresh retry after replayed upload_started requires a new reservation and creates no second object", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(uploadInput(), uploadDependencies({
    order,
    transitions: [
      (input) => transitionSuccess(input, { replayed: true }),
    ],
    storage: {
      onCreate() {
        throw new Error("fresh retry must not create another object");
      },
    },
  }));

  assert.deepEqual(order, ["file_authorized", "reserved->upload_started"]);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
  assert.deepEqual(result.data, { new_reservation_required: true });
  assertNoUploadObjectIdentity(result);
});

test("uploadReservedIntakeFile rejects caller-supplied recovery input without lifecycle or storage calls", async () => {
  const order = [];
  const result = await uploadReservedIntakeFile(
    uploadInput({
      recovery: {
        object_version_id: objectVersionId,
        size_bytes: 18,
      },
    }),
    uploadDependencies({
      order,
      transitions: [
        () => {
          throw new Error("recovery input must not reach lifecycle");
        },
      ],
      storage: {
        onCreate() {
          throw new Error("recovery input must not reach storage");
        },
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_request");
  assert.deepEqual(order, ["file_authorized"]);
  assertNoUploadObjectIdentity(result);
});
