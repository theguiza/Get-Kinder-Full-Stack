import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  createCrossSourceReconciliationDispatcher,
  processCrossSourceReconciliationJob,
  reconciliationFailureCode,
  runCrossSourceReconciliationTick,
} from "../Backend/kai/parsing/crossSourceReconciliationJobRuntime.js";
import { reconciliationRequestFingerprint } from "../Backend/kai/parsing/postgresCrossSourceReconciliationJobRepository.js";
import { publicReconciliationJob } from "../Backend/kai/parsing/crossSourceReconciliationJobContract.js";
import { requestCrossSourceReachMeasurements } from "../Backend/kai/services/kaiSourceMeasurementService.js";

/**
 * Queued cross-source reconciliation, pure: the request path admits and
 * queues without any byte read, and one worker attempt is claimed, committed
 * under its fencing token, or recorded as a retryable or final failure. The
 * PostgreSQL lifecycle (claims, leases, retries, supersession during
 * processing) runs on the Cedar Bridge acceptance's disposable cluster.
 */

const ENV = Object.freeze({ KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "true" });
const ORG = "0c000000-0000-4000-8000-0000000000c1";
const JOB = "9a000000-0000-4000-8000-000000000001";
const PRIMARY = "5a000000-0000-4000-8000-000000000001";
const REFERENCE = "5a000000-0000-4000-8000-000000000002";
const PERIOD = Object.freeze({ period_source: "engagement_reporting_period", period_start: "2025-04-01", period_end: "2026-03-31", precision: "day" });
const MAPPING = Object.freeze({
  events: { event_identifier_field_key: "field_1", participant_identifier_field_key: "field_2", status_field_key: "field_6", completed_value_key: "value_1", date_field_key: "field_4" },
  register: { participant_identifier_field_key: "field_1" },
});

function claimedJob(overrides = {}) {
  return {
    reconciliation_job_id: JOB, organization_id: ORG, primary_source_version_id: PRIMARY, reference_source_version_id: REFERENCE,
    primary_profile_canonical_sha256: "a".repeat(64), reference_profile_canonical_sha256: "b".repeat(64), mapping: { ...MAPPING, period: PERIOD },
    job_state: "in_progress", attempt_count: 1, claim_token: "token-1", requested_by: "u1", ...overrides,
  };
}

function fakeJobs({ decision = "claimed", job = claimedJob(), fenceHeld = true } = {}) {
  const calls = [];
  return {
    calls,
    async claim(input) { calls.push(["claim", input]); return { decision, job }; },
    async fenceInTransaction(tx, input) { calls.push(["fence", input]); return fenceHeld ? job : null; },
    async completeSucceededInTransaction(tx, input) { calls.push(["succeeded", input]); return { ...job, job_state: "succeeded" }; },
    async completeFailed(input) {
      calls.push(["failed", input]);
      const state = input.retryable ? (job.attempt_count < 3 ? "retry_scheduled" : "exhausted") : "failed";
      return { acknowledged: true, job: { ...job, job_state: state, last_error_code: input.errorCode } };
    },
    async read() { return { ...job, job_state: "succeeded", measurement_ids: ["m1"] }; },
    async listDue() { return [{ organization_id: ORG, reconciliation_job_id: JOB }]; },
  };
}

// A measurement repository that runs the fence the way the real one does.
function fakeMeasurements(outcome, { profiles = { primary: "a".repeat(64), reference: "b".repeat(64), period: PERIOD } } = {}) {
  const calls = [];
  return {
    calls,
    async recordCrossSourceReachMeasurements(input) {
      calls.push(input);
      const fenced = await input.fence.before({});
      if (fenced) return fenced;
      if (!input.fence.profilesMatch(profiles)) return { ok: false, error: { code: "conflict_current_state_changed", blockers: [{ blocking_reason: "cross_source_source_changed" }] } };
      if (typeof outcome === "function") return outcome();
      if (outcome.ok) await input.fence.after({}, ["m1"]);
      return outcome;
    },
  };
}

const refusal = (code, reason) => ({ ok: false, error: { code, blockers: [{ blocking_reason: reason }] } });

test("one attempt commits the measurements and the job's completion together under the claim", async () => {
  const jobs = fakeJobs();
  const measurements = fakeMeasurements({ ok: true, data: {} });
  const result = await processCrossSourceReconciliationJob({ organizationId: ORG, reconciliationJobId: JOB }, { env: ENV, reconciliationJobRepository: jobs, derivedMeasurementRepository: measurements, now: () => "2026-11-03T10:00:00.000Z" });
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(jobs.calls.map(([name]) => name), ["claim", "fence", "succeeded"]);
  assert.deepEqual(jobs.calls[2][1].measurementIds, ["m1"]);
  // The worker passes the job's own mapping (without the period) and the requester as actor; never a byte, path or fact.
  assert.deepEqual(measurements.calls[0].mapping, MAPPING);
  assert.deepEqual(Object.keys(measurements.calls[0]).sort(), ["actorUserId", "fence", "mapping", "now", "organizationId", "primarySourceVersionId", "referenceSourceVersionId"]);
});

test("failures: infrastructure is retried within the budget; a refusal about the sources, the bytes' identity or a changed source fails at once", async () => {
  const cases = [
    [{ ok: false, error: { code: "system_error" } }, "system_error", true, "retry_scheduled"],
    [refusal("conflict_current_state_changed", "cross_source_bytes_unavailable"), "cross_source_bytes_unavailable", true, "retry_scheduled"],
    [refusal("conflict_current_state_changed", "cross_source_checksum_mismatch"), "cross_source_checksum_mismatch", false, "failed"],
    [refusal("validation_blocker", "allowed_use_not_allowed"), "allowed_use_not_allowed", false, "failed"],
    [{ ok: false, error: { code: "conflict_current_state_changed" } }, "conflict_current_state_changed", false, "failed"],
    [() => { throw new Error("connect ECONNREFUSED 10.0.0.1 secret"); }, "system_error", true, "retry_scheduled"],
  ];
  for (const [outcome, code, retryable, state] of cases) {
    const jobs = fakeJobs();
    const result = await processCrossSourceReconciliationJob({ organizationId: ORG, reconciliationJobId: JOB },
      { env: ENV, reconciliationJobRepository: jobs, derivedMeasurementRepository: fakeMeasurements(outcome), now: () => "2026-11-03T10:00:00.000Z" });
    const failed = jobs.calls.find(([name]) => name === "failed")[1];
    assert.deepEqual([failed.errorCode, failed.retryable, result.outcome], [code, retryable, state], code);
    assert.doesNotMatch(JSON.stringify(result), /ECONNREFUSED|secret|10\.0\.0\.1/);
  }
  // The third retryable failure exhausts the job.
  const third = fakeJobs({ job: claimedJob({ attempt_count: 3 }) });
  const exhausted = await processCrossSourceReconciliationJob({ organizationId: ORG, reconciliationJobId: JOB },
    { env: ENV, reconciliationJobRepository: third, derivedMeasurementRepository: fakeMeasurements({ ok: false, error: { code: "system_error" } }) });
  assert.equal(exhausted.outcome, "exhausted");
  // A source changed between request and attempt: never committed.
  const changed = fakeJobs();
  const moved = await processCrossSourceReconciliationJob({ organizationId: ORG, reconciliationJobId: JOB },
    { env: ENV, reconciliationJobRepository: changed, derivedMeasurementRepository: fakeMeasurements({ ok: true }, { profiles: { primary: "c".repeat(64), reference: "b".repeat(64), period: PERIOD } }) });
  assert.deepEqual([moved.outcome, moved.code], ["failed", "cross_source_source_changed"]);
  assert.ok(!changed.calls.some(([name]) => name === "succeeded"));
});

test("a claim lost to another worker commits nothing and records nothing; nothing is attempted without a claim or with the worker off", async () => {
  const lost = fakeJobs({ fenceHeld: false });
  const result = await processCrossSourceReconciliationJob({ organizationId: ORG, reconciliationJobId: JOB },
    { env: ENV, reconciliationJobRepository: lost, derivedMeasurementRepository: fakeMeasurements({ ok: true }) });
  assert.equal(result.outcome, "lost");
  assert.deepEqual(lost.calls.map(([name]) => name), ["claim", "fence"]);
  for (const decision of ["busy", "deferred", "settled", "exhausted", "not_found"]) {
    const jobs = fakeJobs({ decision });
    const measurements = fakeMeasurements({ ok: true });
    assert.equal((await processCrossSourceReconciliationJob({ organizationId: ORG, reconciliationJobId: JOB }, { env: ENV, reconciliationJobRepository: jobs, derivedMeasurementRepository: measurements })).outcome, decision);
    assert.equal(measurements.calls.length, 0);
  }
  const off = await processCrossSourceReconciliationJob({ organizationId: ORG, reconciliationJobId: JOB }, { env: { KAI_SPRINT2_ENABLED: "true" }, reconciliationJobRepository: fakeJobs() });
  assert.equal(off.outcome, "worker_disabled");
  assert.deepEqual((await runCrossSourceReconciliationTick({ env: {} })).data, { attempted: [], reason: "worker_disabled" });
  const tick = await runCrossSourceReconciliationTick({ env: ENV, reconciliationJobRepository: fakeJobs(), derivedMeasurementRepository: fakeMeasurements({ ok: true }) });
  assert.deepEqual(tick.data.attempted, [{ outcome: "succeeded", code: null }]);
});

test("the request identity: the same request in any key order is one job; another version, profile or period is another", () => {
  const base = { primarySourceVersionId: PRIMARY, referenceSourceVersionId: REFERENCE, primaryProfileCanonicalSha256: "a".repeat(64), referenceProfileCanonicalSha256: "b".repeat(64),
    mapping: { ...MAPPING, period: PERIOD } };
  const reordered = { ...base, mapping: { period: PERIOD, register: MAPPING.register, events: Object.fromEntries(Object.entries(MAPPING.events).reverse()) } };
  assert.equal(reconciliationRequestFingerprint(base), reconciliationRequestFingerprint(reordered));
  for (const changed of [
    { ...base, primarySourceVersionId: "5a000000-0000-4000-8000-000000000003" },
    { ...base, referenceProfileCanonicalSha256: "c".repeat(64) },
    { ...base, mapping: { ...base.mapping, period: { ...PERIOD, period_end: "2026-02-28" } } },
  ]) assert.notEqual(reconciliationRequestFingerprint(changed), reconciliationRequestFingerprint(base));
  assert.deepEqual(Object.keys(publicReconciliationJob(claimedJob())).sort(),
    ["attempt_count", "completed_at", "created_at", "error_code", "job_state", "measurement_ids", "next_eligible_at", "primary_source_version_id", "reconciliation_job_id", "reference_source_version_id"]);
});

test("the HTTP request admits and queues in one transaction, hands the job to the dispatcher, and never reads a byte", async () => {
  const actorContext = { actorType: "human", actorUserId: "9e000000-0000-4000-8000-000000000001", kaiRoles: [],
    organizationMemberships: [{ organization_id: ORG, membership_status: "active", role_name: "client_admin" }] };
  const enqueued = [];
  const dispatched = [];
  const repository = {
    async requestCrossSourceReachMeasurements(input) {
      assert.equal(typeof input.enqueue, "function");
      return { ok: true, data: await input.enqueue("tx", { primaryProfileCanonicalSha256: "a".repeat(64), referenceProfileCanonicalSha256: "b".repeat(64), period: PERIOD }) };
    },
    async recordCrossSourceReachMeasurements() { throw new Error("the request path must not reconcile"); },
  };
  const jobs = { async enqueueInTransaction(tx, input) { enqueued.push([tx, input]); return { job: { ...claimedJob({ job_state: "queued", claim_token: null, attempt_count: 0 }) }, fresh: true, requeued: false }; } };
  const result = await requestCrossSourceReachMeasurements(
    { organizationId: ORG, primarySourceVersionId: PRIMARY, referenceSourceVersionId: REFERENCE, mapping: MAPPING, actorContext, now: "2026-11-03T10:00:00.000Z" },
    { env: ENV, derivedMeasurementRepository: repository, reconciliationJobRepository: jobs, reconciliationDispatcher: { dispatch: (...args) => dispatched.push(args) } },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.reconciliationJob.job_state, "queued");
  assert.doesNotMatch(JSON.stringify(result), /token|requested_by/);
  assert.equal(enqueued[0][0], "tx", "the job is recorded in the admission transaction");
  assert.deepEqual(enqueued[0][1].mapping.period, PERIOD);
  assert.deepEqual(dispatched[0][0], { organizationId: ORG, reconciliationJobId: JOB });
  // A person outside the organization is refused before anything is read or queued.
  const outsider = await requestCrossSourceReachMeasurements(
    { organizationId: ORG, primarySourceVersionId: PRIMARY, referenceSourceVersionId: REFERENCE, mapping: MAPPING, actorContext: { ...actorContext, organizationMemberships: [] }, now: "2026-11-03T10:00:00.000Z" },
    { env: ENV, derivedMeasurementRepository: repository, reconciliationJobRepository: jobs, reconciliationDispatcher: { dispatch: (...args) => dispatched.push(args) } },
  );
  assert.equal(outsider.ok, false);
  assert.equal(enqueued.length, 1);
  // The request path's modules never touch bytes.
  for (const path of ["Backend/kai/services/kaiSourceMeasurementService.js", "Backend/kai/parsing/postgresCrossSourceReconciliationJobRepository.js", "Backend/kai/routes/sprint2IntakeApi.js"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    for (const forbidden of ["createCrossSourceReconciliationWorker(", "readTrustedCsvRecords", "createP1ObjectVersionByteSource"]) assert.ok(!source.includes(forbidden), `${path}: ${forbidden}`);
  }
});

test("the dispatcher runs jobs after the request, one at a time, coalesced and bounded, and only with the worker enabled", async () => {
  const scheduled = [];
  const ran = [];
  let release;
  const dispatcher = createCrossSourceReconciliationDispatcher({
    processJob: (input) => { ran.push(input.reconciliationJobId); return new Promise((resolve) => { release = () => resolve({ outcome: "succeeded" }); }); },
    schedule: (callback) => scheduled.push(callback),
    maxWaiting: 2,
    log: () => {},
  });
  assert.equal(dispatcher.dispatch({ organizationId: ORG, reconciliationJobId: "j1" }, { env: {} }).reason, "worker_disabled");
  assert.deepEqual(dispatcher.dispatch({ organizationId: ORG, reconciliationJobId: "j1" }, { env: ENV }), { scheduled: true, reason: null });
  assert.equal(dispatcher.dispatch({ organizationId: ORG, reconciliationJobId: "j1" }, { env: ENV }).reason, "already_dispatched");
  assert.equal(ran.length, 0, "nothing runs inside the request");
  dispatcher.dispatch({ organizationId: ORG, reconciliationJobId: "j2" }, { env: ENV });
  assert.equal(dispatcher.dispatch({ organizationId: ORG, reconciliationJobId: "j3" }, { env: ENV }).reason, "dispatcher_saturated");
  scheduled.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ran, ["j1"], "one at a time");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ran, ["j1", "j2"]);
  release();
  await dispatcher.whenIdle();
  assert.equal(reconciliationFailureCode({ error: { code: "validation_blocker", blockers: [{ blocking_reason: "Not Safe!" }] } }), "validation_blocker");
});
