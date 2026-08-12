import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import {
  __testables as intakeServiceTestables,
  confirmUpload,
  requestUploadUrl,
} from "../Backend/kai/services/kaiIntakeService.js";
import { createGoogleCloudStorageProvider } from "../Backend/kai/storage/googleCloudStorageProvider.js";
import { createInMemoryUploadLifecycleRepository } from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";

const confirmGcsObjectVersion = intakeServiceTestables.confirmGcsObjectVersion;
const verifyExactGcsObjectVersionStreamed = intakeServiceTestables.verifyExactGcsObjectVersionStreamed;

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
  intakeBatchId: "8e426ea1-2be3-4e48-b80f-9783ddbacda0",
  intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b",
};
const enabledUploadEnv = { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true" };
const now = "2026-08-09T10:00:00.000Z";
const objectKey = "kai/org/a5d17c5a-c55f-43af-9b21-fe63aafe733f/intake/8e426ea1-2be3-4e48-b80f-9783ddbacda0/9fe568b1-5c05-4c42-bb1f-6e20de216c7b/safe.pdf";
const exactBytes = Buffer.from("exact bytes");
const declaredChecksum = createHash("sha256").update(exactBytes).digest("hex");
const bucketSecret = "kai-gate-c2a-secret-bucket";

function gcsRow(overrides = {}) {
  return {
    organization_id: ids.organizationId,
    intake_file_id: ids.intakeFileId,
    intake_batch_id: ids.intakeBatchId,
    storage_provider: "gcs",
    storage_object_key: objectKey,
    mime_type: "application/pdf",
    checksum: declaredChecksum,
    hash_algorithm: "sha256",
    file_size_bytes: exactBytes.byteLength,
    ...overrides,
  };
}

function fakeGcsProvider(overrides = {}) {
  const calls = { headObject: [], statExactGeneration: [], openExactGenerationReadStream: [], createSignedUploadUrl: [] };
  return {
    enabled: overrides.enabled ?? true,
    calls,
    async headObject(input) {
      calls.headObject.push(input);
      if (overrides.headObject) return overrides.headObject(input);
      return { ok: true, data: { candidate_generation: "1700000000000001", size_bytes: exactBytes.byteLength } };
    },
    async statExactGeneration(input) {
      calls.statExactGeneration.push(input);
      if (overrides.statExactGeneration) return overrides.statExactGeneration(input);
      return { ok: true, data: { size_bytes: exactBytes.byteLength } };
    },
    async openExactGenerationReadStream(input) {
      calls.openExactGenerationReadStream.push(input);
      if (overrides.openExactGenerationReadStream) return overrides.openExactGenerationReadStream(input);
      return {
        ok: true,
        data: { size_bytes: exactBytes.byteLength, byte_source: Readable.from([Buffer.from(exactBytes)]) },
      };
    },
    async createSignedUploadUrl(input) {
      calls.createSignedUploadUrl.push(input);
      if (overrides.createSignedUploadUrl) return overrides.createSignedUploadUrl(input);
      return {
        ok: true,
        data: {
          url: `https://storage.googleapis.com/${bucketSecret}/${input.objectKey}?X-Goog-Signature=abc`,
          method: "PUT",
          headers: { "Content-Type": input.contentType },
          expires_in_seconds: 900,
        },
      };
    },
  };
}

async function seededReservedRepository() {
  const repository = createInMemoryUploadLifecycleRepository();
  const created = await repository.createReservedUploadLifecycle({
    organizationId: ids.organizationId,
    intakeBatchId: ids.intakeBatchId,
    intakeFileId: ids.intakeFileId,
    now,
  });
  assert.equal(created.ok, true);
  return repository;
}

function confirmDeps({ row = gcsRow(), gcsProvider = fakeGcsProvider(), lifecycleRepository } = {}) {
  return {
    env: enabledUploadEnv,
    gcsProvider,
    uploadLifecycleRepository: lifecycleRepository,
    async getIntakeFileMetadata(organizationId, intakeFileId) {
      assert.equal(organizationId, ids.organizationId);
      assert.equal(intakeFileId, ids.intakeFileId);
      return row;
    },
  };
}

function confirmInput(overrides = {}) {
  return { actorContext, organizationId: ids.organizationId, intakeBatchId: ids.intakeBatchId, intakeFileId: ids.intakeFileId, now, ...overrides };
}

// --- GCS provider: headObject metadata discovery ---

test("Gate C-2A headObject returns a candidate generation and size without pinning a generation", async () => {
  const mockGetMetadata = { calls: 0 };
  const provider = createGoogleCloudStorageProvider({
    bucketName: bucketSecret,
    enabled: true,
    maxUploadSizeBytes: 1000,
    storageClientFactory: () => ({
      bucket: () => ({
        file(key, opts) {
          assert.equal(key, objectKey);
          assert.equal(opts, undefined);
          return {
            async getMetadata() {
              mockGetMetadata.calls += 1;
              return [{ generation: "1700000000000001", size: "11" }];
            },
          };
        },
      }),
    }),
  });
  const result = await provider.headObject({ objectKey });
  assert.equal(result.ok, true);
  assert.equal(result.data.candidate_generation, "1700000000000001");
  assert.equal(result.data.size_bytes, 11);
  assert.equal(mockGetMetadata.calls, 1);
});

test("Gate C-2A headObject is disabled by default and never leaks bucket/key on not_found", async () => {
  const disabled = createGoogleCloudStorageProvider();
  const disabledResult = await disabled.headObject({ objectKey });
  assert.equal(disabledResult.ok, false);
  assert.equal(disabledResult.error.code, "operation_not_enabled");

  const provider = createGoogleCloudStorageProvider({
    bucketName: bucketSecret,
    enabled: true,
    maxUploadSizeBytes: 1000,
    storageClientFactory: () => ({
      bucket: () => ({
        file: () => ({
          async getMetadata() {
            const error = new Error(`not found: bucket=${bucketSecret} object=${objectKey}`);
            error.code = 404;
            throw error;
          },
        }),
      }),
    }),
  });
  const result = await provider.headObject({ objectKey });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(bucketSecret));
  assert.doesNotMatch(serialized, /safe\.pdf/);
});

// --- requestUploadUrl: signed-upload issuance ---

test("Gate C-2A requestUploadUrl issues a signed URL from the trusted reservation's object key and MIME type only", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const gcsProvider = fakeGcsProvider();
  const result = await requestUploadUrl(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  assert.equal(result.ok, true);
  assert.equal(result.data.upload_method, "PUT");
  assert.equal(typeof result.data.upload_url, "string");
  assert.equal(gcsProvider.calls.createSignedUploadUrl.length, 1);
  assert.equal(gcsProvider.calls.createSignedUploadUrl[0].objectKey, objectKey);
  assert.equal(gcsProvider.calls.createSignedUploadUrl[0].contentType, "application/pdf");
});

test("Gate C-2A requestUploadUrl ignores any client-supplied object key/bucket/MIME override", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const gcsProvider = fakeGcsProvider();
  const result = await requestUploadUrl(
    confirmInput({
      storageObjectKey: "attacker/controlled/key.pdf",
      objectKey: "attacker/controlled/key.pdf",
      mimeType: "application/x-evil",
      bucket: "attacker-bucket",
    }),
    confirmDeps({ lifecycleRepository, gcsProvider }),
  );
  assert.equal(result.ok, true);
  assert.equal(gcsProvider.calls.createSignedUploadUrl[0].objectKey, objectKey);
  assert.equal(gcsProvider.calls.createSignedUploadUrl[0].contentType, "application/pdf");
});

test("Gate C-2A requestUploadUrl fails closed when the reservation is not gcs-backed", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const result = await requestUploadUrl(
    confirmInput(),
    confirmDeps({ row: gcsRow({ storage_provider: "local_dev" }), lifecycleRepository, gcsProvider: fakeGcsProvider() }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
});

test("Gate C-2A requestUploadUrl fails closed when the lifecycle is not in the reserved state", async () => {
  const lifecycleRepository = await seededReservedRepository();
  await lifecycleRepository.transitionUploadLifecycle({
    organizationId: ids.organizationId,
    intakeFileId: ids.intakeFileId,
    expectedUploadState: "reserved",
    newUploadState: "upload_started",
    now,
  });
  const result = await requestUploadUrl(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider: fakeGcsProvider() }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict_current_state_changed");
});

test("Gate C-2A requestUploadUrl fails closed when the GCS provider is disabled", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const result = await requestUploadUrl(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider: fakeGcsProvider({ enabled: false }) }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
});

// --- confirmUpload GCS discovery/verification/binding path ---

test("Gate C-2A confirmUpload discovers, re-verifies, binds, and confirms a signed-upload object", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const gcsProvider = fakeGcsProvider();
  const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  assert.equal(result.ok, true);
  assert.equal(result.data.upload_state, "confirmed");
  assert.equal(result.data.verified_size_bytes, exactBytes.byteLength);
  assert.match(result.data.object_version_id, /^ov_[a-f0-9]{32}$/);

  assert.equal(gcsProvider.calls.headObject.length, 1);
  assert.equal(gcsProvider.calls.statExactGeneration.length, 1);
  assert.equal(gcsProvider.calls.statExactGeneration[0].gcsGeneration, "1700000000000001");
  assert.equal(gcsProvider.calls.openExactGenerationReadStream.length, 1);

  const binding = await lifecycleRepository.resolveGcsGenerationBinding({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  assert.equal(binding.data.gcs_generation, "1700000000000001");
  assert.equal(binding.data.object_version_id, result.data.object_version_id);
});

test("Gate C-2A confirmUpload never leaks bucket, object key, or GCS generation in its response", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const gcsProvider = fakeGcsProvider();
  const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /1700000000000001/);
  assert.doesNotMatch(serialized, /safe\.pdf/);
  assert.doesNotMatch(serialized, new RegExp(bucketSecret));
  assert.doesNotMatch(serialized, /storage_object_key/);
});

test("Gate C-2A confirmUpload fails closed when no object exists at the trusted key", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const gcsProvider = fakeGcsProvider({
    headObject: async () => ({ ok: false, error: { code: "not_found", status: 404 } }),
  });
  const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_found");
  assert.equal(result.data.exact_verification_phase, "gcs_head_object");

  const lifecycle = await lifecycleRepository.getUploadLifecycle({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  assert.equal(lifecycle.data.record.upload_state, "reserved");
});

test("Gate C-2A confirmUpload reports a safe phase when the metadata authorization read throws", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const result = await confirmUpload(confirmInput(), {
    env: enabledUploadEnv,
    gcsProvider: fakeGcsProvider(),
    uploadLifecycleRepository: lifecycleRepository,
    async getIntakeFileMetadata() {
      throw new Error(`raw metadata read failure for bucket=${bucketSecret} object=${objectKey}`);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(result.data.exact_verification_phase, "confirm_upload_authorization");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(bucketSecret));
  assert.doesNotMatch(JSON.stringify(result), /safe\.pdf/);
});

test("Gate C-2A confirmUpload reports a safe phase when lifecycle read throws", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const throwingRepository = {
    ...lifecycleRepository,
    async getUploadLifecycle() {
      throw new Error(`raw lifecycle read failure for bucket=${bucketSecret} object=${objectKey}`);
    },
  };
  const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository: throwingRepository, gcsProvider: fakeGcsProvider() }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(result.data.exact_verification_phase, "upload_lifecycle_read");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(bucketSecret));
  assert.doesNotMatch(JSON.stringify(result), /safe\.pdf/);
});

test("Gate C-2A confirmUpload reports a safe phase when lifecycle read returns system_error", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const failingRepository = {
    ...lifecycleRepository,
    async getUploadLifecycle() {
      return {
        ok: false,
        data: {
          storage_object_key: objectKey,
          gcs_generation: "1700000000000001",
        },
        error: {
          code: "system_error",
          status: 500,
          message: `raw lifecycle failure for bucket=${bucketSecret}`,
        },
      };
    },
  };
  const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository: failingRepository, gcsProvider: fakeGcsProvider() }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(result.error.status, 500);
  assert.deepEqual(result.data, { exact_verification_phase: "upload_lifecycle_read" });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(bucketSecret));
  assert.doesNotMatch(JSON.stringify(result), /safe\.pdf|1700000000000001|gcs_generation|storage_object_key/);
});

test("Gate C-2A confirmUpload fails closed when the candidate generation does not survive exact-generation re-verification", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const gcsProvider = fakeGcsProvider({
    statExactGeneration: async () => ({ ok: false, error: { code: "conflict", status: 409 } }),
  });
  const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(result.data.exact_verification_phase, "gcs_stat_exact_generation");

  const lifecycle = await lifecycleRepository.getUploadLifecycle({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  assert.equal(lifecycle.data.record.upload_state, "reserved");
});

test("Gate C-2A confirmUpload fails closed on a streamed size mismatch and confirms nothing", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const gcsProvider = fakeGcsProvider({
    statExactGeneration: async () => ({ ok: true, data: { size_bytes: exactBytes.byteLength } }),
    openExactGenerationReadStream: async () => ({
      ok: true,
      data: { size_bytes: exactBytes.byteLength, byte_source: Readable.from([Buffer.from("short")]) },
    }),
  });
  const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(result.data.exact_verification_phase, "gcs_size_check");

  const lifecycle = await lifecycleRepository.getUploadLifecycle({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  assert.equal(lifecycle.data.record.upload_state, "reserved");
});

test("Gate C-2A confirmUpload fails closed on a checksum mismatch and confirms nothing", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const wrongBytes = Buffer.from("wrong bytes");
  const gcsProvider = fakeGcsProvider({
    statExactGeneration: async () => ({ ok: true, data: { size_bytes: wrongBytes.byteLength } }),
    openExactGenerationReadStream: async () => ({
      ok: true,
      data: { size_bytes: wrongBytes.byteLength, byte_source: Readable.from([Buffer.from(wrongBytes)]) },
    }),
  });
  const result = await confirmUpload(
    confirmInput(),
    confirmDeps({ row: gcsRow({ file_size_bytes: wrongBytes.byteLength }), lifecycleRepository, gcsProvider }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "checksum_mismatch");
  assert.equal(result.data.exact_verification_phase, "gcs_checksum_check");

  const lifecycle = await lifecycleRepository.getUploadLifecycle({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  assert.equal(lifecycle.data.record.upload_state, "reserved");
});

test("Gate C-2A confirmUpload reports a safe phase when the exact-generation stream errors", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const failingStream = new Readable({
    read() {
      this.destroy(new Error(`raw stream failure for bucket=${bucketSecret} object=${objectKey}`));
    },
  });
  const gcsProvider = fakeGcsProvider({
    openExactGenerationReadStream: async () => ({
      ok: true,
      data: { size_bytes: exactBytes.byteLength, byte_source: failingStream },
    }),
  });
  const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.equal(result.data.exact_verification_phase, "gcs_stream_exact_generation");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(bucketSecret));
  assert.doesNotMatch(JSON.stringify(result), /safe\.pdf/);

  const lifecycle = await lifecycleRepository.getUploadLifecycle({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  assert.equal(lifecycle.data.record.upload_state, "reserved");
});

test("Gate C-2A a failure between the uploaded_unconfirmed transition and the generation binding is retry-safe, not stranded", async () => {
  const lifecycleRepository = await seededReservedRepository();
  let bindAttempts = 0;
  const realBind = lifecycleRepository.bindGcsGeneration;
  const flakyRepository = {
    ...lifecycleRepository,
    async bindGcsGeneration(input) {
      bindAttempts += 1;
      if (bindAttempts === 1) return { ok: false, data: null, error: { code: "system_error", status: 500 } };
      return realBind(input);
    },
  };

  const gcsProvider = fakeGcsProvider();
  const firstAttempt = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository: flakyRepository, gcsProvider }));
  assert.equal(firstAttempt.ok, false);
  assert.equal(firstAttempt.error.code, "system_error");
  assert.equal(firstAttempt.data.exact_verification_phase, "gcs_generation_bind");

  const strandedLifecycle = await lifecycleRepository.getUploadLifecycle({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  assert.equal(strandedLifecycle.data.record.upload_state, "uploaded_unconfirmed");
  const strandedObjectVersionId = strandedLifecycle.data.record.object_version_id;
  assert.match(strandedObjectVersionId, /^ov_[a-f0-9]{32}$/);

  const retry = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository: flakyRepository, gcsProvider }));
  assert.equal(retry.ok, true);
  assert.equal(retry.data.object_version_id, strandedObjectVersionId);
  assert.equal(bindAttempts, 2);

  const binding = await lifecycleRepository.resolveGcsGenerationBinding({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  assert.equal(binding.data.gcs_generation, "1700000000000001");
  assert.equal(binding.data.object_version_id, strandedObjectVersionId);
});

test("Gate C-2A confirmUpload reports safe phases for thrown generation lookup and lifecycle transitions", async () => {
  for (const [phase, repositoryOverride] of [
    ["gcs_generation_binding_lookup", {
      async resolveGcsGenerationBinding() {
        throw new Error(`raw lookup failure for bucket=${bucketSecret} object=${objectKey}`);
      },
    }],
    ["gcs_lifecycle_start", {
      async transitionUploadLifecycle(input) {
        if (input.newUploadState === "upload_started") {
          throw new Error(`raw start failure for bucket=${bucketSecret} object=${objectKey}`);
        }
        return this.__base.transitionUploadLifecycle(input);
      },
    }],
    ["gcs_lifecycle_complete", {
      async transitionUploadLifecycle(input) {
        if (input.newUploadState === "uploaded_unconfirmed") {
          throw new Error(`raw complete failure for bucket=${bucketSecret} object=${objectKey}`);
        }
        return this.__base.transitionUploadLifecycle(input);
      },
    }],
    ["gcs_lifecycle_confirm", {
      async transitionUploadLifecycle(input) {
        if (input.newUploadState === "confirmed") {
          throw new Error(`raw confirm failure for bucket=${bucketSecret} object=${objectKey}`);
        }
        return this.__base.transitionUploadLifecycle(input);
      },
    }],
  ]) {
    const lifecycleRepository = await seededReservedRepository();
    const throwingRepository = {
      ...lifecycleRepository,
      __base: lifecycleRepository,
      ...repositoryOverride,
    };
    const result = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository: throwingRepository, gcsProvider: fakeGcsProvider() }));
    assert.equal(result.ok, false, phase);
    assert.equal(result.error.code, "system_error", phase);
    assert.equal(result.data.exact_verification_phase, phase);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(bucketSecret));
    assert.doesNotMatch(JSON.stringify(result), /safe\.pdf/);
  }
});

test("Gate C-2A confirmUpload replay after full confirmation reuses the bound generation without a fresh headObject discovery", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const gcsProvider = fakeGcsProvider();
  const first = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  assert.equal(first.ok, true);
  assert.equal(gcsProvider.calls.headObject.length, 1);

  const replay = await confirmUpload(confirmInput(), confirmDeps({ lifecycleRepository, gcsProvider }));
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.object_version_id, first.data.object_version_id);
  assert.equal(gcsProvider.calls.headObject.length, 1, "a bound generation must not trigger re-discovery");
  assert.equal(gcsProvider.calls.statExactGeneration.length, 2, "byte-exact re-verification still runs on replay");
});

test("Gate C-2A local upload/confirmation path is unaffected: non-gcs rows never call the GCS provider", async () => {
  const lifecycleRepository = createInMemoryUploadLifecycleRepository();
  await lifecycleRepository.createReservedUploadLifecycle({
    organizationId: ids.organizationId,
    intakeBatchId: ids.intakeBatchId,
    intakeFileId: ids.intakeFileId,
    now,
  });
  await lifecycleRepository.transitionUploadLifecycle({
    organizationId: ids.organizationId,
    intakeFileId: ids.intakeFileId,
    expectedUploadState: "reserved",
    newUploadState: "upload_started",
    now,
  });
  const objectVersionId = "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await lifecycleRepository.transitionUploadLifecycle({
    organizationId: ids.organizationId,
    intakeFileId: ids.intakeFileId,
    expectedUploadState: "upload_started",
    newUploadState: "uploaded_unconfirmed",
    now,
    objectVersionId,
  });

  const gcsProvider = fakeGcsProvider();
  const storageAdapter = {
    async openObjectVersionReadStream() {
      const byteSource = Readable.from([Buffer.from(exactBytes)]);
      byteSource.close = async () => {};
      return {
        ok: true,
        data: { object_version_id: objectVersionId, size_bytes: exactBytes.byteLength, byte_source: byteSource },
      };
    },
  };
  const result = await confirmUpload(confirmInput(), {
    env: enabledUploadEnv,
    gcsProvider,
    storageAdapter,
    uploadLifecycleRepository: lifecycleRepository,
    async getIntakeFileMetadata(organizationId, intakeFileId) {
      return gcsRow({ storage_provider: "local_dev" });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.upload_state, "confirmed");
  assert.equal(gcsProvider.calls.headObject.length, 0);
  assert.equal(gcsProvider.calls.statExactGeneration.length, 0);
  assert.equal(gcsProvider.calls.openExactGenerationReadStream.length, 0);
});

test("Gate C-2A verifyExactGcsObjectVersionStreamed rejects mismatched inputs before calling the provider", async () => {
  const gcsProvider = fakeGcsProvider();
  const result = await verifyExactGcsObjectVersionStreamed({
    gcsProvider,
    objectKey,
    gcsGeneration: "1700000000000001",
    declaredChecksum: "not-a-valid-checksum",
    expectedSizeBytes: exactBytes.byteLength,
    hashAlgorithm: "sha256",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "invalid_request");
  assert.equal(gcsProvider.calls.statExactGeneration.length, 0);
});

test("Gate C-2A confirmGcsObjectVersion fails closed when required dependencies are missing", async () => {
  const lifecycleRepository = await seededReservedRepository();
  const lifecycle = await lifecycleRepository.getUploadLifecycle({ organizationId: ids.organizationId, intakeFileId: ids.intakeFileId });
  const result = await confirmGcsObjectVersion({
    gcsProvider: null,
    lifecycleRepository,
    organizationId: ids.organizationId,
    intakeFileId: ids.intakeFileId,
    objectKey,
    declaredChecksum,
    expectedSizeBytes: exactBytes.byteLength,
    hashAlgorithm: "sha256",
    now,
    lifecycleRecord: lifecycle.data.record,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "storage_provider_not_configured");
});
