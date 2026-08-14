import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  __testables as productionAssessmentTestables,
  runProductionSecurityAssessment,
} from "../Backend/kai/security/productionSecurityAssessmentComposition.js";
import { readVerifiedAssessmentBytes } from "../Backend/kai/security/assessmentReadIntegrityBridge.js";

const { adaptAssessmentByteSource, createBoundGcsAssessmentStorageAdapter } = productionAssessmentTestables;

const OBJECT_VERSION_ID = "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const GCS_GENERATION = "1700000000000001";

// A raw Node Readable-style double: async iterable + destroy(), no close(),
// no teardown event - mirroring the real GCS SDK stream's destroy()-only
// cleanup contract as seen by this adapter.
function createRawStreamDouble(chunks, { alreadyDestroyed = false } = {}) {
  let destroyed = alreadyDestroyed;
  let destroyCalls = 0;
  return {
    get destroyed() {
      return destroyed;
    },
    get destroyCalls() {
      return destroyCalls;
    },
    destroy() {
      destroyCalls += 1;
      destroyed = true;
    },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function benignBytes(length = 57) {
  return Buffer.from(Array.from({ length }, (_, index) => 97 + (index % 26)));
}

test("adaptAssessmentByteSource: wraps a raw destroy()-only source into an asyncIterator + close() contract", () => {
  const raw = createRawStreamDouble([Buffer.from("x")]);
  const adapted = adaptAssessmentByteSource(raw);

  assert.notEqual(adapted, null);
  assert.equal(typeof adapted[Symbol.asyncIterator], "function");
  assert.equal(typeof adapted.close, "function");
});

test("adaptAssessmentByteSource: iteration fidelity - yields the exact same bytes in the same order", async () => {
  const chunks = [Buffer.from("exact "), Buffer.from("version"), Buffer.from(" bytes")];
  const raw = createRawStreamDouble(chunks);
  const adapted = adaptAssessmentByteSource(raw);

  const collected = [];
  for await (const chunk of adapted) {
    collected.push(chunk);
  }

  assert.deepEqual(Buffer.concat(collected), Buffer.concat(chunks));
});

test("adaptAssessmentByteSource: first close() synchronously initiates destroy() and returns a Promise", () => {
  const raw = createRawStreamDouble([Buffer.from("x")]);
  const adapted = adaptAssessmentByteSource(raw);

  const closePromise = adapted.close();

  assert.equal(raw.destroyCalls, 1, "destroy() must be initiated synchronously by the first close() call");
  assert.equal(closePromise instanceof Promise, true);
});

test("adaptAssessmentByteSource: repeated close() calls return the same memoized Promise and destroy() occurs at most once", async () => {
  const raw = createRawStreamDouble([Buffer.from("x")]);
  const adapted = adaptAssessmentByteSource(raw);

  const [first, second, third] = await Promise.all([adapted.close(), adapted.close(), adapted.close()]);

  assert.equal(raw.destroyCalls, 1);
  assert.equal(first, second);
  assert.equal(second, third);

  await assert.doesNotReject(adapted.close());
  assert.equal(raw.destroyCalls, 1);
});

test("adaptAssessmentByteSource: already-destroyed source resolves close() without calling destroy() again and without any close event", async () => {
  const raw = createRawStreamDouble([Buffer.from("x")], { alreadyDestroyed: true });
  const adapted = adaptAssessmentByteSource(raw);

  await assert.doesNotReject(adapted.close());
  assert.equal(raw.destroyCalls, 0, "destroy() must not be called again when source.destroyed is already true");
});

test("adaptAssessmentByteSource: an already-conforming source is returned unchanged and its close() is used, not destroy()", async () => {
  let closeCalls = 0;
  let destroyCalls = 0;
  const conforming = {
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        async next() {
          if (done) return { done: true, value: undefined };
          done = true;
          return { done: false, value: Buffer.from("y") };
        },
      };
    },
    async close() {
      closeCalls += 1;
    },
    destroy() {
      destroyCalls += 1;
    },
  };

  const adapted = adaptAssessmentByteSource(conforming);
  assert.equal(adapted, conforming);

  await adapted.close();
  assert.equal(closeCalls, 1);
  assert.equal(destroyCalls, 0);
});

test("adaptAssessmentByteSource: fails closed for a source lacking async iteration or any supported cleanup", () => {
  assert.equal(adaptAssessmentByteSource(null), null);
  assert.equal(adaptAssessmentByteSource({}), null);
  assert.equal(adaptAssessmentByteSource({ [Symbol.asyncIterator]() {} }), null, "no close() and no destroy()");
});

function gcsAssessmentFacts(bytes) {
  return {
    organizationId: "a5d17c5a-c55f-43af-9b21-fe63aafe733f",
    intakeFileId: "9fe568b1-5c05-4c42-bb1f-6e20de216c7b",
    objectVersionId: OBJECT_VERSION_ID,
    verifiedChecksum: createHash("sha256").update(bytes).digest("hex"),
    verifiedSizeBytes: bytes.byteLength,
    declaredMime: "text/plain",
    extension: ".txt",
    storageProvider: "gcs",
    storageObjectKey: "kai/intake/gate-c-assessment-object-key",
  };
}

function fakeUploadLifecycleRepository(facts) {
  return {
    async resolveGcsGenerationBinding({ organizationId, intakeFileId }) {
      assert.equal(organizationId, facts.organizationId);
      assert.equal(intakeFileId, facts.intakeFileId);
      return {
        ok: true,
        data: {
          object_version_id: facts.objectVersionId,
          gcs_generation: GCS_GENERATION,
        },
      };
    },
  };
}

function fakeExactGenerationGcsProvider(bytes, { streamFactory } = {}) {
  const calls = [];
  return {
    enabled: true,
    calls,
    async openExactGenerationReadStream(request) {
      calls.push(request);
      return {
        ok: true,
        data: {
          size_bytes: bytes.byteLength,
          byte_source: (streamFactory || (() => createRawStreamDouble([bytes])))(),
        },
      };
    },
  };
}

test("createBoundGcsAssessmentStorageAdapter: adapts the raw GCS stream so the bridge accepts it (no longer exact_version_unavailable)", async () => {
  const bytes = benignBytes();
  const facts = gcsAssessmentFacts(bytes);
  const gcsProvider = fakeExactGenerationGcsProvider(bytes);
  const uploadLifecycleRepository = fakeUploadLifecycleRepository(facts);

  const adapter = createBoundGcsAssessmentStorageAdapter({ facts, gcsProvider, uploadLifecycleRepository });
  assert.notEqual(adapter, null);

  const result = await readVerifiedAssessmentBytes({
    objectVersionId: facts.objectVersionId,
    expectedChecksum: facts.verifiedChecksum,
    expectedSize: facts.verifiedSizeBytes,
    storageAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.bytes.byteLength, 57);
  assert.deepEqual(result.data.bytes, bytes);
});

test("full read-integrity proof: production composition path consumes 57 benign bytes and reaches a passed policy decision", async () => {
  const bytes = benignBytes(57);
  const expectedChecksum = createHash("sha256").update(bytes).digest("hex");
  const facts = gcsAssessmentFacts(bytes);
  const gcsProvider = fakeExactGenerationGcsProvider(bytes);
  const uploadLifecycleRepository = fakeUploadLifecycleRepository(facts);

  let executorCalled = false;
  let executorInput = null;
  const internalSecurityAssessmentExecutor = {
    seamKind: "kai_sprint2_internal_security_assessment_executor",
    identity: {
      actorType: "internal_service",
      serviceIdentity: "kai_file_security_executor",
      operationGroup: "file_security_assessment",
    },
    async execute(input) {
      executorCalled = true;
      executorInput = input;
      return { policy: "pass" };
    },
  };

  const result = await runProductionSecurityAssessment(facts, {
    gcsProvider,
    uploadLifecycleRepository,
    internalSecurityAssessmentExecutor,
  });

  assert.equal(result.ok, true);
  assert.equal(executorCalled, true, "internal security assessment executor must be reached");
  assert.equal(executorInput.bytes.byteLength, 57);
  assert.equal(createHash("sha256").update(executorInput.bytes).digest("hex"), expectedChecksum);
  assert.deepEqual(result.data.assessmentResult, { policy: "pass" });
  assert.equal(result.data.policyDecisionOutcome, "passed");
  assert.notEqual(result.error?.code, "assessment_read_integrity_failure");
});

test("full read-integrity proof: unchanged bytes still fail closed on size mismatch, checksum mismatch, and an unusable byte source", async () => {
  const bytes = benignBytes(57);

  const sizeMismatchFacts = { ...gcsAssessmentFacts(bytes), verifiedSizeBytes: bytes.byteLength + 1 };
  const sizeMismatchResult = await runProductionSecurityAssessment(sizeMismatchFacts, {
    gcsProvider: fakeExactGenerationGcsProvider(bytes),
    uploadLifecycleRepository: fakeUploadLifecycleRepository(sizeMismatchFacts),
  });
  assert.equal(sizeMismatchResult.ok, false);
  assert.equal(sizeMismatchResult.error.integrity_failure.kind, "size_mismatch");

  const checksumMismatchFacts = { ...gcsAssessmentFacts(bytes), verifiedChecksum: "b".repeat(64) };
  const checksumMismatchResult = await runProductionSecurityAssessment(checksumMismatchFacts, {
    gcsProvider: fakeExactGenerationGcsProvider(bytes),
    uploadLifecycleRepository: fakeUploadLifecycleRepository(checksumMismatchFacts),
  });
  assert.equal(checksumMismatchResult.ok, false);
  assert.equal(checksumMismatchResult.error.integrity_failure.kind, "checksum_mismatch");

  const unusableFacts = gcsAssessmentFacts(bytes);
  const unusableResult = await runProductionSecurityAssessment(unusableFacts, {
    gcsProvider: fakeExactGenerationGcsProvider(bytes, {
      streamFactory: () => ({ [Symbol.asyncIterator]() {} }),
    }),
    uploadLifecycleRepository: fakeUploadLifecycleRepository(unusableFacts),
  });
  assert.equal(unusableResult.ok, false);
  assert.equal(unusableResult.error.integrity_failure.kind, "exact_version_unavailable");
});
