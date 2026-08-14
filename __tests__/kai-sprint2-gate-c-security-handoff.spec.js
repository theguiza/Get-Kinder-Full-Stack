import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  __testables as intakeServiceTestables,
  confirmUpload,
} from "../Backend/kai/services/kaiIntakeService.js";
import {
  __testables as productionAssessmentTestables,
  runProductionSecurityAssessment,
} from "../Backend/kai/security/productionSecurityAssessmentComposition.js";
import { policyDecisionOutcomeForAssessmentResult } from "../Backend/kai/security/assessmentPolicyOutcome.js";
import {
  __testables as syntheticPolicyCompositionTestables,
} from "../Backend/kai/security/syntheticAssessmentPolicyComposition.js";

const applyConfirmedSecurityAssessment = intakeServiceTestables.applyConfirmedSecurityAssessment;

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const intakeFileId = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const objectVersionId = "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const verifiedChecksum = "b".repeat(64);
const verifiedSizeBytes = 42;

function pendingFactsRow(overrides = {}) {
  return {
    organization_id: organizationId,
    intake_file_id: intakeFileId,
    object_version_id: objectVersionId,
    verified_checksum: verifiedChecksum,
    verified_size_bytes: verifiedSizeBytes,
    mime_type: "text/plain",
    file_extension: ".txt",
    file_policy_status: "pending",
    storage_provider: "gcs",
    storage_object_key: "kai/intake/some-object-key",
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const events = [];
  const transactionContext = { name: "tx-context" };
  return {
    events,
    transactionContext,
    factsRow: pendingFactsRow(),
    updatedRow: { ...pendingFactsRow(), file_policy_status: "passed" },
    auditResult: { ok: true },
    assessmentResult: { ok: true, data: { assessmentResult: { policy: "pass" }, policyDecisionOutcome: "passed" } },
    readCalls: [],
    assessmentCalls: [],
    writeCalls: [],
    auditMetadata: null,
    async runInTransaction(callback) {
      this.events.push("BEGIN");
      try {
        const result = await callback(transactionContext);
        this.events.push("COMMIT");
        return result;
      } catch (error) {
        this.events.push("ROLLBACK");
        throw error;
      }
    },
    ...overrides,
  };
}

function dependenciesFromHarness(harness) {
  return {
    now: () => "2026-08-01T00:00:00.000Z",
    runInTransaction: harness.runInTransaction.bind(harness),
    async getScopedIntakeFileSecurityAssessmentFacts(identity) {
      harness.readCalls.push(identity);
      return harness.factsRow;
    },
    async runProductionSecurityAssessment(trustedFacts, deps) {
      harness.assessmentCalls.push({ trustedFacts, deps });
      if (harness.throwOnAssessment) throw new Error("synthetic assessment failure");
      return typeof harness.assessmentResult === "function" ? harness.assessmentResult() : harness.assessmentResult;
    },
    async casSecurityAssessmentFilePolicyDecision(mutation, transactionContext) {
      harness.writeCalls.push({ mutation, transactionContext });
      if (harness.throwOnWrite) throw new Error("synthetic mutation failure");
      if (harness.writeReturnsNull) return null;
      return harness.updatedRow;
    },
    async insertRequiredSuccessfulAuditEvent(metadata, transactionContext) {
      harness.auditMetadata = metadata;
      harness.auditTransactionContext = transactionContext;
      if (harness.throwOnAudit) throw new Error("synthetic audit failure");
      return typeof harness.auditResult === "function" ? harness.auditResult() : harness.auditResult;
    },
  };
}

function baseInput() {
  return {
    organizationId,
    intakeFileId,
    objectVersionId,
    verifiedChecksum,
    verifiedSizeBytes,
    requestId: "request_1",
    actorContext: { actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b", actorType: "human" },
  };
}

test("fresh confirmed facts with an eligible outcome apply exactly one mutation and one required audit", async () => {
  const harness = createHarness();
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.writeCalls.length, 1);
  assert.deepEqual(harness.writeCalls[0].mutation, {
    organizationId,
    intakeFileId,
    objectVersionId,
    verifiedChecksum,
    verifiedSizeBytes,
    newFilePolicyStatus: "passed",
  });
  assert.equal(harness.writeCalls[0].transactionContext, harness.transactionContext);
  assert.ok(harness.auditMetadata);
  assert.equal(harness.auditMetadata.operation, "apply_security_assessment_policy_decision");
  assert.equal(harness.auditMetadata.organization_id, organizationId);
  assert.equal(harness.auditMetadata.object_id, intakeFileId);
  assert.equal(harness.auditMetadata.to_state, "passed");
  assert.deepEqual(harness.events, ["BEGIN", "COMMIT"]);
});

test("trusted stored facts drive the assessment call, not caller-controlled values", async () => {
  const harness = createHarness();
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.assessmentCalls.length, 1);
  const { trustedFacts } = harness.assessmentCalls[0];
  assert.equal(trustedFacts.organizationId, organizationId);
  assert.equal(trustedFacts.intakeFileId, intakeFileId);
  assert.equal(trustedFacts.objectVersionId, objectVersionId);
  assert.equal(trustedFacts.verifiedChecksum, verifiedChecksum);
  assert.equal(trustedFacts.verifiedSizeBytes, verifiedSizeBytes);
  assert.equal(trustedFacts.declaredMime, "text/plain");
  assert.equal(trustedFacts.extension, ".txt");
});

test("already-terminal file_policy_status is a no-op: no assessment call, no mutation, no audit", async () => {
  const harness = createHarness({ factsRow: pendingFactsRow({ file_policy_status: "blocked" }) });
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.assessmentCalls.length, 0);
  assert.equal(harness.writeCalls.length, 0);
  assert.equal(harness.auditMetadata, null);
});

test("changed immutable facts fail closed with no mutation and no audit", async () => {
  const harness = createHarness({ factsRow: pendingFactsRow({ object_version_id: "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }) });
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.assessmentCalls.length, 0);
  assert.equal(harness.writeCalls.length, 0);
  assert.equal(harness.auditMetadata, null);
});

test("not_configured malware result cannot produce a policy pass: null outcome leaves the file pending", async () => {
  const harness = createHarness({
    assessmentResult: {
      ok: true,
      data: { assessmentResult: { status: "failed", category: "malware_scan_not_configured" }, policyDecisionOutcome: null },
    },
  });
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.writeCalls.length, 0);
  assert.equal(harness.auditMetadata, null);
});

test("integrity/executor failure prevents any policy mutation", async () => {
  const harness = createHarness({ assessmentResult: { ok: false, error: { code: "assessment_read_integrity_failure" } } });
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.writeCalls.length, 0);
  assert.equal(harness.auditMetadata, null);
});

test("concurrent conflicting attempt: the CAS write losing the race fails closed with no audit", async () => {
  const harness = createHarness({ writeReturnsNull: true });
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.writeCalls.length, 1);
  assert.equal(harness.auditMetadata, null);
  assert.deepEqual(harness.events, ["BEGIN", "ROLLBACK"]);
});

test("required audit failure rolls back the policy mutation", async () => {
  const harness = createHarness({ throwOnAudit: true });
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.writeCalls.length, 1);
  assert.deepEqual(harness.events, ["BEGIN", "ROLLBACK"]);
});

test("mutation failure creates no success audit", async () => {
  const harness = createHarness({ throwOnWrite: true });
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));

  assert.equal(harness.auditMetadata, null);
  assert.deepEqual(harness.events, ["BEGIN", "ROLLBACK"]);
});

test("assessment invocation throwing does not throw out of the confirmation path", async () => {
  const harness = createHarness({ throwOnAssessment: true });
  await assert.doesNotReject(applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness)));
  assert.equal(harness.writeCalls.length, 0);
});

test("organization/file scoping: mutation is bound to the exact organization_id and intake_file_id", async () => {
  const harness = createHarness();
  await applyConfirmedSecurityAssessment(baseInput(), dependenciesFromHarness(harness));
  assert.equal(harness.writeCalls[0].mutation.organizationId, organizationId);
  assert.equal(harness.writeCalls[0].mutation.intakeFileId, intakeFileId);
});

test("runProductionSecurityAssessment rejects caller-shaped facts missing required trusted fields", async () => {
  const result = await runProductionSecurityAssessment({ organizationId, intakeFileId }, {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "validation_blocker");
});

test("runProductionSecurityAssessment reaches the internal executor with an injected executor and returns a policy outcome", async () => {
  const bytes = Buffer.from("hello world");
  const facts = {
    organizationId,
    intakeFileId,
    objectVersionId,
    verifiedChecksum: createHash("sha256").update(bytes).digest("hex"),
    verifiedSizeBytes: bytes.byteLength,
    declaredMime: "text/plain",
    extension: ".txt",
  };
  const storageAdapter = {
    async openObjectVersionReadStream({ objectVersionId: requestedId }) {
      assert.equal(requestedId, facts.objectVersionId);
      return {
        ok: true,
        data: {
          object_version_id: facts.objectVersionId,
          size_bytes: bytes.byteLength,
          byte_source: {
            [Symbol.asyncIterator]() {
              let done = false;
              return {
                async next() {
                  if (done) return { done: true, value: undefined };
                  done = true;
                  return { done: false, value: bytes };
                },
              };
            },
            async close() {},
          },
        },
      };
    },
  };
  let executorCalled = false;
  const internalSecurityAssessmentExecutor = {
    seamKind: "kai_sprint2_internal_security_assessment_executor",
    identity: { actorType: "internal_service", serviceIdentity: "kai_file_security_executor", operationGroup: "file_security_assessment" },
    async execute() {
      executorCalled = true;
      return { policy: "pass" };
    },
  };
  const result = await runProductionSecurityAssessment(facts, { storageAdapter, internalSecurityAssessmentExecutor });
  assert.equal(executorCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.data.policyDecisionOutcome, "passed");
});

test("production composition with missing ClamAV config keeps not_configured and performs zero scanner/auth calls", async () => {
  const bytes = Buffer.from("clamav missing config production text", "utf8");
  const facts = {
    organizationId,
    intakeFileId,
    objectVersionId,
    verifiedChecksum: createHash("sha256").update(bytes).digest("hex"),
    verifiedSizeBytes: bytes.byteLength,
    declaredMime: "text/plain",
    extension: ".txt",
  };
  const storageAdapter = {
    async openObjectVersionReadStream() {
      return {
        ok: true,
        data: {
          object_version_id: facts.objectVersionId,
          size_bytes: bytes.byteLength,
          byte_source: {
            [Symbol.asyncIterator]() {
              let done = false;
              return {
                async next() {
                  if (done) return { done: true, value: undefined };
                  done = true;
                  return { done: false, value: bytes };
                },
              };
            },
            async close() {},
          },
        },
      };
    },
  };

  let fetchCalled = false;
  let idTokenFactoryCalled = false;
  const result = await runProductionSecurityAssessment(facts, {
    storageAdapter,
    env: {},
    clamavAdapterDependencies: {
      idTokenClientFactory() {
        idTokenFactoryCalled = true;
        return { async getIdToken() { throw new Error("must not call auth"); } };
      },
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error("must not call scanner");
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.assessmentResult, { status: "failed", category: "malware_scan_not_configured" });
  assert.equal(result.data.policyDecisionOutcome, null);
  assert.equal(idTokenFactoryCalled, false);
  assert.equal(fetchCalled, false);
});

test("production composition with valid ClamAV config wires config to executor to assessor to adapter", async () => {
  const bytes = Buffer.from("clamav valid config production text", "utf8");
  const facts = {
    organizationId,
    intakeFileId,
    objectVersionId,
    verifiedChecksum: createHash("sha256").update(bytes).digest("hex"),
    verifiedSizeBytes: bytes.byteLength,
    declaredMime: "text/plain",
    extension: ".txt",
  };
  const storageAdapter = {
    async openObjectVersionReadStream() {
      return {
        ok: true,
        data: {
          object_version_id: facts.objectVersionId,
          size_bytes: bytes.byteLength,
          byte_source: {
            [Symbol.asyncIterator]() {
              let done = false;
              return {
                async next() {
                  if (done) return { done: true, value: undefined };
                  done = true;
                  return { done: false, value: bytes };
                },
              };
            },
            async close() {},
          },
        },
      };
    },
  };
  const calls = [];
  const scannerUrl = "https://clamav-scanner.example.run.app";
  const targetPrincipal = "kai-clamav-invoker@example-project.iam.gserviceaccount.com";

  const result = await runProductionSecurityAssessment(facts, {
    storageAdapter,
    env: {
      KAI_GATE_C_CLAMAV_SCANNER_URL: scannerUrl,
      KAI_GATE_C_CLAMAV_SCANNER_INVOKER_TARGET_PRINCIPAL: targetPrincipal,
    },
    clamavAdapterDependencies: {
      idTokenClientFactory({ targetPrincipal: requestedPrincipal }) {
        calls.push({ targetPrincipal: requestedPrincipal });
        return {
          async getIdToken(audience) {
            calls.push({ audience });
            return "synthetic-id-token";
          },
        };
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, method: options.method, contentType: options.headers["content-type"] });
        assert.equal(Buffer.compare(Buffer.from(options.body), bytes), 0);
        return {
          ok: true,
          async text() {
            return JSON.stringify({ status: "clean" });
          },
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.assessmentResult, { policy: "pass" });
  assert.equal(result.data.policyDecisionOutcome, "passed");
  assert.deepEqual(calls, [
    { targetPrincipal },
    { audience: scannerUrl },
    { url: `${scannerUrl}/scan`, method: "POST", contentType: "application/octet-stream" },
  ]);
});

test("production security assessment composition never imports synthetic modules", async () => {
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../Backend/kai/security/productionSecurityAssessmentComposition.js", import.meta.url),
    "utf8",
  );
  const importSpecifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(importSpecifiers.length > 0);
  for (const specifier of importSpecifiers) {
    assert.equal(/synthetic/i.test(specifier), false, specifier);
  }
});

test("policyDecisionOutcomeForAssessmentResult mapping is shared: malware_scan_not_configured stays non-eligible", () => {
  assert.equal(policyDecisionOutcomeForAssessmentResult({ status: "failed", category: "malware_scan_not_configured" }), null);
  assert.equal(policyDecisionOutcomeForAssessmentResult({ policy: "pass" }), "passed");
  assert.equal(policyDecisionOutcomeForAssessmentResult({ policy: "block", category: "malware_failed" }), "blocked");
  assert.equal(policyDecisionOutcomeForAssessmentResult({ status: "failed", category: "security_assessment_timeout" }), "failed");
});

test("synthetic policy composition still exposes the refactored-out pure outcome mapping unchanged", () => {
  assert.equal(
    syntheticPolicyCompositionTestables.policyDecisionOutcomeForAssessmentResult,
    policyDecisionOutcomeForAssessmentResult,
  );
});

test("confirmUpload non-gcs success path invokes the security-assessment handoff with trusted facts and unchanged public DTO", async () => {
  const now = "2026-08-01T00:00:00.000Z";
  const bytes = Buffer.from("hello");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const harness = createHarness({
    factsRow: pendingFactsRow({ verified_checksum: checksum, verified_size_bytes: bytes.byteLength }),
  });

  const lifecycleRepository = {
    async getUploadLifecycle() {
      return {
        ok: true,
        data: {
          record: {
            organization_id: organizationId,
            intake_file_id: intakeFileId,
            upload_state: "uploaded_unconfirmed",
            object_version_id: objectVersionId,
          },
        },
      };
    },
    async transitionUploadLifecycle() {
      return {
        ok: true,
        data: {
          replayed: false,
          record: {
            organization_id: organizationId,
            intake_file_id: intakeFileId,
            upload_state: "confirmed",
            object_version_id: objectVersionId,
            verified_checksum: checksum,
            verified_size_bytes: bytes.byteLength,
          },
        },
      };
    },
  };

  const storageAdapter = {
    async openObjectVersionReadStream() {
      return {
        ok: true,
        data: {
          object_version_id: objectVersionId,
          size_bytes: bytes.byteLength,
          byte_source: {
            [Symbol.asyncIterator]() {
              let done = false;
              return {
                async next() {
                  if (done) return { done: true, value: undefined };
                  done = true;
                  return { done: false, value: bytes };
                },
              };
            },
            async close() {},
          },
        },
      };
    },
  };

  const result = await confirmUpload(
    {
      organizationId,
      intakeFileId,
      now,
      actorContext: { actorType: "human", actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b", kaiRoles: ["gk_operator"], organizationMemberships: [{ organization_id: organizationId, role_name: "gk_operator", membership_status: "active" }] },
    },
    {
      env: { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true" },
      uploadLifecycleRepository: lifecycleRepository,
      storageAdapter,
      async getIntakeFileMetadata() {
        return {
          organization_id: organizationId,
          intake_file_id: intakeFileId,
          engagement_id: null,
          intake_batch_id: "8e426ea1-2be3-4e48-b80f-9783ddbacda0",
          checksum,
          hash_algorithm: "sha256",
          file_size_bytes: bytes.byteLength,
          storage_provider: "local_dev",
        };
      },
      ...dependenciesFromHarness(harness),
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.keys(result.data).sort(),
    ["intake_batch_id", "intake_file_id", "object_version_id", "organization_id", "replayed", "upload_state", "verified_size_bytes"].sort(),
  );

  assert.equal(harness.assessmentCalls.length, 1);
  assert.equal(harness.assessmentCalls[0].trustedFacts.objectVersionId, objectVersionId);
  assert.equal(harness.assessmentCalls[0].trustedFacts.verifiedChecksum, checksum);
  assert.equal(harness.writeCalls.length, 1);
  assert.equal(harness.writeCalls[0].mutation.newFilePolicyStatus, "passed");
});
