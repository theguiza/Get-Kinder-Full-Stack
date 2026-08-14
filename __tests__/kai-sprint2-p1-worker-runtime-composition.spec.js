import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
  runKaiP1WorkerTick,
} from "../Backend/kai/parsing/p1WorkerRuntime.js";
import { registerKaiP1WorkerCron } from "../Backend/kai/parsing/p1WorkerCron.js";
import { sendStatus } from "../Backend/kai/routes/sprint2IntakeApi.js";

const IN_SCOPE_ORG = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const OUT_OF_SCOPE_ORG = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
const ENABLED_ENV = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_WORKER_ENABLED: "true",
  KAI_P1_WORKER_SYNTHETIC_ORGANIZATION_ID: IN_SCOPE_ORG,
});

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function fakeActivation(calls) {
  return async (input) => {
    calls.push(input);
    return { ok: true, data: { activated: true, run: { parser_run_id: `run-${calls.length}` } }, error: null };
  };
}

test("either feature flag disabled => zero worker work", async () => {
  const activationCalls = [];
  const listCalls = [];
  const listFiles = async (input) => {
    listCalls.push(input);
    return [{ organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" }];
  };

  const sprint2Off = await runKaiP1WorkerTick({
    env: { ...ENABLED_ENV, KAI_SPRINT2_ENABLED: "false" },
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: listFiles,
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });
  assert.equal(sprint2Off.ok, true);
  assert.deepEqual(sprint2Off.data.activated, []);
  assert.equal(sprint2Off.data.reason, "worker_disabled");

  const workerOff = await runKaiP1WorkerTick({
    env: { ...ENABLED_ENV, KAI_WORKER_ENABLED: "false" },
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: listFiles,
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });
  assert.equal(workerOff.ok, true);
  assert.deepEqual(workerOff.data.activated, []);
  assert.equal(workerOff.data.reason, "worker_disabled");

  assert.equal(listCalls.length, 0);
  assert.equal(activationCalls.length, 0);
});

test("missing synthetic scope => zero worker work", async () => {
  const activationCalls = [];
  const listCalls = [];
  const result = await runKaiP1WorkerTick({
    env: { KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "true" },
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async (input) => {
      listCalls.push(input);
      return [];
    },
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.activated, []);
  assert.equal(result.data.reason, "synthetic_scope_not_configured");
  assert.equal(listCalls.length, 0);
  assert.equal(activationCalls.length, 0);
});

test("out-of-scope tenant rows are never activated, even if a dependency returns one", async () => {
  const activationCalls = [];
  const result = await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async () => [
      { organization_id: OUT_OF_SCOPE_ORG, intake_file_id: "out-of-scope-file" },
    ],
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.activated, []);
  assert.equal(activationCalls.length, 0);
});

test("an eligible in-scope file reaches the existing activation seam with the synthetic system actor and no retry", async () => {
  const activationCalls = [];
  const result = await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async (input) => {
      assert.deepEqual(input, { organizationId: IN_SCOPE_ORG });
      return [{ organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" }];
    },
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.organizationId, IN_SCOPE_ORG);
  assert.equal(result.data.activated.length, 1);
  assert.equal(result.data.activated[0].intakeFileId, "file-1");

  assert.equal(activationCalls.length, 1);
  assert.equal(activationCalls[0].organizationId, IN_SCOPE_ORG);
  assert.equal(activationCalls[0].intakeFileId, "file-1");
  assert.equal(activationCalls[0].retry, false);
  assert.deepEqual(activationCalls[0].actorContext, KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT);
});

test("repeated/overlapping ticks preserve existing idempotency: the activation seam, not the tick, owns dedupe", async () => {
  const activationCalls = [];
  const listFiles = async () => [{ organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" }];
  const dependencies = {
    env: ENABLED_ENV,
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: listFiles,
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  };

  const [first, second] = await Promise.all([
    runKaiP1WorkerTick(dependencies),
    runKaiP1WorkerTick(dependencies),
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  // Each tick calls the activation seam once per discovered eligible file; the
  // seam itself (parserRunRepository.claimQueuedParserRun / ensureQueuedParserRun)
  // is exercised for idempotency separately in kai-sprint2-p1-activation.spec.js
  // and kai-sprint2-p1-03-parser-profile-worker*.spec.js - unchanged by this
  // package. This tick never bypasses that seam or claims work itself.
  assert.equal(activationCalls.length, 2);
  assert.equal(activationCalls[0].retry, false);
  assert.equal(activationCalls[1].retry, false);
});

test("no automatic retry: the tick never sets retry: true", async () => {
  const activationCalls = [];
  await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async () => [
      { organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" },
      { organization_id: IN_SCOPE_ORG, intake_file_id: "file-2" },
    ],
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(activationCalls.length, 2);
  for (const call of activationCalls) {
    assert.equal(call.retry, false);
  }
});

test("no P2/P3 activation: the runtime module imports only the P1 activation seam", () => {
  const source = readFileSync("Backend/kai/parsing/p1WorkerRuntime.js", "utf8");
  const importLines = source.match(/^import .+$/gm) || [];
  assert.ok(importLines.length > 0);
  for (const line of importLines) {
    assert.doesNotMatch(
      line,
      /evidence|claim|generat|review-?cockpit|sourcePromotion|dataDictionary|exportReview|exportCandidate|humanAuthority/i,
    );
  }
  assert.match(source, /activateParserProfileWorkForIntakeFile/);
});

test("cron registration is dormant unless both feature flags are enabled, and reuses the existing node-cron model", () => {
  const scheduleCalls = [];
  const fakeCronLib = {
    schedule(schedule, handler, opts) {
      scheduleCalls.push({ schedule, handler, opts });
      return { fake: true };
    },
  };

  const disabled = registerKaiP1WorkerCron({
    env: { KAI_SPRINT2_ENABLED: "true", KAI_WORKER_ENABLED: "false" },
    cronLib: fakeCronLib,
  });
  assert.equal(disabled.scheduled, false);
  assert.equal(scheduleCalls.length, 0);

  const enabled = registerKaiP1WorkerCron({
    env: ENABLED_ENV,
    cronLib: fakeCronLib,
  });
  assert.equal(enabled.scheduled, true);
  assert.equal(scheduleCalls.length, 1);
  assert.equal(typeof scheduleCalls[0].schedule, "string");
  assert.equal(typeof scheduleCalls[0].handler, "function");
});

test("cron tick handler delegates to runKaiP1WorkerTick and never throws out of the scheduled callback", async () => {
  const scheduleCalls = [];
  const fakeCronLib = {
    schedule(schedule, handler, opts) {
      scheduleCalls.push({ schedule, handler, opts });
      return { fake: true };
    },
  };
  let tickCalls = 0;
  registerKaiP1WorkerCron({
    env: ENABLED_ENV,
    cronLib: fakeCronLib,
    runTick: async () => {
      tickCalls += 1;
      throw new Error("boom");
    },
  });

  await assert.doesNotReject(scheduleCalls[0].handler());
  assert.equal(tickCalls, 1);
});

test("status reports the worker state correctly: both flags required, neither alone is sufficient", () => {
  const bothEnabled = createResponse();
  sendStatus({ kaiSprint2StatusEnv: ENABLED_ENV }, bothEnabled);
  assert.equal(bothEnabled.body.data.parser_worker_enabled, true);
  assert.equal(bothEnabled.body.data.profiling_enabled, true);

  const onlySprint2 = createResponse();
  sendStatus({ kaiSprint2StatusEnv: { KAI_SPRINT2_ENABLED: "true" } }, onlySprint2);
  assert.equal(onlySprint2.body.data.parser_worker_enabled, false);
  assert.equal(onlySprint2.body.data.profiling_enabled, false);

  const onlyWorker = createResponse();
  sendStatus({ kaiSprint2StatusEnv: { KAI_WORKER_ENABLED: "true" } }, onlyWorker);
  assert.equal(onlyWorker.body.data.parser_worker_enabled, false);
  assert.equal(onlyWorker.body.data.profiling_enabled, false);

  const neither = createResponse();
  sendStatus({ kaiSprint2StatusEnv: {} }, neither);
  assert.equal(neither.body.data.parser_worker_enabled, false);
  assert.equal(neither.body.data.profiling_enabled, false);
});
