import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  C2_UNCLASSIFIED_OUTCOME,
  executeSyntheticAssessmentPolicyDecisionFromEnqueueRecord,
} from "../Backend/kai/security/syntheticAssessmentPolicyComposition.js";
import { createInternalSecurityAssessmentExecutor } from "../Backend/kai/security/internalSecurityAssessmentExecutor.js";
import { createSyntheticSecurityAssessmentEnqueue } from "../Backend/kai/security/syntheticSecurityAssessmentEnqueue.js";
import { executeSyntheticAssessmentFromEnqueueRecord } from "../Backend/kai/security/syntheticAssessmentComposition.js";
import { createInMemoryUploadLifecycleRepository } from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";

const NOW = "2026-08-02T10:00:00.000Z";
const POLICY_NOW = "2026-08-02T10:05:00.000Z";
const OBJECT_VERSION_ID = "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function byteSource(chunks) {
  let index = 0;
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (index >= chunks.length) return { done: true, value: undefined };
      const value = chunks[index];
      index += 1;
      return { done: false, value };
    },
    async close() {},
  };
}

function storageAdapterFor(bytesByObjectVersion) {
  return {
    async openObjectVersionReadStream(input) {
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
  organizationId = "org-c2",
  intakeBatchId = "batch-c2",
  intakeFileId = "file-c2",
  objectVersionId = OBJECT_VERSION_ID,
  bytes = Buffer.from("safe c2 text\n", "utf8"),
  declaredMime = "text/plain",
  extension = ".txt",
} = {}) {
  return {
    organizationId,
    intakeBatchId,
    intakeFileId,
    objectVersionId,
    verifiedChecksum: sha256Hex(bytes),
    verifiedSizeBytes: bytes.byteLength,
    declaredMime,
    extension,
  };
}

function enqueueFacts(facts) {
  return {
    organizationId: facts.organizationId,
    intakeFileId: facts.intakeFileId,
    objectVersionId: facts.objectVersionId,
    verifiedChecksum: facts.verifiedChecksum,
    verifiedSizeBytes: facts.verifiedSizeBytes,
    declaredMime: facts.declaredMime,
    extension: facts.extension,
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

function createAuditProbe() {
  const prepared = [];
  const published = [];
  return {
    prepared,
    published,
    dependency: {
      prepareMetadataOnlyAudit(input) {
        prepared.push(input);
        return {
          ok: true,
          publish() {
            published.push(input);
          },
        };
      },
    },
  };
}

function createConfirmedLifecycle(facts) {
  const repo = createInMemoryUploadLifecycleRepository();
  assert.equal(repo.createReservedUploadLifecycle({
    organizationId: facts.organizationId,
    intakeBatchId: facts.intakeBatchId,
    intakeFileId: facts.intakeFileId,
    now: NOW,
  }).ok, true);
  assert.equal(repo.transitionUploadLifecycle({
    organizationId: facts.organizationId,
    intakeFileId: facts.intakeFileId,
    expectedUploadState: "reserved",
    newUploadState: "upload_started",
    now: NOW,
  }).ok, true);
  assert.equal(repo.transitionUploadLifecycle({
    organizationId: facts.organizationId,
    intakeFileId: facts.intakeFileId,
    expectedUploadState: "upload_started",
    newUploadState: "uploaded_unconfirmed",
    objectVersionId: facts.objectVersionId,
    now: NOW,
  }).ok, true);
  assert.equal(repo.transitionUploadLifecycle({
    organizationId: facts.organizationId,
    intakeFileId: facts.intakeFileId,
    expectedUploadState: "uploaded_unconfirmed",
    newUploadState: "confirmed",
    objectVersionId: facts.objectVersionId,
    verifiedChecksum: facts.verifiedChecksum,
    verifiedSizeBytes: facts.verifiedSizeBytes,
    now: NOW,
  }).ok, true);
  return repo;
}

function readLifecycle(repo, facts) {
  const result = repo.getUploadLifecycle({
    organizationId: facts.organizationId,
    intakeFileId: facts.intakeFileId,
  });
  assert.equal(result.ok, true);
  return result.data.record;
}

function createScenario({ facts = factsFor(), assessmentResult = { policy: "pass" } } = {}) {
  const lifecycle = createConfirmedLifecycle(facts);
  const enqueue = createSyntheticSecurityAssessmentEnqueue();
  assert.equal(enqueue.enqueueSecurityAssessment(enqueueFacts(facts)).ok, true);
  const audit = createAuditProbe();
  let packageBCalls = 0;
  const executeAssessmentFromEnqueueRecord = async (selectionIdentity, dependencies) => {
    packageBCalls += 1;
    return executeSyntheticAssessmentFromEnqueueRecord(selectionIdentity, {
      ...dependencies,
      internalSecurityAssessmentExecutor: createInternalSecurityAssessmentExecutor({
        async assessor(input) {
          assert.equal(input.sha256, facts.verifiedChecksum);
          return assessmentResult;
        },
      }),
    });
  };

  return {
    facts,
    lifecycle,
    enqueue,
    audit,
    storageAdapter: storageAdapterFor(new Map([[facts.objectVersionId, Buffer.from("safe c2 text\n", "utf8")]])),
    packageBCallCount() {
      return packageBCalls;
    },
    executeAssessmentFromEnqueueRecord,
  };
}

async function runC2(scenario, overrides = {}) {
  return executeSyntheticAssessmentPolicyDecisionFromEnqueueRecord(
    selectionFromFacts(scenario.facts, overrides.selection || {}),
    {
      securityAssessmentEnqueue: scenario.enqueue,
      storageAdapter: scenario.storageAdapter,
      uploadLifecycleRepository: scenario.lifecycle,
      metadataOnlyAudit: scenario.audit.dependency,
      now: POLICY_NOW,
      executeAssessmentFromEnqueueRecord: scenario.executeAssessmentFromEnqueueRecord,
      ...overrides.dependencies,
    },
  );
}

test("Package B is called exactly once and C1 binds to the same stored enqueue record", async () => {
  const scenario = createScenario();
  const enqueueBefore = scenario.enqueue.listSecurityAssessmentEnqueueRecords();

  const result = await runC2(scenario);

  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.equal(scenario.packageBCallCount(), 1);
  assert.equal(result.data.record.object_version_id, enqueueBefore[0].object_version_id);
  assert.equal(result.data.record.verified_checksum, enqueueBefore[0].verified_checksum);
  assert.equal(result.data.record.verified_size_bytes, enqueueBefore[0].verified_size_bytes);
  assert.deepEqual(scenario.audit.prepared[0].payload, {
    attempted_operation: "policy_decision_compare_and_set",
    actor_type: "internal_service",
    blocked_reason_code: "passed",
    contract: "owner_decision_post_b_policy_transition_v1",
    file_policy_status: "passed",
    object_type: "intake_file",
    request_scope: "organization_intake_file",
    route_contract: "unwired_synthetic_lifecycle_repository",
    sprint_phase: "kai_sprint2_p0_c1",
    validator_key: "VAL-KAI-POLICY-C1-001",
  });
  assert.deepEqual(scenario.enqueue.listSecurityAssessmentEnqueueRecords(), enqueueBefore);
});

test("caller values cannot override trusted stored facts sent to C1", async () => {
  const facts = factsFor();
  const scenario = createScenario({ facts, assessmentResult: { policy: "block", category: "malware_failed" } });
  const calls = [];
  const wrappedLifecycle = {
    compareAndSetPolicyDecision(input) {
      calls.push(input);
      return scenario.lifecycle.compareAndSetPolicyDecision(input);
    },
  };

  const result = await runC2(scenario, {
    dependencies: {
      uploadLifecycleRepository: wrappedLifecycle,
      confirmedFileFacts: {
        organizationId: "attacker-org",
        intakeFileId: "attacker-file",
        objectVersionId: "attacker-version",
        verifiedChecksum: "b".repeat(64),
        verifiedSizeBytes: 999,
        declaredMime: "application/pdf",
        extension: ".pdf",
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].confirmedFileFacts, {
    organizationId: facts.organizationId,
    intakeFileId: facts.intakeFileId,
    objectVersionId: facts.objectVersionId,
    verifiedChecksum: facts.verifiedChecksum,
    verifiedSizeBytes: facts.verifiedSizeBytes,
    declaredMime: facts.declaredMime,
    extension: facts.extension,
  });
});

test("pass, block, and policy-eligible failures call C1 once with the correct outcome", async () => {
  const cases = [
    [{ policy: "pass" }, "passed", "passed"],
    [{ policy: "block", category: "csv_row_limit_exceeded" }, "blocked", "blocked"],
    [{ status: "failed", category: "security_assessment_timeout" }, "failed", "failed"],
    [{ status: "failed", category: "input_size_exceeds_pre_parse_gate" }, "failed", "failed"],
    [{ status: "failed", category: "malware_scan_failed" }, "failed", "failed"],
  ];

  for (const [assessmentResult, auditOutcome, filePolicyStatus] of cases) {
    const scenario = createScenario({ assessmentResult });
    const result = await runC2(scenario);

    assert.equal(result.ok, true, JSON.stringify(assessmentResult));
    assert.equal(result.data.record.file_policy_status, filePolicyStatus);
    assert.equal(scenario.audit.prepared.length, 1);
    assert.equal(scenario.audit.published.length, 1);
    assert.equal(scenario.audit.prepared[0].payload.blocked_reason_code, auditOutcome);
    assert.equal(scenario.packageBCallCount(), 1);
  }
});

test("explicit non-policy outcomes call C1 zero times and leave lifecycle and enqueue unchanged", async () => {
  const cases = [
    { status: "failed", category: "maximum_concurrent_pdf_assessor_workers_exceeded" },
    { status: "failed", category: "malware_scan_not_configured" },
  ];

  for (const assessmentResult of cases) {
    const scenario = createScenario({ assessmentResult });
    const lifecycleBefore = readLifecycle(scenario.lifecycle, scenario.facts);
    const enqueueBefore = scenario.enqueue.listSecurityAssessmentEnqueueRecords();

    const result = await runC2(scenario);

    assert.deepEqual(result, {
      ok: true,
      data: {
        policyDecisionInvoked: false,
        assessmentResult,
      },
      error: null,
    });
    assert.equal(scenario.audit.prepared.length, 0);
    assert.equal(scenario.audit.published.length, 0);
    assert.equal(scenario.packageBCallCount(), 1);
    assert.deepEqual(readLifecycle(scenario.lifecycle, scenario.facts), lifecycleBefore);
    assert.deepEqual(scenario.enqueue.listSecurityAssessmentEnqueueRecords(), enqueueBefore);
  }
});

test("bridge failures call C1 zero times and remain non-policy", async () => {
  const scenario = createScenario();
  const lifecycleBefore = readLifecycle(scenario.lifecycle, scenario.facts);
  const enqueueBefore = scenario.enqueue.listSecurityAssessmentEnqueueRecords();
  const bridgeFailure = {
    ok: false,
    integrity_failure: {
      type: "assessment_read_integrity_failure",
      kind: "checksum_mismatch",
    },
  };
  scenario.executeAssessmentFromEnqueueRecord = async () => {
    return bridgeFailure;
  };

  const result = await runC2(scenario);

  assert.deepEqual(result, {
    ok: true,
    data: {
      policyDecisionInvoked: false,
      assessmentResult: bridgeFailure,
    },
    error: null,
  });
  assert.equal(scenario.audit.prepared.length, 0);
  assert.equal(scenario.audit.published.length, 0);
  assert.deepEqual(readLifecycle(scenario.lifecycle, scenario.facts), lifecycleBefore);
  assert.deepEqual(scenario.enqueue.listSecurityAssessmentEnqueueRecords(), enqueueBefore);
});

test("unclassified outcomes return typed C2_UNCLASSIFIED_OUTCOME and call C1 zero times", async () => {
  const unclassified = { status: "failed", category: "new_failure_category" };
  const scenario = createScenario({ assessmentResult: unclassified });
  const lifecycleBefore = readLifecycle(scenario.lifecycle, scenario.facts);

  const result = await runC2(scenario);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, C2_UNCLASSIFIED_OUTCOME);
  assert.equal(result.error.status, 422);
  assert.deepEqual(result.error.result, unclassified);
  assert.equal(scenario.audit.prepared.length, 0);
  assert.equal(scenario.audit.published.length, 0);
  assert.deepEqual(readLifecycle(scenario.lifecycle, scenario.facts), lifecycleBefore);
});

test("exact replay creates no second mutation or audit publication", async () => {
  const scenario = createScenario({ assessmentResult: { policy: "block", category: "malware_failed" } });

  const first = await runC2(scenario);
  const afterFirst = readLifecycle(scenario.lifecycle, scenario.facts);
  const second = await runC2(scenario);

  assert.equal(first.ok, true);
  assert.equal(first.data.replayed, false);
  assert.equal(second.ok, true);
  assert.equal(second.data.replayed, true);
  assert.deepEqual(second.data.record, afterFirst);
  assert.equal(scenario.audit.prepared.length, 1);
  assert.equal(scenario.audit.published.length, 1);
  assert.equal(scenario.packageBCallCount(), 2);
});

test("C1 conflicts are preserved", async () => {
  const scenario = createScenario({ assessmentResult: { policy: "pass" } });
  const first = await runC2(scenario);
  assert.equal(first.ok, true);

  scenario.executeAssessmentFromEnqueueRecord = async () => ({ policy: "block", category: "malware_failed" });
  const conflict = await runC2(scenario);

  assert.deepEqual(conflict, {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409 },
  });
  assert.equal(scenario.audit.prepared.length, 1);
  assert.equal(scenario.audit.published.length, 1);
});

test("C2 writes no audit independently", async () => {
  const scenario = createScenario({ assessmentResult: { status: "failed", category: "malware_scan_not_configured" } });

  await runC2(scenario);

  assert.equal(scenario.audit.prepared.length, 0);
  assert.equal(scenario.audit.published.length, 0);
});

test("protected files remain unchanged and C2 is not production reachable", () => {
  const protectedFiles = [
    "Backend/kai/db/kaiDb.js",
    "Backend/kai/security/syntheticConfirmUploadAndEnqueue.js",
    "Backend/kai/security/syntheticSecurityAssessmentEnqueue.js",
    "Backend/kai/security/syntheticAssessmentComposition.js",
    "Backend/kai/upload/inMemoryUploadLifecycleRepository.js",
    "Backend/kai/upload/uploadLifecycleRepository.js",
    "Backend/kai/security/boundedFileSecurityAssessor.js",
    "Backend/kai/security/internalSecurityAssessmentExecutor.js",
  ];
  const c2Source = readFileSync("Backend/kai/security/syntheticAssessmentPolicyComposition.js", "utf8");
  const routeSource = readFileSync("Backend/kai/routes/sprint2IntakeApi.js", "utf8");
  const barrelSource = readFileSync("Backend/kai/index.js", "utf8");
  const productionComposition = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");

  assert.doesNotMatch(c2Source, /router|express|pg|sql|enqueueSecurityAssessment|transitionUploadLifecycle|claim|lease|ack|retry|complete|delete|dequeue|drain/i);
  assert.doesNotMatch(routeSource, /syntheticAssessmentPolicyComposition|executeSyntheticAssessmentPolicyDecisionFromEnqueueRecord/);
  assert.doesNotMatch(barrelSource, /syntheticAssessmentPolicyComposition|executeSyntheticAssessmentPolicyDecisionFromEnqueueRecord/);
  assert.doesNotMatch(productionComposition, /syntheticAssessmentPolicyComposition|executeSyntheticAssessmentPolicyDecisionFromEnqueueRecord/);
  for (const file of protectedFiles) {
    assert.equal(readFileSync(file, "utf8").includes("executeSyntheticAssessmentPolicyDecisionFromEnqueueRecord"), false);
  }
});
