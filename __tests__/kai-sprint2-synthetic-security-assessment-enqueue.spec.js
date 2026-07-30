import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { uploadLifecycleFailure } from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";
import {
  createSyntheticSecurityAssessmentEnqueue,
  __testables,
} from "../Backend/kai/security/syntheticSecurityAssessmentEnqueue.js";

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
  const intakeServiceSource = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const executorSource = readFileSync("Backend/kai/security/internalSecurityAssessmentExecutor.js", "utf8");
  const assessorSource = readFileSync("Backend/kai/security/boundedFileSecurityAssessor.js", "utf8");
  const barrelSource = readFileSync("Backend/kai/index.js", "utf8");

  assert.doesNotMatch(enqueueSource, /executeInjectedInternalSecurityAssessment|createInternalSecurityAssessmentExecutor|assessBoundedFileSecurity|drain|router|express|pg|sql|file_policy_status|transitionUploadLifecycle/i);
  assert.doesNotMatch(intakeServiceSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue/);
  assert.doesNotMatch(routeSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue|security-assessment/);
  assert.doesNotMatch(executorSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue/);
  assert.doesNotMatch(assessorSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue/);
  assert.doesNotMatch(barrelSource, /syntheticSecurityAssessmentEnqueue|createSyntheticSecurityAssessmentEnqueue/);
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
