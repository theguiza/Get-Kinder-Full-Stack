import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";

import {
  confirmUpload,
  createKaiIntakeRuntimeDependencies,
  requestUploadUrl,
  setKaiIntakeRuntimeDependenciesForTest,
} from "../Backend/kai/services/kaiIntakeRuntimeService.js";
import { createInMemoryUploadLifecycleRepository } from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";

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
const env = { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true" };
const now = "2026-08-09T10:00:00.000Z";
const bytes = Buffer.from("gate c2 runtime bytes");
const checksum = createHash("sha256").update(bytes).digest("hex");
const objectKey = "kai/private/gate-c2-runtime.pdf";

function input() {
  return { actorContext, ...ids, now };
}

function metadata() {
  return {
    organization_id: ids.organizationId,
    intake_file_id: ids.intakeFileId,
    intake_batch_id: ids.intakeBatchId,
    storage_provider: "gcs",
    storage_object_key: objectKey,
    mime_type: "application/pdf",
    checksum,
    hash_algorithm: "sha256",
    file_size_bytes: bytes.byteLength,
  };
}

function gcsProvider() {
  const calls = {
    createSignedUploadUrl: [],
    headObject: [],
    statExactGeneration: [],
    openExactGenerationReadStream: [],
  };
  return {
    enabled: true,
    calls,
    async createSignedUploadUrl(request) {
      calls.createSignedUploadUrl.push(request);
      return {
        ok: true,
        data: {
          url: "https://storage.googleapis.com/private-bucket/private-object?X-Goog-Signature=redacted",
          method: "PUT",
          headers: { "Content-Type": request.contentType, "x-goog-if-generation-match": "0" },
          expires_in_seconds: 900,
        },
      };
    },
    async headObject(request) {
      calls.headObject.push(request);
      return { ok: true, data: { candidate_generation: "1700000000000001", size_bytes: bytes.byteLength } };
    },
    async statExactGeneration(request) {
      calls.statExactGeneration.push(request);
      return { ok: true, data: { size_bytes: bytes.byteLength } };
    },
    async openExactGenerationReadStream(request) {
      calls.openExactGenerationReadStream.push(request);
      return { ok: true, data: { size_bytes: bytes.byteLength, byte_source: Readable.from([bytes]) } };
    },
  };
}

async function seededRuntime() {
  const uploadLifecycleRepository = createInMemoryUploadLifecycleRepository();
  const created = await uploadLifecycleRepository.createReservedUploadLifecycle({
    organizationId: ids.organizationId,
    intakeBatchId: ids.intakeBatchId,
    intakeFileId: ids.intakeFileId,
    now,
  });
  assert.equal(created.ok, true);
  const provider = gcsProvider();
  const restore = setKaiIntakeRuntimeDependenciesForTest({
    env,
    gcsProvider: provider,
    uploadLifecycleRepository,
    async getIntakeFileMetadata() {
      return metadata();
    },
  });
  return { uploadLifecycleRepository, provider, restore };
}

test("Gate C-2 runtime dependency factory is dormant and fail-closed when unconfigured", () => {
  const deps = createKaiIntakeRuntimeDependencies({
    KAI_SPRINT2_ENABLED: "true",
    KAI_FILE_UPLOAD_ENABLED: "true",
  });

  assert.equal(deps.gcsProvider.enabled, false);
  assert.equal(typeof deps.uploadLifecycleRepository.getUploadLifecycle, "function");
});

test("Gate C-2 mounted runtime facade supplies GCS provider and lifecycle repository to signed upload and confirmUpload", async () => {
  const { uploadLifecycleRepository, provider, restore } = await seededRuntime();
  try {
    const signed = await requestUploadUrl(input());
    assert.equal(signed.ok, true);
    assert.equal(provider.calls.createSignedUploadUrl.length, 1);
    assert.deepEqual(provider.calls.createSignedUploadUrl[0], {
      objectKey,
      contentType: "application/pdf",
    });

    const confirmed = await confirmUpload(input());
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.data.upload_state, "confirmed");
    assert.match(confirmed.data.object_version_id, /^ov_[a-f0-9]{32}$/);
    assert.equal(provider.calls.headObject.length, 1);
    assert.equal(provider.calls.statExactGeneration[0].gcsGeneration, "1700000000000001");
    assert.equal(provider.calls.openExactGenerationReadStream[0].gcsGeneration, "1700000000000001");

    const binding = await uploadLifecycleRepository.resolveGcsGenerationBinding({
      organizationId: ids.organizationId,
      intakeFileId: ids.intakeFileId,
    });
    assert.equal(binding.ok, true);
    assert.equal(binding.data.object_version_id, confirmed.data.object_version_id);
    assert.equal(binding.data.gcs_generation, "1700000000000001");

    const serialized = JSON.stringify(confirmed);
    assert.doesNotMatch(serialized, /1700000000000001|gate-c2-runtime|private-bucket|storage_object_key/i);
  } finally {
    restore();
  }
});

test("Gate C-2 mounted routes lazy-import runtime composition without constructing providers in route handlers", () => {
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const runtimeSource = readFileSync("Backend/kai/services/kaiIntakeRuntimeService.js", "utf8");
  const indexSource = readFileSync("index.js", "utf8");

  assert.match(routeSource, /import\("\.\.\/services\/kaiIntakeRuntimeService\.js"\)/);
  assert.doesNotMatch(routeSource, /createConfiguredGoogleCloudStorageProvider|createPostgresUploadLifecycleRepository|kaiDb|pool\.query|storage_object_key|gcs_generation/);
  assert.match(runtimeSource, /createConfiguredGoogleCloudStorageProvider/);
  assert.match(runtimeSource, /createPostgresUploadLifecycleRepository/);
  assert.match(indexSource, /"\/api\/kai\/sprint2\/intake"[\s\S]*sprint2IntakeApiRouter/);
});
