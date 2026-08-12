import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS,
  ASSESSMENT_READ_INTEGRITY_FAILURE_TYPE,
} from "../Backend/kai/security/assessmentReadIntegrityBridge.js";
import { createInternalSecurityAssessmentExecutor } from "../Backend/kai/security/internalSecurityAssessmentExecutor.js";
import { executeSyntheticAssessmentFromEnqueueRecord } from "../Backend/kai/security/syntheticAssessmentComposition.js";
import { createSyntheticSecurityAssessmentEnqueue } from "../Backend/kai/security/syntheticSecurityAssessmentEnqueue.js";

const OBJECT_VERSION_ID = "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_OBJECT_VERSION_ID = "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function byteSource(chunks) {
  let index = 0;
  return {
    closed: false,
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (index >= chunks.length) {
        await this.close();
        return { done: true, value: undefined };
      }
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    },
    async close() {
      this.closed = true;
    },
  };
}

function storageAdapterFor(bytesByObjectVersion, calls = []) {
  return {
    async openObjectVersionReadStream(input) {
      calls.push(input);
      const bytes = bytesByObjectVersion.get(input.objectVersionId);
      if (!bytes) return { ok: false };
      return {
        ok: true,
        data: {
          object_version_id: input.objectVersionId,
          size_bytes: bytes.byteLength,
          byte_source: byteSource([bytes]),
        },
      };
    },
  };
}

function factsFor({
  organizationId = "org-a",
  intakeFileId = "file-a",
  objectVersionId = OBJECT_VERSION_ID,
  bytes = Buffer.from("plain safe text\n", "utf8"),
  declaredMime = "text/plain",
  extension = ".txt",
} = {}) {
  return {
    organizationId,
    intakeFileId,
    objectVersionId,
    verifiedChecksum: sha256Hex(bytes),
    verifiedSizeBytes: bytes.byteLength,
    declaredMime,
    extension,
  };
}

function selectionFromFacts(facts, overrides = {}) {
  return {
    organizationId: facts.organizationId,
    intakeFileId: facts.intakeFileId,
    objectVersionId: facts.objectVersionId,
    verifiedChecksum: facts.verifiedChecksum,
    ...overrides,
  };
}

function assertLifecycleFailure(result, code, status) {
  assert.deepEqual(result, {
    ok: false,
    data: null,
    error: { code, status },
  });
}

function assertIntegrityFailure(result, kind) {
  assert.deepEqual(result, {
    ok: false,
    integrity_failure: {
      type: ASSESSMENT_READ_INTEGRITY_FAILURE_TYPE,
      kind,
    },
  });
}

test("explicit stored identity tuple selects the intended record independent of snapshot order", async () => {
  const firstBytes = Buffer.from("first record\n", "utf8");
  const secondBytes = Buffer.from("second record\n", "utf8");
  const first = factsFor({ intakeFileId: "file-first", bytes: firstBytes });
  const second = factsFor({
    intakeFileId: "file-second",
    objectVersionId: OTHER_OBJECT_VERSION_ID,
    bytes: secondBytes,
  });
  const base = createSyntheticSecurityAssessmentEnqueue();
  assert.equal(base.enqueueSecurityAssessment(first).ok, true);
  assert.equal(base.enqueueSecurityAssessment(second).ok, true);
  const reversedSnapshot = [...base.listSecurityAssessmentEnqueueRecords()].reverse();
  const calls = [];
  const result = await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(second), {
    securityAssessmentEnqueue: {
      listSecurityAssessmentEnqueueRecords() {
        return reversedSnapshot;
      },
    },
    storageAdapter: storageAdapterFor(new Map([[OTHER_OBJECT_VERSION_ID, secondBytes]]), calls),
    internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
      async assessor(input) {
        assert.deepEqual(input, {
          extension: ".txt",
          declaredMime: "text/plain",
          bytes: secondBytes,
          sha256: second.verifiedChecksum,
        });
        return { policy: "pass" };
      },
    }),
  });

  assert.deepEqual(result, { policy: "pass" });
  assert.deepEqual(calls, [{ objectVersionId: OTHER_OBJECT_VERSION_ID }]);
});

test("malformed, empty, missing, and ambiguous selection use existing internal failure envelopes", async () => {
  assertLifecycleFailure(
    await executeSyntheticAssessmentFromEnqueueRecord({ organizationId: "org-a" }),
    "validation_blocker",
    422,
  );

  assertLifecycleFailure(
    await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(factsFor()), {
      securityAssessmentEnqueue: createSyntheticSecurityAssessmentEnqueue(),
    }),
    "not_found",
    404,
  );

  const facts = factsFor();
  const record = {
    security_assessment_enqueue_id: "synthetic-security-assessment-000001",
    organization_id: facts.organizationId,
    intake_file_id: facts.intakeFileId,
    object_version_id: facts.objectVersionId,
    verified_checksum: facts.verifiedChecksum,
    verified_size_bytes: facts.verifiedSizeBytes,
    declared_mime: facts.declaredMime,
    extension: facts.extension,
  };

  assertLifecycleFailure(
    await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(facts), {
      securityAssessmentEnqueue: {
        listSecurityAssessmentEnqueueRecords() {
          return [];
        },
      },
    }),
    "not_found",
    404,
  );

  assertLifecycleFailure(
    await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(facts), {
      securityAssessmentEnqueue: {
        listSecurityAssessmentEnqueueRecords() {
          return [{ ...record }, { ...record, security_assessment_enqueue_id: "duplicate" }];
        },
      },
    }),
    "conflict_current_state_changed",
    409,
  );
});

test("caller lookup coordinates cannot override downstream facts from the selected stored record", async () => {
  const selectedBytes = Buffer.from("selected bytes\n", "utf8");
  const selected = factsFor({
    organizationId: "org-selected",
    intakeFileId: "file-selected",
    bytes: selectedBytes,
    declaredMime: "text/plain",
    extension: ".txt",
  });
  const enqueue = createSyntheticSecurityAssessmentEnqueue();
  assert.equal(enqueue.enqueueSecurityAssessment(selected).ok, true);

  const executorCalls = [];
  const storageCalls = [];
  assertLifecycleFailure(
    await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(selected, {
      declaredMime: "application/pdf",
    }), {
      securityAssessmentEnqueue: enqueue,
    }),
    "validation_blocker",
    422,
  );

  const result = await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(selected), {
    securityAssessmentEnqueue: enqueue,
    storageAdapter: storageAdapterFor(new Map([[OBJECT_VERSION_ID, selectedBytes]]), storageCalls),
    internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
      async assessor(input) {
        executorCalls.push(input);
        return { policy: "block", category: "malware_failed" };
      },
    }),
  });

  assert.deepEqual(result, { policy: "block", category: "malware_failed" });
  assert.deepEqual(storageCalls, [{ objectVersionId: OBJECT_VERSION_ID }]);
  assert.deepEqual(executorCalls, [{
    extension: ".txt",
    declaredMime: "text/plain",
    bytes: selectedBytes,
    sha256: selected.verifiedChecksum,
  }]);
});

test("typed bridge integrity failures return before executor or assessor invocation", async () => {
  const bytes = Buffer.from("changed bytes\n", "utf8");
  const selected = factsFor({ bytes: Buffer.from("original byte\n", "utf8") });
  const enqueue = createSyntheticSecurityAssessmentEnqueue();
  assert.equal(enqueue.enqueueSecurityAssessment(selected).ok, true);
  let assessorCount = 0;
  let executorCount = 0;

  const result = await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(selected), {
    securityAssessmentEnqueue: enqueue,
    storageAdapter: storageAdapterFor(new Map([[OBJECT_VERSION_ID, bytes]])),
    internalSecurityAssessmentExecutor: {
      seamKind: "kai_sprint2_internal_security_assessment_executor",
      identity: {
        actorType: "internal_service",
        serviceIdentity: "kai_file_security_executor",
        operationGroup: "file_security_assessment",
      },
      async execute() {
        executorCount += 1;
        assessorCount += 1;
        return { policy: "pass" };
      },
    },
  });

  assertIntegrityFailure(result, ASSESSMENT_READ_INTEGRITY_FAILURE_KINDS.checksum_mismatch);
  assert.equal(executorCount, 0);
  assert.equal(assessorCount, 0);
  assert.deepEqual(enqueue.listSecurityAssessmentEnqueueRecords()[0], {
    security_assessment_enqueue_id: "synthetic-security-assessment-000001",
    organization_id: selected.organizationId,
    intake_file_id: selected.intakeFileId,
    object_version_id: selected.objectVersionId,
    verified_checksum: selected.verifiedChecksum,
    verified_size_bytes: selected.verifiedSizeBytes,
    declared_mime: selected.declaredMime,
    extension: selected.extension,
  });
});

test("successful execution returns pass, block, and failed results unchanged and sanitized", async () => {
  const results = [
    { policy: "pass" },
    { policy: "block", category: "csv_row_limit_exceeded" },
    { status: "failed", category: "security_assessment_timeout" },
    { status: "failed", category: "malware_scan_not_configured" },
    { status: "failed", category: "malware_scan_failed" },
  ];

  for (const expectedResult of results) {
    const bytes = Buffer.from(`${JSON.stringify(expectedResult)}\n`, "utf8");
    const selected = factsFor({ bytes });
    const enqueue = createSyntheticSecurityAssessmentEnqueue();
    assert.equal(enqueue.enqueueSecurityAssessment(selected).ok, true);
    const result = await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(selected), {
      securityAssessmentEnqueue: enqueue,
      storageAdapter: storageAdapterFor(new Map([[OBJECT_VERSION_ID, bytes]])),
      internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
        async assessor() {
          return expectedResult;
        },
      }),
    });

    assert.deepEqual(result, expectedResult);
    assert.doesNotMatch(JSON.stringify(result), /bytes|object_version|storage|security_assessment_enqueue|organization|intake/i);
  }
});

test("GCS-backed security assessment reads only the privately bound exact generation", async () => {
  const selectedBytes = Buffer.from("gcs exact generation bytes\n", "utf8");
  const selected = factsFor({
    organizationId: "org-gcs",
    intakeFileId: "file-gcs",
    bytes: selectedBytes,
    declaredMime: "application/pdf",
    extension: ".pdf",
  });
  const enqueue = createSyntheticSecurityAssessmentEnqueue();
  assert.equal(enqueue.enqueueSecurityAssessment(selected).ok, true);
  const calls = [];

  const result = await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(selected), {
    securityAssessmentEnqueue: enqueue,
    uploadLifecycleRepository: {
      async resolveGcsGenerationBinding(input) {
        calls.push(["resolve", input]);
        return {
          ok: true,
          data: {
            object_version_id: selected.objectVersionId,
            gcs_generation: "1700000000000001",
          },
        };
      },
    },
    async getIntakeFileMetadata(organizationId, intakeFileId) {
      calls.push(["metadata", { organizationId, intakeFileId }]);
      return {
        organization_id: selected.organizationId,
        intake_file_id: selected.intakeFileId,
        storage_provider: "gcs",
        storage_object_key: "private/gcs/object.pdf",
      };
    },
    gcsProvider: {
      enabled: true,
      async openExactGenerationReadStream(input) {
        calls.push(["open", input]);
        return {
          ok: true,
          data: {
            size_bytes: selectedBytes.byteLength,
            byte_source: byteSource([selectedBytes]),
          },
        };
      },
    },
    internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
      async assessor(input) {
        assert.deepEqual(input.bytes, selectedBytes);
        assert.equal(input.sha256, selected.verifiedChecksum);
        return { policy: "pass" };
      },
    }),
  });

  assert.deepEqual(result, { policy: "pass" });
  assert.deepEqual(calls, [
    ["resolve", { organizationId: selected.organizationId, intakeFileId: selected.intakeFileId }],
    ["metadata", { organizationId: selected.organizationId, intakeFileId: selected.intakeFileId }],
    ["open", {
      objectKey: "private/gcs/object.pdf",
      gcsGeneration: "1700000000000001",
    }],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /1700000000000001|private\/gcs|object\.pdf|gcs_generation|storage_object_key/i);
});

test("GCS-backed security assessment prefers the parser/read provider over the signer provider", async () => {
  const selectedBytes = Buffer.from("gcs parser reader bytes\n", "utf8");
  const selected = factsFor({
    organizationId: "org-gcs-reader",
    intakeFileId: "file-gcs-reader",
    bytes: selectedBytes,
    declaredMime: "application/pdf",
    extension: ".pdf",
  });
  const enqueue = createSyntheticSecurityAssessmentEnqueue();
  assert.equal(enqueue.enqueueSecurityAssessment(selected).ok, true);
  const calls = [];

  const result = await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(selected), {
    securityAssessmentEnqueue: enqueue,
    uploadLifecycleRepository: {
      async resolveGcsGenerationBinding(input) {
        calls.push(["resolve", input]);
        return {
          ok: true,
          data: {
            object_version_id: selected.objectVersionId,
            gcs_generation: "1700000000000001",
          },
        };
      },
    },
    async getIntakeFileMetadata(organizationId, intakeFileId) {
      calls.push(["metadata", { organizationId, intakeFileId }]);
      return {
        organization_id: selected.organizationId,
        intake_file_id: selected.intakeFileId,
        storage_provider: "gcs",
        storage_object_key: "private/gcs/parser-reader.pdf",
      };
    },
    gcsProvider: {
      enabled: true,
      async openExactGenerationReadStream() {
        throw new Error("signer provider must not perform exact-generation reads");
      },
    },
    gcsParserReaderProvider: {
      enabled: true,
      async openExactGenerationReadStream(input) {
        calls.push(["reader-open", input]);
        return {
          ok: true,
          data: {
            size_bytes: selectedBytes.byteLength,
            byte_source: byteSource([selectedBytes]),
          },
        };
      },
    },
    internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
      async assessor(input) {
        assert.deepEqual(input.bytes, selectedBytes);
        return { policy: "pass" };
      },
    }),
  });

  assert.deepEqual(result, { policy: "pass" });
  assert.deepEqual(calls.at(-1), ["reader-open", {
    objectKey: "private/gcs/parser-reader.pdf",
    gcsGeneration: "1700000000000001",
  }]);
});

test("repeated explicit execution does not consume, complete, or mutate the enqueue snapshot", async () => {
  const bytes = Buffer.from("repeatable safe text\n", "utf8");
  const selected = factsFor({ bytes });
  const enqueue = createSyntheticSecurityAssessmentEnqueue();
  assert.equal(enqueue.enqueueSecurityAssessment(selected).ok, true);
  const before = enqueue.listSecurityAssessmentEnqueueRecords();
  let assessorCount = 0;

  for (let i = 0; i < 2; i += 1) {
    const result = await executeSyntheticAssessmentFromEnqueueRecord(selectionFromFacts(selected), {
      securityAssessmentEnqueue: enqueue,
      storageAdapter: storageAdapterFor(new Map([[OBJECT_VERSION_ID, bytes]])),
      internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
        async assessor() {
          assessorCount += 1;
          return { policy: "pass" };
        },
      }),
    });
    assert.deepEqual(result, { policy: "pass" });
  }

  assert.equal(assessorCount, 2);
  assert.deepEqual(enqueue.listSecurityAssessmentEnqueueRecords(), before);
});

test("synthetic assessment composition remains isolated from production reachability and mutation concerns", () => {
  const compositionSource = readFileSync("Backend/kai/security/syntheticAssessmentComposition.js", "utf8");
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const barrelSource = readFileSync("Backend/kai/index.js", "utf8");
  const confirmSource = readFileSync("Backend/kai/security/syntheticConfirmUploadAndEnqueue.js", "utf8");
  const intakeSource = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");

  assert.doesNotMatch(compositionSource, /router|express|pg|sql|audit|file_policy_status|transitionUploadLifecycle|claim|lease|ack|retry|complete|delete|dequeue|drain/i);
  assert.doesNotMatch(routeSource, /syntheticAssessmentComposition|executeSyntheticAssessmentFromEnqueueRecord/);
  assert.doesNotMatch(barrelSource, /syntheticAssessmentComposition|executeSyntheticAssessmentFromEnqueueRecord/);
  assert.doesNotMatch(confirmSource, /syntheticAssessmentComposition|executeSyntheticAssessmentFromEnqueueRecord/);
  assert.doesNotMatch(intakeSource, /syntheticAssessmentComposition|executeSyntheticAssessmentFromEnqueueRecord/);
});
