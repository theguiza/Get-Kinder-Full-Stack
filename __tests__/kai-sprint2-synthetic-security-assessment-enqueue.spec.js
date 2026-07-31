import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { uploadLifecycleFailure } from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";
import {
  createSyntheticConfirmUploadAndEnqueue,
  __testables as syntheticConfirmTestables,
} from "../Backend/kai/security/syntheticConfirmUploadAndEnqueue.js";
import {
  createSyntheticSecurityAssessmentEnqueue,
  SYNTHETIC_SECURITY_ASSESSMENT_ENQUEUE_TRANSACTION_PARTICIPANT,
  __testables,
} from "../Backend/kai/security/syntheticSecurityAssessmentEnqueue.js";
import {
  createInMemoryUploadLifecycleRepository,
  uploadLifecycleSuccess,
} from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";

const BASE_FACTS = Object.freeze({
  organizationId: "org-1",
  intakeFileId: "file-1",
  objectVersionId: "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  verifiedChecksum: "a".repeat(64),
  verifiedSizeBytes: 11,
  declaredMime: "text/plain",
  extension: ".txt",
});

const CHANGED_STATE_CONFLICT = uploadLifecycleFailure("conflict_current_state_changed");
const VALIDATION_BLOCKER = uploadLifecycleFailure("validation_blocker");
const NOW = "2026-07-30T10:00:00.000Z";
const CONFIRM_INPUT = Object.freeze({
  organizationId: BASE_FACTS.organizationId,
  intakeFileId: BASE_FACTS.intakeFileId,
});

function uploadTransitionInput(expectedUploadState, newUploadState, overrides = {}) {
  return {
    organizationId: BASE_FACTS.organizationId,
    intakeFileId: BASE_FACTS.intakeFileId,
    expectedUploadState,
    newUploadState,
    now: NOW,
    ...overrides,
  };
}

function createUploadedLifecycleRepository() {
  const uploadLifecycleRepository = createInMemoryUploadLifecycleRepository();
  assert.equal(uploadLifecycleRepository.createReservedUploadLifecycle({
    organizationId: BASE_FACTS.organizationId,
    intakeBatchId: "batch-1",
    intakeFileId: BASE_FACTS.intakeFileId,
    now: NOW,
  }).ok, true);
  assert.equal(
    uploadLifecycleRepository.transitionUploadLifecycle(
      uploadTransitionInput("reserved", "upload_started"),
    ).ok,
    true,
  );
  assert.equal(
    uploadLifecycleRepository.transitionUploadLifecycle(
      uploadTransitionInput("upload_started", "uploaded_unconfirmed", {
        objectVersionId: BASE_FACTS.objectVersionId,
      }),
    ).ok,
    true,
  );
  return uploadLifecycleRepository;
}

function readLifecycle(uploadLifecycleRepository) {
  const result = uploadLifecycleRepository.getUploadLifecycle({
    organizationId: BASE_FACTS.organizationId,
    intakeFileId: BASE_FACTS.intakeFileId,
  });
  assert.equal(result.ok, true);
  return result.data.record;
}

function metadataRow(overrides = {}) {
  return {
    organization_id: BASE_FACTS.organizationId,
    intake_file_id: BASE_FACTS.intakeFileId,
    intake_batch_id: "batch-1",
    mime_type: BASE_FACTS.declaredMime,
    file_extension: BASE_FACTS.extension,
    ...overrides,
  };
}

async function localConfirmUpload(input, dependencies) {
  await dependencies.getIntakeFileMetadata(input.organizationId, input.intakeFileId);
  const transition = dependencies.uploadLifecycleRepository.transitionUploadLifecycle(
    uploadTransitionInput("uploaded_unconfirmed", "confirmed", {
      objectVersionId: BASE_FACTS.objectVersionId,
      verifiedChecksum: BASE_FACTS.verifiedChecksum,
      verifiedSizeBytes: BASE_FACTS.verifiedSizeBytes,
    }),
  );
  if (!transition.ok) return transition;
  return uploadLifecycleSuccess({
    organization_id: input.organizationId,
    intake_file_id: input.intakeFileId,
    intake_batch_id: "batch-1",
    upload_state: "confirmed",
    object_version_id: BASE_FACTS.objectVersionId,
    verified_size_bytes: BASE_FACTS.verifiedSizeBytes,
    replayed: transition.data.replayed,
  });
}

function createPreparationFailingEnqueue() {
  const committedRecords = [];
  return Object.freeze(Object.defineProperty(
    {
      listSecurityAssessmentEnqueueRecords() {
        return committedRecords.map((record) => ({ ...record }));
      },
    },
    SYNTHETIC_SECURITY_ASSESSMENT_ENQUEUE_TRANSACTION_PARTICIPANT,
    {
      enumerable: false,
      value: Object.freeze({
        createTransactionParticipant() {
          const transactionRecords = committedRecords.map((record) => ({ ...record }));
          return Object.freeze({
            capability: {
              enqueueSecurityAssessment(input) {
                transactionRecords.push({ ...input });
                return uploadLifecycleSuccess({
                  record: {
                    security_assessment_enqueue_id: "synthetic-security-assessment-prepare-failure",
                  },
                  replayed: false,
                });
              },
            },
            prepareCommit() {
              throw new Error("synthetic enqueue preparation failure");
            },
          });
        },
      }),
    },
  ));
}

function enqueueWith(facts = {}) {
  const capability = createSyntheticSecurityAssessmentEnqueue();
  const result = capability.enqueueSecurityAssessment({ ...BASE_FACTS, ...facts });
  assert.equal(result.ok, true);
  return { capability, result };
}

test("first enqueue creates one synthetic record from the trusted fact allowlist", () => {
  const { capability, result } = enqueueWith();

  assert.equal(result.data.replayed, false);
  assert.equal(result.data.record.security_assessment_enqueue_id, "synthetic-security-assessment-000001");
  assert.deepEqual(result.data.record, {
    security_assessment_enqueue_id: "synthetic-security-assessment-000001",
    organization_id: "org-1",
    intake_file_id: "file-1",
    object_version_id: "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    verified_checksum: "a".repeat(64),
    verified_size_bytes: 11,
    declared_mime: "text/plain",
    extension: ".txt",
  });
  assert.deepEqual(capability.listSecurityAssessmentEnqueueRecords(), [result.data.record]);
});

test("identical replay returns the existing record and identifier without increasing count", () => {
  const { capability, result: first } = enqueueWith();
  const replay = capability.enqueueSecurityAssessment({ ...BASE_FACTS });

  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.record, first.data.record);
  assert.equal(
    replay.data.record.security_assessment_enqueue_id,
    first.data.record.security_assessment_enqueue_id,
  );
  assert.equal(capability.listSecurityAssessmentEnqueueRecords().length, 1);
});

test("changed object version for the same organization and file reuses the committed conflict outcome", () => {
  const { capability, result: first } = enqueueWith();
  const conflict = capability.enqueueSecurityAssessment({
    ...BASE_FACTS,
    objectVersionId: "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });

  assert.deepEqual(conflict, CHANGED_STATE_CONFLICT);
  assert.deepEqual(capability.listSecurityAssessmentEnqueueRecords(), [first.data.record]);
});

test("changed SHA-256 for the same organization and file reuses the committed conflict outcome", () => {
  const { capability, result: first } = enqueueWith();
  const conflict = capability.enqueueSecurityAssessment({
    ...BASE_FACTS,
    verifiedChecksum: "b".repeat(64),
  });

  assert.deepEqual(conflict, CHANGED_STATE_CONFLICT);
  assert.deepEqual(capability.listSecurityAssessmentEnqueueRecords(), [first.data.record]);
});

test("same object version with changed SHA-256 fails closed without overwrite", () => {
  const { capability, result: first } = enqueueWith();
  const conflict = capability.enqueueSecurityAssessment({
    ...BASE_FACTS,
    objectVersionId: BASE_FACTS.objectVersionId,
    verifiedChecksum: "c".repeat(64),
  });

  assert.deepEqual(conflict, CHANGED_STATE_CONFLICT);
  assert.deepEqual(capability.listSecurityAssessmentEnqueueRecords(), [first.data.record]);
});

test("cross-organization and different-file facts do not collide", () => {
  const { capability, result: first } = enqueueWith();
  const crossOrg = capability.enqueueSecurityAssessment({
    ...BASE_FACTS,
    organizationId: "org-2",
    objectVersionId: "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    verifiedChecksum: "b".repeat(64),
  });
  const otherFile = capability.enqueueSecurityAssessment({
    ...BASE_FACTS,
    intakeFileId: "file-2",
    objectVersionId: "ov_cccccccccccccccccccccccccccccccc",
    verifiedChecksum: "c".repeat(64),
  });

  assert.equal(crossOrg.ok, true);
  assert.equal(otherFile.ok, true);
  assert.equal(crossOrg.data.record.security_assessment_enqueue_id, "synthetic-security-assessment-000002");
  assert.equal(otherFile.data.record.security_assessment_enqueue_id, "synthetic-security-assessment-000003");
  assert.deepEqual(capability.listSecurityAssessmentEnqueueRecords(), [
    first.data.record,
    crossOrg.data.record,
    otherFile.data.record,
  ]);
});

test("malformed or incomplete trusted-fact input fails closed", () => {
  const capability = createSyntheticSecurityAssessmentEnqueue();
  const cases = [
    {},
    { ...BASE_FACTS, organizationId: "" },
    { ...BASE_FACTS, intakeFileId: "" },
    { ...BASE_FACTS, objectVersionId: "" },
    { ...BASE_FACTS, verifiedChecksum: "A".repeat(64) },
    { ...BASE_FACTS, verifiedChecksum: "z".repeat(64) },
    { ...BASE_FACTS, verifiedSizeBytes: 0 },
    { ...BASE_FACTS, verifiedSizeBytes: 1.5 },
    { ...BASE_FACTS, declaredMime: "Text/Plain" },
    { ...BASE_FACTS, extension: "txt" },
    { ...BASE_FACTS, extension: ".TXT" },
  ];

  for (const input of cases) {
    assert.deepEqual(capability.enqueueSecurityAssessment(input), VALIDATION_BLOCKER);
  }
  assert.equal(capability.listSecurityAssessmentEnqueueRecords().length, 0);
});

test("caller-supplied storage-private identifiers and raw payloads are rejected or excluded", () => {
  const privateInputs = [
    { storagePath: "/private/tmp/kai/object.bin" },
    { bucket: "private-bucket" },
    { objectKey: "tenant/org/file" },
    { storageUri: "gs://private-bucket/tenant/org/file" },
    { signedUrl: "https://storage.example.test/signed" },
    { providerPrivateId: "gcs-generation-1" },
    { credentials: "secret" },
    { byteSource: {} },
    { bytes: Buffer.from("raw bytes") },
    { payload: { route: "copy" } },
  ];
  for (const privateInput of privateInputs) {
    const capability = createSyntheticSecurityAssessmentEnqueue();
    const result = capability.enqueueSecurityAssessment({ ...BASE_FACTS, ...privateInput });
    assert.deepEqual(result, VALIDATION_BLOCKER);
    assert.equal(capability.listSecurityAssessmentEnqueueRecords().length, 0);
  }

  const { result } = enqueueWith();
  for (const excluded of [
    "storage_path",
    "bucket",
    "object_key",
    "storage_uri",
    "signed_url",
    "provider_private_id",
    "credentials",
    "byte_source",
    "bytes",
    "payload",
  ]) {
    assert.equal(Object.hasOwn(result.data.record, excluded), false);
  }
});

test("synthetic enqueue stays unwired from confirmation, routes, executor, assessor, persistence, and production barrel", () => {
  const enqueueSource = readFileSync("Backend/kai/security/syntheticSecurityAssessmentEnqueue.js", "utf8");
  const syntheticConfirmSource = readFileSync("Backend/kai/security/syntheticConfirmUploadAndEnqueue.js", "utf8");
  const intakeServiceSource = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const executorSource = readFileSync("Backend/kai/security/internalSecurityAssessmentExecutor.js", "utf8");
  const assessorSource = readFileSync("Backend/kai/security/boundedFileSecurityAssessor.js", "utf8");
  const barrelSource = readFileSync("Backend/kai/index.js", "utf8");

  assert.doesNotMatch(enqueueSource, /executeInjectedInternalSecurityAssessment|createInternalSecurityAssessmentExecutor|assessBoundedFileSecurity|drain|router|express|pg|sql|file_policy_status|transitionUploadLifecycle/i);
  assert.match(syntheticConfirmSource, /confirmUpload/);
  assert.match(syntheticConfirmSource, /enqueueSecurityAssessment/);
  assert.doesNotMatch(syntheticConfirmSource, /executeInjectedInternalSecurityAssessment|createInternalSecurityAssessmentExecutor|assessBoundedFileSecurity|drain|router|express|pg|sql|file_policy_status/i);
  assert.doesNotMatch(intakeServiceSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue/);
  assert.doesNotMatch(intakeServiceSource, /syntheticConfirmUploadAndEnqueue|createSyntheticConfirmUploadAndEnqueue/);
  assert.doesNotMatch(routeSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue|security-assessment/);
  assert.doesNotMatch(routeSource, /syntheticConfirmUploadAndEnqueue|createSyntheticConfirmUploadAndEnqueue/);
  assert.doesNotMatch(executorSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue/);
  assert.doesNotMatch(assessorSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue/);
  assert.doesNotMatch(barrelSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue/);
  assert.doesNotMatch(barrelSource, /syntheticConfirmUploadAndEnqueue|createSyntheticConfirmUploadAndEnqueue/);
});

test("synthetic confirm-and-enqueue composition requires explicit enqueue participant", () => {
  assert.throws(
    () => createSyntheticConfirmUploadAndEnqueue({
      uploadLifecycleRepository: createInMemoryUploadLifecycleRepository(),
    }),
    /requires lifecycle and enqueue participants/,
  );
  assert.throws(
    () => createSyntheticConfirmUploadAndEnqueue({
      uploadLifecycleRepository: createInMemoryUploadLifecycleRepository(),
      securityAssessmentEnqueue: {
        enqueueSecurityAssessment() {
          return { ok: true };
        },
      },
    }),
    /securityAssessmentEnqueue must expose the synthetic transaction participant/,
  );
});

test("deduplication identity key is the exact authorized four-fact conjunction", () => {
  assert.equal(
    __testables.assessmentIdentityKey(BASE_FACTS),
    [
      BASE_FACTS.organizationId,
      BASE_FACTS.intakeFileId,
      BASE_FACTS.objectVersionId,
      BASE_FACTS.verifiedChecksum,
    ].join("\u0000"),
  );
  assert.deepEqual(Array.from(__testables.ALLOWED_FACT_KEYS), [
    "organizationId",
    "intakeFileId",
    "objectVersionId",
    "verifiedChecksum",
    "verifiedSizeBytes",
    "declaredMime",
    "extension",
  ]);
});

test("synthetic transaction prepares both participants before assignment-only canonical publication", () => {
  const source = readFileSync("Backend/kai/security/syntheticConfirmUploadAndEnqueue.js", "utf8");
  const commitBlock = source.match(/if \(command === "COMMIT"\) \{([\s\S]*?)\n          \}/)?.[1];
  assert.ok(commitBlock);

  const lines = commitBlock
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.deepEqual(lines, [
    "const [lifecycleTransaction, enqueueTransaction] = context._participants || [];",
    "const lifecyclePublication = lifecycleTransaction.prepareCommit();",
    "const enqueuePublication = enqueueTransaction.prepareCommit();",
    "lifecyclePublication.target.state = lifecyclePublication.preparedState;",
    "enqueuePublication.target.state = enqueuePublication.preparedState;",
    "transactionEvents?.push?.(\"COMMIT\");",
    "return { rows: [] };",
  ]);

  const publicationLines = lines.slice(3, 5);
  assert.deepEqual(publicationLines, [
    "lifecyclePublication.target.state = lifecyclePublication.preparedState;",
    "enqueuePublication.target.state = enqueuePublication.preparedState;",
  ]);
  assert.equal(publicationLines.every((line) => /^[a-zA-Z]+Publication\.target\.state = [a-zA-Z]+Publication\.preparedState;$/.test(line)), true);
  assert.equal(publicationLines.some((line) => /\(|\)|new |\.set|\.push|\.map|\.snapshot|prepareCommit|callback|validate|dedup|conflict/.test(line)), false);
});

test("synthetic transaction participant publication objects are plain prepared state references", async () => {
  const uploadLifecycleRepository = createUploadedLifecycleRepository();
  const securityAssessmentEnqueue = createSyntheticSecurityAssessmentEnqueue();
  const provider = syntheticConfirmTestables.createSyntheticTransactionProvider({
    uploadLifecycleRepository,
    securityAssessmentEnqueue,
  });
  const transactionContext = await provider.connect();
  await transactionContext.query("BEGIN");
  transactionContext.uploadLifecycleRepository.transitionUploadLifecycle(
    uploadTransitionInput("uploaded_unconfirmed", "confirmed", {
      objectVersionId: BASE_FACTS.objectVersionId,
      verifiedChecksum: BASE_FACTS.verifiedChecksum,
      verifiedSizeBytes: BASE_FACTS.verifiedSizeBytes,
    }),
  );
  transactionContext.securityAssessmentEnqueue.enqueueSecurityAssessment(BASE_FACTS);

  const [lifecycleTransaction, enqueueTransaction] = transactionContext._participants;
  const lifecyclePublication = lifecycleTransaction.prepareCommit();
  const enqueuePublication = enqueueTransaction.prepareCommit();

  for (const publication of [lifecyclePublication, enqueuePublication]) {
    assert.equal(Object.getPrototypeOf(publication.target), Object.prototype);
    assert.equal(Object.getOwnPropertyDescriptor(publication.target, "state").set, undefined);
    assert.equal(Object.getOwnPropertyDescriptor(publication, "preparedState").get, undefined);
    assert.equal(Object.getPrototypeOf(publication.preparedState), Object.prototype);
  }
  assert.notStrictEqual(lifecyclePublication.target.state, lifecyclePublication.preparedState);
  assert.notStrictEqual(enqueuePublication.target.state, enqueuePublication.preparedState);
  await transactionContext.query("ROLLBACK");
  transactionContext.release();
});

test("synthetic confirm fresh publication and identical replay preserve one prepared enqueue identity", async () => {
  const uploadLifecycleRepository = createUploadedLifecycleRepository();
  const securityAssessmentEnqueue = createSyntheticSecurityAssessmentEnqueue();
  const syntheticConfirmation = createSyntheticConfirmUploadAndEnqueue({
    uploadLifecycleRepository,
    securityAssessmentEnqueue,
    confirmUpload: localConfirmUpload,
  });

  const first = await syntheticConfirmation.confirmUpload(CONFIRM_INPUT, {
    getIntakeFileMetadata: async () => metadataRow(),
  });
  const replay = await syntheticConfirmation.confirmUpload(CONFIRM_INPUT, {
    getIntakeFileMetadata: async () => metadataRow(),
  });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.equal(readLifecycle(uploadLifecycleRepository).upload_state, "confirmed");
  assert.deepEqual(securityAssessmentEnqueue.listSecurityAssessmentEnqueueRecords(), [{
    security_assessment_enqueue_id: "synthetic-security-assessment-000001",
    organization_id: BASE_FACTS.organizationId,
    intake_file_id: BASE_FACTS.intakeFileId,
    object_version_id: BASE_FACTS.objectVersionId,
    verified_checksum: BASE_FACTS.verifiedChecksum,
    verified_size_bytes: BASE_FACTS.verifiedSizeBytes,
    declared_mime: BASE_FACTS.declaredMime,
    extension: BASE_FACTS.extension,
  }]);
});

test("synthetic confirm callback-phase enqueue failure leaves both canonical stores unchanged", async () => {
  const uploadLifecycleRepository = createUploadedLifecycleRepository();
  const beforeLifecycle = readLifecycle(uploadLifecycleRepository);
  const securityAssessmentEnqueue = createSyntheticSecurityAssessmentEnqueue();
  const syntheticConfirmation = createSyntheticConfirmUploadAndEnqueue({
    uploadLifecycleRepository,
    securityAssessmentEnqueue,
    confirmUpload: localConfirmUpload,
  });

  const result = await syntheticConfirmation.confirmUpload(CONFIRM_INPUT, {
    getIntakeFileMetadata: async () => metadataRow({ mime_type: "Text/Plain" }),
  });

  assert.deepEqual(result, VALIDATION_BLOCKER);
  assert.deepEqual(readLifecycle(uploadLifecycleRepository), beforeLifecycle);
  assert.deepEqual(securityAssessmentEnqueue.listSecurityAssessmentEnqueueRecords(), []);
});

test("synthetic confirm preparation failure leaves both canonical stores unchanged", async () => {
  const uploadLifecycleRepository = createUploadedLifecycleRepository();
  const beforeLifecycle = readLifecycle(uploadLifecycleRepository);
  const securityAssessmentEnqueue = createPreparationFailingEnqueue();
  const syntheticConfirmation = createSyntheticConfirmUploadAndEnqueue({
    uploadLifecycleRepository,
    securityAssessmentEnqueue,
    confirmUpload: localConfirmUpload,
  });

  const result = await syntheticConfirmation.confirmUpload(CONFIRM_INPUT, {
    getIntakeFileMetadata: async () => metadataRow(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "system_error");
  assert.deepEqual(readLifecycle(uploadLifecycleRepository), beforeLifecycle);
  assert.deepEqual(securityAssessmentEnqueue.listSecurityAssessmentEnqueueRecords(), []);
});

test("synthetic confirm changed facts remain conflict_current_state_changed before publication", async () => {
  const uploadLifecycleRepository = createUploadedLifecycleRepository();
  const securityAssessmentEnqueue = createSyntheticSecurityAssessmentEnqueue();
  const syntheticConfirmation = createSyntheticConfirmUploadAndEnqueue({
    uploadLifecycleRepository,
    securityAssessmentEnqueue,
    confirmUpload: localConfirmUpload,
  });
  const first = await syntheticConfirmation.confirmUpload(CONFIRM_INPUT, {
    getIntakeFileMetadata: async () => metadataRow(),
  });
  assert.equal(first.ok, true);
  const beforeLifecycle = readLifecycle(uploadLifecycleRepository);
  const beforeEnqueue = securityAssessmentEnqueue.listSecurityAssessmentEnqueueRecords();

  for (const confirmUpload of [
    async (input, dependencies) => {
      await dependencies.getIntakeFileMetadata(input.organizationId, input.intakeFileId);
      return dependencies.uploadLifecycleRepository.transitionUploadLifecycle(
        uploadTransitionInput("uploaded_unconfirmed", "confirmed", {
          objectVersionId: "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          verifiedChecksum: BASE_FACTS.verifiedChecksum,
          verifiedSizeBytes: BASE_FACTS.verifiedSizeBytes,
        }),
      );
    },
    async (input, dependencies) => {
      await dependencies.getIntakeFileMetadata(input.organizationId, input.intakeFileId);
      return dependencies.uploadLifecycleRepository.transitionUploadLifecycle(
        uploadTransitionInput("uploaded_unconfirmed", "confirmed", {
          objectVersionId: BASE_FACTS.objectVersionId,
          verifiedChecksum: "b".repeat(64),
          verifiedSizeBytes: BASE_FACTS.verifiedSizeBytes,
        }),
      );
    },
  ]) {
    const changedSyntheticConfirmation = createSyntheticConfirmUploadAndEnqueue({
      uploadLifecycleRepository,
      securityAssessmentEnqueue,
      confirmUpload,
    });
    const result = await changedSyntheticConfirmation.confirmUpload(CONFIRM_INPUT, {
      getIntakeFileMetadata: async () => metadataRow(),
    });
    assert.deepEqual(result, CHANGED_STATE_CONFLICT);
    assert.deepEqual(readLifecycle(uploadLifecycleRepository), beforeLifecycle);
    assert.deepEqual(securityAssessmentEnqueue.listSecurityAssessmentEnqueueRecords(), beforeEnqueue);
  }
});
