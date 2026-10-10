import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  KAI_P1_DISPATCH_MAX_CONCURRENT,
  KAI_P1_DISPATCH_MAX_WAITING,
  __testables as dispatchTestables,
  classifyKaiP1DispatchResult,
  createKaiP1FileDispatcher,
  getKaiP1FileDispatcher,
} from "../Backend/kai/parsing/p1FileDispatch.js";
import { __testables as intakeServiceTestables, confirmUpload } from "../Backend/kai/services/kaiIntakeService.js";

const applyConfirmedSecurityAssessment = intakeServiceTestables.applyConfirmedSecurityAssessment;

const organizationId = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const intakeFileId = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const objectVersionId = "ov_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const verifiedChecksum = "b".repeat(64);
const verifiedSizeBytes = 42;
const WORKER_ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true" });
const EXPECTED_FILE_FACTS = Object.freeze({ objectVersionId, verifiedChecksum, verifiedSizeBytes });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function completedResult() {
  return {
    ok: true,
    data: {
      organizationId,
      intakeFileId,
      result: { ok: true, data: { activated: true, run: { run: { parser_status: "completed", output_profile_id: "p-1" } } } },
      dataDictionary: { ok: true, data: { dictionary: { data_dictionary_id: "d-1" } } },
      sensitivityProfile: { ok: true, data: { sensitivityProfile: { intake_sensitivity_profile_id: "s-1" } } },
    },
    error: null,
  };
}

/** A dispatcher whose jobs only run when the test drains the scheduled callbacks. */
function manualDispatcher(options = {}) {
  const scheduled = [];
  const lines = [];
  const calls = [];
  const dispatcher = createKaiP1FileDispatcher({
    processFile: async (input, dependencies) => {
      calls.push({ input, dependencies });
      return options.result ? options.result(input) : completedResult();
    },
    schedule: (callback) => scheduled.push(callback),
    log: (line) => lines.push(line),
    ...options.dispatcher,
  });
  return {
    dispatcher,
    scheduled,
    lines,
    calls,
    drain() {
      while (scheduled.length) scheduled.shift()();
    },
  };
}

// --- Dispatcher ---

test("dispatch is synchronous and never runs P1 work in the caller's turn", async () => {
  const harness = manualDispatcher();
  const outcome = harness.dispatcher.dispatch({ organizationId, intakeFileId, expectedFileFacts: EXPECTED_FILE_FACTS }, { env: WORKER_ENV });
  assert.deepEqual(outcome, { scheduled: true, reason: null });
  assert.equal(harness.calls.length, 0, "nothing runs until the scheduled callback fires");
  harness.drain();
  await harness.dispatcher.whenIdle();
  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0].input, { organizationId, intakeFileId, expectedFileFacts: EXPECTED_FILE_FACTS });
});

test("the default scheduler defers the job to a later macrotask", async () => {
  const calls = [];
  const dispatcher = createKaiP1FileDispatcher({
    processFile: async (input) => {
      calls.push(input);
      return completedResult();
    },
    log: () => {},
  });
  dispatcher.dispatch({ organizationId, intakeFileId }, { env: WORKER_ENV });
  await Promise.resolve();
  assert.equal(calls.length, 0, "not even a microtask later");
  await dispatcher.whenIdle();
  assert.equal(calls.length, 1);
});

test("either worker gate off (or neither set) schedules nothing", async () => {
  for (const env of [
    { KAI_SPRINT2_ENABLED: "false", KAI_WORKER_ENABLED: "true" },
    { KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "false" },
    {},
  ]) {
    const harness = manualDispatcher();
    const outcome = harness.dispatcher.dispatch({ organizationId, intakeFileId }, { env });
    assert.deepEqual(outcome, { scheduled: false, reason: "worker_disabled" });
    harness.drain();
    assert.equal(harness.calls.length, 0);
    assert.equal(harness.dispatcher.stats().disabled, 1);
  }
});

test("a second notification for a file already waiting or running in this process is coalesced", async () => {
  const gate = deferred();
  const harness = manualDispatcher({ result: () => gate.promise });
  assert.equal(harness.dispatcher.dispatch({ organizationId, intakeFileId }, { env: WORKER_ENV }).scheduled, true);
  assert.deepEqual(
    harness.dispatcher.dispatch({ organizationId, intakeFileId }, { env: WORKER_ENV }),
    { scheduled: false, reason: "already_dispatched" },
  );
  harness.drain();
  await Promise.resolve();
  assert.deepEqual(
    harness.dispatcher.dispatch({ organizationId, intakeFileId }, { env: WORKER_ENV }),
    { scheduled: false, reason: "already_dispatched" },
    "still running",
  );
  gate.resolve(completedResult());
  await harness.dispatcher.whenIdle();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.dispatcher.stats().coalesced, 2);
});

test("a burst of distinct files never runs more than maxConcurrent jobs, and every accepted job runs once", async () => {
  let running = 0;
  let peak = 0;
  const gates = [];
  const started = [];
  const dispatcher = createKaiP1FileDispatcher({
    processFile: async (input) => {
      running += 1;
      peak = Math.max(peak, running);
      started.push(input.intakeFileId);
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      running -= 1;
      return completedResult();
    },
    log: () => {},
  });

  for (let index = 0; index < 8; index += 1) {
    assert.equal(dispatcher.dispatch({ organizationId, intakeFileId: `file-${index}` }, { env: WORKER_ENV }).scheduled, true);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, KAI_P1_DISPATCH_MAX_CONCURRENT);
  assert.equal(dispatcher.stats().waiting, 8 - KAI_P1_DISPATCH_MAX_CONCURRENT);

  while (gates.length < 8 || gates.some((gate) => !gate.released)) {
    const next = gates.find((gate) => !gate.released);
    if (!next) {
      await new Promise((resolve) => setImmediate(resolve));
      continue;
    }
    next.released = true;
    next.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await dispatcher.whenIdle();

  assert.equal(peak, KAI_P1_DISPATCH_MAX_CONCURRENT);
  assert.deepEqual([...new Set(started)].sort(), [...Array(8).keys()].map((index) => `file-${index}`).sort());
  assert.equal(started.length, 8);
});

test("beyond maxWaiting, a dispatch is refused and left to the scheduled sweep instead of queueing without bound", async () => {
  const harness = manualDispatcher({ dispatcher: { maxWaiting: 2 } });
  const outcomes = [0, 1, 2, 3].map((index) =>
    harness.dispatcher.dispatch({ organizationId, intakeFileId: `file-${index}` }, { env: WORKER_ENV }));
  assert.deepEqual(outcomes.map((outcome) => outcome.reason), [null, null, "dispatcher_saturated", "dispatcher_saturated"]);
  assert.ok(harness.lines.includes("[kai-p1-dispatch] outcome=deferred_to_scheduled_sweep code=dispatcher_saturated"));
  harness.drain();
  await harness.dispatcher.whenIdle();
  assert.equal(harness.calls.length, 2);
  assert.equal(KAI_P1_DISPATCH_MAX_WAITING, 25);
});

test("a stopped downstream stage is classified from the inner results, logged once, and never retried or re-dispatched", async () => {
  const p104Failure = {
    ok: true,
    data: {
      organizationId,
      intakeFileId,
      result: { ok: true, data: { activated: false, run: { run: { parser_status: "completed", output_profile_id: "p-1" }, replayed: true } } },
      dataDictionary: { ok: false, data: null, error: { code: "validation_blocker" } },
      stoppedAt: "draft_data_dictionary",
    },
    error: null,
  };
  const harness = manualDispatcher({ result: () => p104Failure });
  harness.dispatcher.dispatch({ organizationId, intakeFileId }, { env: WORKER_ENV });
  harness.drain();
  await harness.dispatcher.whenIdle();
  await new Promise((resolve) => setTimeout(resolve, 20));
  harness.drain();

  assert.equal(harness.calls.length, 1, "exactly one attempt");
  assert.equal(harness.scheduled.length, 0, "nothing re-scheduled itself");
  assert.deepEqual(harness.lines, ["[kai-p1-dispatch] outcome=stopped stage=draft_data_dictionary code=validation_blocker"]);
  const stats = harness.dispatcher.stats();
  assert.equal(stats.scheduled, 1);
  assert.equal(stats.started, 1);
  assert.equal(stats.settled, 1);
});

test("an outer ok:true is not completion: classification reads stoppedAt and every inner stage", () => {
  assert.deepEqual(classifyKaiP1DispatchResult(completedResult()), { outcome: "completed_through_p1_05", stage: null, code: null });
  assert.deepEqual(
    classifyKaiP1DispatchResult({ ok: true, data: { stoppedAt: "parser_profile_activation", result: { ok: false, error: { code: "conflict_current_state_changed" } } } }),
    { outcome: "stopped", stage: "parser_profile_activation", code: "conflict_current_state_changed" },
  );
  assert.deepEqual(
    classifyKaiP1DispatchResult({ ok: true, data: { stoppedAt: "parser_profile_activation", result: { ok: true, data: { activated: false, reason: "not_eligible_for_p1" } } } }),
    { outcome: "stopped", stage: "parser_profile_activation", code: "not_eligible_for_p1" },
  );
  assert.deepEqual(
    classifyKaiP1DispatchResult({ ok: true, data: { stoppedAt: "parser_profile_activation", result: { ok: true, data: { run: { run: { parser_status: "failed" } } } } } }),
    { outcome: "stopped", stage: "parser_profile_activation", code: "failed" },
  );
  assert.deepEqual(
    classifyKaiP1DispatchResult({ ok: true, data: { stoppedAt: "persist_intake_sensitivity_profile", sensitivityProfile: { ok: false, error: { code: "system_error" } } } }),
    { outcome: "stopped", stage: "persist_intake_sensitivity_profile", code: "system_error" },
  );
  assert.deepEqual(
    classifyKaiP1DispatchResult({ ok: true, data: { sensitivityProfile: { ok: false } } }),
    { outcome: "stopped", stage: "unclassified", code: "unclassified" },
    "missing stage information is never reported as completion",
  );
  assert.deepEqual(
    classifyKaiP1DispatchResult({ ok: false, error: { code: "feature_disabled" } }),
    { outcome: "rejected", stage: "process_kai_p1_intake_file", code: "feature_disabled" },
  );
  assert.equal(
    classifyKaiP1DispatchResult({ ok: false, error: { code: "Raw Message /Users/x with spaces" } }).code,
    "unclassified",
    "only safe tokens are ever logged",
  );
});

test("a throwing or rejecting P1 operation is contained: no unhandled rejection, the slot is released", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const lines = [];
    let calls = 0;
    const dispatcher = createKaiP1FileDispatcher({
      processFile: (input) => {
        calls += 1;
        if (input.intakeFileId === "throws") throw new Error("synthetic synchronous failure");
        return Promise.reject(new Error("synthetic rejection"));
      },
      log: (line) => lines.push(line),
      maxConcurrent: 1,
    });
    dispatcher.dispatch({ organizationId, intakeFileId: "throws" }, { env: WORKER_ENV });
    dispatcher.dispatch({ organizationId, intakeFileId: "rejects" }, { env: WORKER_ENV });
    await dispatcher.whenIdle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 2);
    assert.deepEqual(lines, [
      "[kai-p1-dispatch] outcome=error stage=process_kai_p1_intake_file",
      "[kai-p1-dispatch] outcome=error stage=process_kai_p1_intake_file",
    ]);
    assert.equal(dispatcher.stats().running, 0);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("only trusted runtime composition is forwarded to P1; request-scoped confirmation overrides never are", async () => {
  const harness = manualDispatcher();
  const storageAdapter = { readObjectVersion() {} };
  harness.dispatcher.dispatch(
    { organizationId, intakeFileId, expectedFileFacts: EXPECTED_FILE_FACTS },
    {
      env: WORKER_ENV,
      storageAdapter,
      now: () => "2026-01-01T00:00:00.000Z",
      runInTransaction: () => {},
      casSecurityAssessmentFilePolicyDecision: () => {},
      insertRequiredSuccessfulAuditEvent: () => {},
      runProductionSecurityAssessment: () => {},
      kaiP1FileDispatcher: {},
    },
  );
  harness.drain();
  await harness.dispatcher.whenIdle();
  assert.deepEqual(Object.keys(harness.calls[0].dependencies).sort(), ["env", "storageAdapter"]);
  assert.equal(harness.calls[0].dependencies.storageAdapter, storageAdapter);
  assert.deepEqual(dispatchTestables.FORWARDED_DEPENDENCY_KEYS, [
    "env",
    "storageAdapter",
    "gcsProvider",
    "gcsParserReaderProvider",
    "uploadLifecycleRepository",
  ]);
});

test("the production dispatcher is one process-wide instance bound to the real file-scoped operation", () => {
  assert.equal(getKaiP1FileDispatcher(), getKaiP1FileDispatcher());
  const source = readFileSync("Backend/kai/parsing/p1FileDispatch.js", "utf8");
  assert.match(source, /processFile = processKaiP1IntakeFile/);
});

test("P1-06 and later stay unreachable: the dispatcher imports only the gate config and the file-scoped P1 operation, never the sweep", () => {
  const source = readFileSync("Backend/kai/parsing/p1FileDispatch.js", "utf8");
  const importLines = source.match(/^import .+$/gm) || [];
  assert.deepEqual(importLines, [
    'import { areKaiSprint2WorkerFeaturesEnabled } from "../config/kaiSprint2Config.js";',
    'import { processKaiP1IntakeFile } from "./p1WorkerRuntime.js";',
  ]);
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /runKaiP1WorkerTick|listActionableKaiP1WorkCandidates|registerKaiP1WorkerCron|retry:\s*true/);
  assert.doesNotMatch(code, /reviewQueue|review-?queue|createSensitivityReviewQueueItem|sourceCandidate|evidence|claim|generat|exportReview/i);

  const service = readFileSync("Backend/kai/services/kaiIntakeService.js", "utf8");
  assert.match(service, /import \{ getKaiP1FileDispatcher \} from "\.\.\/parsing\/p1FileDispatch\.js";/);
  assert.doesNotMatch(service, /runKaiP1WorkerTick|p1WorkerCron|processKaiP1IntakeFile/);
});

// --- Post-commit trigger in applyConfirmedSecurityAssessment ---

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
  const dispatches = [];
  const harness = {
    events,
    dispatches,
    factsRow: pendingFactsRow(),
    // PostgreSQL returns bigint verified_size_bytes as a string from RETURNING.
    updatedRow: { ...pendingFactsRow(), file_policy_status: "passed", verified_size_bytes: String(verifiedSizeBytes) },
    auditResult: { ok: true },
    assessmentResult: { ok: true, data: { assessmentResult: { policy: "pass" }, policyDecisionOutcome: "passed" } },
    ...overrides,
  };
  harness.dependencies = {
    env: WORKER_ENV,
    now: () => "2026-08-01T00:00:00.000Z",
    async runInTransaction(callback) {
      events.push("BEGIN");
      try {
        const result = await callback({ name: "tx" });
        events.push("COMMIT");
        return result;
      } catch (error) {
        events.push("ROLLBACK");
        throw error;
      }
    },
    async getScopedIntakeFileSecurityAssessmentFacts() {
      return harness.factsRow;
    },
    async runProductionSecurityAssessment() {
      return harness.assessmentResult;
    },
    async casSecurityAssessmentFilePolicyDecision() {
      events.push("CAS");
      if (harness.throwOnWrite) throw new Error("synthetic mutation failure");
      return harness.writeReturnsNull ? null : harness.updatedRow;
    },
    async insertRequiredSuccessfulAuditEvent() {
      events.push("AUDIT");
      if (harness.throwOnAudit) throw new Error("synthetic audit failure");
      return harness.auditResult;
    },
    kaiP1FileDispatcher: {
      dispatch(input, dependencies) {
        events.push("DISPATCH");
        dispatches.push({ input, dependencies });
        if (harness.dispatchThrows) throw new Error("synthetic dispatcher failure");
        return { scheduled: true, reason: null };
      },
    },
  };
  return harness;
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

test("a freshly committed passed decision dispatches exactly once, only after BEGIN/CAS/AUDIT/COMMIT, with the trusted committed identity", async () => {
  const harness = createHarness();
  await applyConfirmedSecurityAssessment(baseInput(), harness.dependencies);

  assert.deepEqual(harness.events, ["BEGIN", "CAS", "AUDIT", "COMMIT", "DISPATCH"]);
  assert.equal(harness.dispatches.length, 1);
  assert.deepEqual(harness.dispatches[0].input, {
    organizationId,
    intakeFileId,
    expectedFileFacts: { objectVersionId, verifiedChecksum, verifiedSizeBytes },
  });
  assert.equal(harness.dispatches[0].dependencies.env, WORKER_ENV);
});

test("blocked, failed, and non-decision (pending/diagnostic or unclassified) assessments never dispatch", async () => {
  for (const assessmentResult of [
    { ok: true, data: { assessmentResult: { policy: "block", category: "malware_failed" }, policyDecisionOutcome: "blocked" } },
    { ok: true, data: { assessmentResult: { status: "failed", category: "malware_scan_failed" }, policyDecisionOutcome: "failed" } },
    { ok: true, data: { assessmentResult: { status: "failed", category: "malware_scan_not_configured" }, policyDecisionOutcome: null } },
    { ok: true, data: { assessmentResult: { unexpected: true }, policyDecisionOutcome: undefined } },
    { ok: false, error: { code: "internal_security_executor_failed" } },
  ]) {
    const harness = createHarness({
      assessmentResult,
      updatedRow: { ...pendingFactsRow(), file_policy_status: assessmentResult.data?.policyDecisionOutcome || "pending" },
    });
    await applyConfirmedSecurityAssessment(baseInput(), harness.dependencies);
    assert.equal(harness.dispatches.length, 0, JSON.stringify(assessmentResult));
    assert.equal(harness.events.includes("DISPATCH"), false);
  }
});

test("a CAS conflict, a rolled-back audit, or a throwing mutation commits nothing and dispatches nothing", async () => {
  for (const overrides of [{ writeReturnsNull: true }, { throwOnAudit: true }, { auditResult: { ok: false } }, { throwOnWrite: true }]) {
    const harness = createHarness(overrides);
    await applyConfirmedSecurityAssessment(baseInput(), harness.dependencies);
    assert.equal(harness.events.includes("COMMIT"), false, JSON.stringify(overrides));
    assert.equal(harness.events.at(-1), "ROLLBACK", JSON.stringify(overrides));
    assert.equal(harness.dispatches.length, 0, JSON.stringify(overrides));
  }
});

test("a committed row that does not prove passed for the same file and verified identity dispatches nothing", async () => {
  for (const row of [
    { file_policy_status: "blocked" },
    { file_policy_status: "pending" },
    { organization_id: "b6e28d6b-d66f-54bf-ac32-0f74bbf844f0" },
    { intake_file_id: "7d5482be-ad6b-4ed5-95cc-1a1bf4fcb749" },
    { object_version_id: "ov_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    { verified_checksum: "c".repeat(64) },
    { verified_size_bytes: "43" },
  ]) {
    const harness = createHarness({ updatedRow: { ...pendingFactsRow(), file_policy_status: "passed", ...row } });
    await applyConfirmedSecurityAssessment(baseInput(), harness.dependencies);
    assert.equal(harness.events.includes("COMMIT"), true);
    assert.equal(harness.dispatches.length, 0, JSON.stringify(row));
  }
});

test("a confirmation replay of an already-passed (or otherwise terminal) file dispatches nothing", async () => {
  for (const status of ["passed", "blocked", "failed"]) {
    const harness = createHarness({ factsRow: pendingFactsRow({ file_policy_status: status }) });
    await applyConfirmedSecurityAssessment(baseInput(), harness.dependencies);
    assert.deepEqual(harness.events, [], status);
    assert.equal(harness.dispatches.length, 0, status);
  }
});

test("changed immutable facts fail closed before assessment and dispatch nothing", async () => {
  const harness = createHarness({ factsRow: pendingFactsRow({ verified_checksum: "c".repeat(64) }) });
  await applyConfirmedSecurityAssessment(baseInput(), harness.dependencies);
  assert.deepEqual(harness.events, []);
  assert.equal(harness.dispatches.length, 0);
});

test("a throwing dispatcher can never undo or mask the committed decision", async () => {
  const harness = createHarness({ dispatchThrows: true });
  await assert.doesNotReject(applyConfirmedSecurityAssessment(baseInput(), harness.dependencies));
  assert.deepEqual(harness.events, ["BEGIN", "CAS", "AUDIT", "COMMIT", "DISPATCH"]);
});

test("with no injected dispatcher, the passed path reaches the real process-wide dispatcher (gated off here, so it schedules nothing)", async () => {
  const before = getKaiP1FileDispatcher().stats();
  const harness = createHarness();
  delete harness.dependencies.kaiP1FileDispatcher;
  harness.dependencies.env = { KAI_SPRINT2_ENABLED: "true", KAI_FILE_UPLOAD_ENABLED: "true", KAI_WORKER_ENABLED: "false" };
  await applyConfirmedSecurityAssessment(baseInput(), harness.dependencies);
  const after = getKaiP1FileDispatcher().stats();
  assert.equal(after.disabled, before.disabled + 1);
  assert.equal(after.scheduled, before.scheduled);
});

// --- confirmUpload stays non-blocking ---

test("confirmUpload returns its unchanged DTO while the dispatched P1 operation is still deliberately unresolved", async () => {
  const bytes = Buffer.from("hello");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const now = "2026-08-01T00:00:00.000Z";
  const neverSettles = deferred();
  const processCalls = [];
  const dispatcher = createKaiP1FileDispatcher({
    processFile: (input) => {
      processCalls.push(input);
      return neverSettles.promise;
    },
    log: () => {},
  });
  const harness = createHarness({
    factsRow: pendingFactsRow({ verified_checksum: checksum, verified_size_bytes: bytes.byteLength }),
    updatedRow: { ...pendingFactsRow({ verified_checksum: checksum, verified_size_bytes: String(bytes.byteLength) }), file_policy_status: "passed" },
  });
  harness.dependencies.kaiP1FileDispatcher = dispatcher;

  const result = await confirmUpload(
    {
      organizationId,
      intakeFileId,
      now,
      actorContext: {
        actorType: "human",
        actorUserId: "7fe568b1-5c05-4c42-bb1f-6e20de216c7b",
        kaiRoles: ["gk_operator"],
        organizationMemberships: [{ organization_id: organizationId, role_name: "gk_operator", membership_status: "active" }],
      },
    },
    {
      ...harness.dependencies,
      uploadLifecycleRepository: {
        async getUploadLifecycle() {
          return { ok: true, data: { record: { organization_id: organizationId, intake_file_id: intakeFileId, upload_state: "uploaded_unconfirmed", object_version_id: objectVersionId } } };
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
      },
      storageAdapter: {
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
      },
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
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    Object.keys(result.data).sort(),
    ["intake_batch_id", "intake_file_id", "object_version_id", "organization_id", "replayed", "upload_state", "verified_size_bytes"].sort(),
  );
  assert.equal(result.data.upload_state, "confirmed");
  assert.deepEqual(harness.events, ["BEGIN", "CAS", "AUDIT", "COMMIT"]);
  assert.equal(dispatcher.stats().scheduled, 1);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(processCalls.length, 1, "P1 began after the response was produced");
  assert.deepEqual(processCalls[0].expectedFileFacts, { objectVersionId, verifiedChecksum: checksum, verifiedSizeBytes: bytes.byteLength });
  assert.equal(dispatcher.stats().running, 1, "and is still unresolved");
  neverSettles.resolve(completedResult());
  await dispatcher.whenIdle();
});
