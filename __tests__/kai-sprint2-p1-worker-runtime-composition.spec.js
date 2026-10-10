import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
  classifyKaiP1DownstreamStageFailure,
  processKaiP1IntakeFile,
  runKaiP1WorkerTick,
} from "../Backend/kai/parsing/p1WorkerRuntime.js";
import { registerKaiP1WorkerCron } from "../Backend/kai/parsing/p1WorkerCron.js";
import { sendStatus } from "../Backend/kai/routes/sprint2IntakeApi.js";

const ORG_A = "a5d17c5a-c55f-43af-9b21-fe63aafe733f";
const ORG_B = "9fe568b1-5c05-4c42-bb1f-6e20de216c7b";
// Retained only as the smallest-possible regression proof that this
// configuration key is no longer required for normal worker execution -
// TEST 1 in the P1 single-organization-dependency repair package. It is
// deliberately absent from `ENABLED_ENV`.
const ENABLED_ENV = Object.freeze({
  KAI_SPRINT2_ENABLED: "true",
  KAI_WORKER_ENABLED: "true",
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

/**
 * In-memory stand-in for the PostgreSQL downstream recovery repository that
 * grants every claim and acknowledges every outcome, so these composition
 * tests keep exercising stage ordering and identity; the durable budget,
 * cooldown, and fencing behaviour is proven against real PostgreSQL in
 * kai-sprint2-p1-worker-file-processing.integration.spec.js.
 */
function grantingRecoveryRepository(calls = []) {
  let next = 1;
  return {
    calls,
    async claimDownstreamAttempt(input) {
      calls.push({ kind: "claim", stage: input.identity.stage, fileProfileId: input.identity.fileProfileId });
      return {
        ok: true,
        data: { decision: "claimed", claimToken: `00000000-0000-4000-8000-${String(next++).padStart(12, "0")}`, attemptNumber: 1 },
        error: null,
      };
    },
    async completeDownstreamAttempt(input) {
      calls.push({ kind: "complete", stage: input.identity.stage, outcome: input.outcome, errorCode: input.errorCode });
      const recoveryState = input.outcome === "succeeded"
        ? "succeeded"
        : input.outcome === "retryable_failure" ? "retry_scheduled" : "operator_attention";
      return { ok: true, data: { acknowledged: true, recoveryState, attemptNumber: 1 }, error: null };
    },
  };
}

const OUTPUT_PROFILE_ID = "b2f6b6f0-1111-4a2a-9c3d-000000000001";
const DATA_DICTIONARY_ID = "b2f6b6f0-2222-4a2a-9c3d-000000000002";

function fakeCompletedActivation(calls) {
  return async (input) => {
    calls.push(input);
    return {
      ok: true,
      data: {
        activated: true,
        run: { run: { output_profile_id: OUTPUT_PROFILE_ID, parser_status: "completed" }, replayed: false },
      },
      error: null,
    };
  };
}

/**
 * A completed run's authoritative continuation must never depend on
 * `activated: true` - an idempotent replay of an already-completed P1-03 run
 * reports `activated: false` (nothing new happened this tick) even though the
 * completed run and its `output_profile_id` are just as authoritative.
 */
function fakeReplayedCompletedActivation(calls) {
  return async (input) => {
    calls.push(input);
    return {
      ok: true,
      data: {
        activated: false,
        queued: { replayed: true },
        run: { run: { output_profile_id: OUTPUT_PROFILE_ID, parser_status: "completed" }, replayed: true },
      },
      error: null,
    };
  };
}

test("TEST 1/2/3: either Sprint 2 or worker feature flag disabled => zero candidate discovery and zero activation, with no synthetic-organization variable set anywhere in the environment", async () => {
  const activationCalls = [];
  const listCalls = [];
  const listCandidates = async () => {
    listCalls.push(true);
    return [{ organization_id: ORG_A, intake_file_id: "file-1" }];
  };

  const sprint2Off = await runKaiP1WorkerTick({
    env: { ...ENABLED_ENV, KAI_SPRINT2_ENABLED: "false" },
    listActionableKaiP1WorkCandidates: listCandidates,
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });
  assert.equal(sprint2Off.ok, true);
  assert.deepEqual(sprint2Off.data.activated, []);
  assert.equal(sprint2Off.data.reason, "worker_disabled");

  const workerOff = await runKaiP1WorkerTick({
    env: { ...ENABLED_ENV, KAI_WORKER_ENABLED: "false" },
    listActionableKaiP1WorkCandidates: listCandidates,
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });
  assert.equal(workerOff.ok, true);
  assert.deepEqual(workerOff.data.activated, []);
  assert.equal(workerOff.data.reason, "worker_disabled");

  assert.equal(listCalls.length, 0);
  assert.equal(activationCalls.length, 0);
  assert.equal("KAI_P1_WORKER_SYNTHETIC_ORGANIZATION_ID" in ENABLED_ENV, false);
});

test("TEST 10: no actionable automatic P1 work => safe no-op, zero activation", async () => {
  const activationCalls = [];
  const result = await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [],
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.activated, []);
  assert.equal(activationCalls.length, 0);
});

test("a malformed candidate row missing either half of its tenant identity is never activated, even if a dependency returns one", async () => {
  const activationCalls = [];
  const result = await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_A, intake_file_id: "" },
      { organization_id: "", intake_file_id: "file-1" },
      { intake_file_id: "file-1" },
      { organization_id: ORG_A },
    ],
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.activated, []);
  assert.equal(activationCalls.length, 0);
});

test("TEST 4/5/6: multi-organization discovery - candidates in two different organizations are each discovered and activated with their own organization_id, without any environment change", async () => {
  const activationCalls = [];
  const result = await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_A, intake_file_id: "file-a" },
      { organization_id: ORG_B, intake_file_id: "file-b" },
    ],
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.activated.length, 2);
  assert.equal(result.data.activated[0].organizationId, ORG_A);
  assert.equal(result.data.activated[0].intakeFileId, "file-a");
  assert.equal(result.data.activated[1].organizationId, ORG_B);
  assert.equal(result.data.activated[1].intakeFileId, "file-b");

  assert.equal(activationCalls.length, 2);
  assert.equal(activationCalls[0].organizationId, ORG_A);
  assert.equal(activationCalls[0].intakeFileId, "file-a");
  assert.equal(activationCalls[1].organizationId, ORG_B);
  assert.equal(activationCalls[1].intakeFileId, "file-b");
  for (const call of activationCalls) {
    assert.equal(call.retry, false);
    assert.deepEqual(call.actorContext, KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT);
  }
});

test("an eligible candidate reaches the existing activation seam with the synthetic system actor and no retry", async () => {
  const activationCalls = [];
  const result = await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [{ organization_id: ORG_A, intake_file_id: "file-1" }],
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.activated.length, 1);
  assert.equal(result.data.activated[0].organizationId, ORG_A);
  assert.equal(result.data.activated[0].intakeFileId, "file-1");

  assert.equal(activationCalls.length, 1);
  assert.equal(activationCalls[0].organizationId, ORG_A);
  assert.equal(activationCalls[0].intakeFileId, "file-1");
  assert.equal(activationCalls[0].retry, false);
  assert.deepEqual(activationCalls[0].actorContext, KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT);
});

test("repeated/overlapping ticks preserve existing idempotency: the activation seam, not the tick, owns dedupe", async () => {
  const activationCalls = [];
  const listFiles = async () => [{ organization_id: ORG_A, intake_file_id: "file-1" }];
  const dependencies = {
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: listFiles,
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
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_A, intake_file_id: "file-1" },
      { organization_id: ORG_A, intake_file_id: "file-2" },
    ],
    activateParserProfileWorkForIntakeFile: fakeActivation(activationCalls),
  });

  assert.equal(activationCalls.length, 2);
  for (const call of activationCalls) {
    assert.equal(call.retry, false);
  }
});

test("no P1-06+ activation: the runtime module imports only the P1-03/P1-04/P1-05 seams", () => {
  const source = readFileSync("Backend/kai/parsing/p1WorkerRuntime.js", "utf8");
  const importLines = source.match(/^import .+$/gm) || [];
  assert.ok(importLines.length > 0);
  for (const line of importLines) {
    assert.doesNotMatch(
      line,
      /evidence|claim|generat|review-?cockpit|reviewQueue|sourceCandidate|sourcePromotion|exportReview|exportCandidate|humanAuthority/i,
    );
  }
  assert.match(source, /activateParserProfileWorkForIntakeFile/);
  assert.match(source, /createDraftDataDictionary/);
  assert.match(source, /persistIntakeSensitivityProfile/);
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

test("A. fresh success: a fresh P1-03 completion continues through P1-04 then P1-05 in order, then stops", async () => {
  const activationCalls = [];
  const dictionaryCalls = [];
  const sensitivityCalls = [];
  const reviewQueueCalls = [];

  const result = await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_A, intake_file_id: "file-1" },
    ],
    activateParserProfileWorkForIntakeFile: fakeCompletedActivation(activationCalls),
    createDraftDataDictionary: async (input) => {
      dictionaryCalls.push(input);
      return { ok: true, data: { dictionary: { data_dictionary_id: DATA_DICTIONARY_ID } }, error: null };
    },
    persistIntakeSensitivityProfile: async (input) => {
      sensitivityCalls.push(input);
      return { ok: true, data: { sensitivityProfile: { intake_sensitivity_profile_id: "sp-1" } }, error: null };
    },
    createProductionMetadataOnlyAudit: () => ({ prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) }),
    p1DownstreamRecoveryRepository: grantingRecoveryRepository(),
    // No P1-06 dependency is ever wired in by the runtime, so a caller cannot
    // even supply a reachable one to spy on - `createSensitivityReviewQueueItem`
    // has no dependency key on this seam at all.
    createSensitivityReviewQueueItem: async (input) => {
      reviewQueueCalls.push(input);
      throw new Error("must never be reachable");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(activationCalls.length, 1);

  assert.equal(dictionaryCalls.length, 1);
  assert.deepEqual(dictionaryCalls[0].organizationId, ORG_A);
  assert.deepEqual(dictionaryCalls[0].fileProfileId, OUTPUT_PROFILE_ID);

  assert.equal(sensitivityCalls.length, 1);
  assert.equal(sensitivityCalls[0].organizationId, ORG_A);
  assert.equal(sensitivityCalls[0].fileProfileId, OUTPUT_PROFILE_ID);
  assert.equal(sensitivityCalls[0].dataDictionaryId, DATA_DICTIONARY_ID);

  assert.equal(reviewQueueCalls.length, 0);

  const entry = result.data.activated[0];
  assert.equal(entry.dataDictionary.ok, true);
  assert.equal(entry.sensitivityProfile.ok, true);
});

test("replaying the same tick does not duplicate P1-04 or P1-05 work", async () => {
  const activationCalls = [];
  const dictionaryCalls = [];
  const sensitivityCalls = [];

  const dependencies = {
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_A, intake_file_id: "file-1" },
    ],
    activateParserProfileWorkForIntakeFile: fakeCompletedActivation(activationCalls),
    createDraftDataDictionary: async (input) => {
      dictionaryCalls.push(input);
      // The injected P1-04 repository owns idempotent replay; this double always
      // reports the same committed identity for the same lookup input.
      return { ok: true, data: { dictionary: { data_dictionary_id: DATA_DICTIONARY_ID }, replayed: dictionaryCalls.length > 1 }, error: null };
    },
    persistIntakeSensitivityProfile: async (input) => {
      sensitivityCalls.push(input);
      return { ok: true, data: { sensitivityProfile: { intake_sensitivity_profile_id: "sp-1" }, replayed: sensitivityCalls.length > 1 }, error: null };
    },
    createProductionMetadataOnlyAudit: () => ({ prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) }),
    p1DownstreamRecoveryRepository: grantingRecoveryRepository(),
  };

  await runKaiP1WorkerTick(dependencies);
  await runKaiP1WorkerTick(dependencies);

  assert.equal(dictionaryCalls.length, 2);
  assert.equal(sensitivityCalls.length, 2);
  // Every call carries the identical identity - the same fileProfileId and, once
  // derived, the same dataDictionaryId - which is what lets the injected P1-04/
  // P1-05 repositories replay the existing committed row instead of inserting a
  // second one.
  assert.equal(dictionaryCalls[0].organizationId, dictionaryCalls[1].organizationId);
  assert.equal(dictionaryCalls[0].fileProfileId, dictionaryCalls[1].fileProfileId);
  assert.equal(sensitivityCalls[0].dataDictionaryId, sensitivityCalls[1].dataDictionaryId);
  assert.equal(sensitivityCalls[0].fileProfileId, sensitivityCalls[1].fileProfileId);
});

test("a P1-04 failure stops the chain before P1-05 is ever invoked", async () => {
  const activationCalls = [];
  const dictionaryCalls = [];
  const sensitivityCalls = [];

  const result = await runKaiP1WorkerTick({
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_A, intake_file_id: "file-1" },
    ],
    activateParserProfileWorkForIntakeFile: fakeCompletedActivation(activationCalls),
    createDraftDataDictionary: async (input) => {
      dictionaryCalls.push(input);
      return { ok: false, data: null, error: { code: "system_error" } };
    },
    persistIntakeSensitivityProfile: async (input) => {
      sensitivityCalls.push(input);
      return { ok: true, data: { sensitivityProfile: { intake_sensitivity_profile_id: "sp-1" } }, error: null };
    },
    createProductionMetadataOnlyAudit: () => ({ prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) }),
    p1DownstreamRecoveryRepository: grantingRecoveryRepository(),
  });

  assert.equal(dictionaryCalls.length, 1);
  assert.equal(sensitivityCalls.length, 0);
  const entry = result.data.activated[0];
  assert.equal(entry.dataDictionary.ok, false);
  assert.equal(entry.sensitivityProfile, undefined);
});

test("B. P1-04 recovery: a P1-04 failure on tick 1 is retried on tick 2 against the replayed completed P1-03 run, without reprofiling", async () => {
  const activationCalls = [];
  const dictionaryCalls = [];
  const sensitivityCalls = [];

  const activateParserProfileWorkForIntakeFile = async (input) => {
    activationCalls.push(input);
    return activationCalls.length === 1
      ? fakeCompletedActivation([])(input)
      : fakeReplayedCompletedActivation([])(input);
  };

  const dependencies = {
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_A, intake_file_id: "file-1" },
    ],
    activateParserProfileWorkForIntakeFile,
    createDraftDataDictionary: async (input) => {
      dictionaryCalls.push(input);
      if (dictionaryCalls.length === 1) {
        return { ok: false, data: null, error: { code: "system_error" } };
      }
      return { ok: true, data: { dictionary: { data_dictionary_id: DATA_DICTIONARY_ID }, replayed: false }, error: null };
    },
    persistIntakeSensitivityProfile: async (input) => {
      sensitivityCalls.push(input);
      return { ok: true, data: { sensitivityProfile: { intake_sensitivity_profile_id: "sp-1" } }, error: null };
    },
    createProductionMetadataOnlyAudit: () => ({ prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) }),
    p1DownstreamRecoveryRepository: grantingRecoveryRepository(),
  };

  const first = await runKaiP1WorkerTick(dependencies);
  const firstEntry = first.data.activated[0];
  assert.equal(firstEntry.dataDictionary.ok, false);
  assert.equal(firstEntry.sensitivityProfile, undefined, "P1-05 must never be called after a P1-04 failure");

  const second = await runKaiP1WorkerTick(dependencies);
  assert.equal(activationCalls.length, 2);
  assert.equal(activationCalls[1].retry, false, "the replayed completed run must never be retried/reprofiled");

  const secondEntry = second.data.activated[0];
  assert.equal(secondEntry.dataDictionary.ok, true, "P1-04 must succeed/replay against the same authoritative output_profile_id");
  assert.equal(dictionaryCalls[1].fileProfileId, OUTPUT_PROFILE_ID, "the exact persisted output_profile_id must be reused, not re-derived");
  assert.equal(secondEntry.sensitivityProfile.ok, true);
});

test("C. P1-05 recovery: a P1-05 failure on tick 1 is retried on tick 2, idempotently replaying the same P1-04 dictionary, no duplicate authoritative records", async () => {
  const activationCalls = [];
  const dictionaryCalls = [];
  const sensitivityCalls = [];

  const activateParserProfileWorkForIntakeFile = async (input) => {
    activationCalls.push(input);
    return activationCalls.length === 1
      ? fakeCompletedActivation([])(input)
      : fakeReplayedCompletedActivation([])(input);
  };

  const dependencies = {
    env: ENABLED_ENV,
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_A, intake_file_id: "file-1" },
    ],
    activateParserProfileWorkForIntakeFile,
    createDraftDataDictionary: async (input) => {
      dictionaryCalls.push(input);
      // The injected P1-04 repository owns idempotent replay: it reports the
      // same committed dictionary identity for the same lookup input every time.
      return {
        ok: true,
        data: { dictionary: { data_dictionary_id: DATA_DICTIONARY_ID }, replayed: dictionaryCalls.length > 1 },
        error: null,
      };
    },
    persistIntakeSensitivityProfile: async (input) => {
      sensitivityCalls.push(input);
      if (sensitivityCalls.length === 1) {
        return { ok: false, data: null, error: { code: "system_error" } };
      }
      return { ok: true, data: { sensitivityProfile: { intake_sensitivity_profile_id: "sp-1" }, replayed: false }, error: null };
    },
    createProductionMetadataOnlyAudit: () => ({ prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) }),
    p1DownstreamRecoveryRepository: grantingRecoveryRepository(),
  };

  const first = await runKaiP1WorkerTick(dependencies);
  const firstEntry = first.data.activated[0];
  assert.equal(firstEntry.dataDictionary.ok, true);
  assert.equal(firstEntry.sensitivityProfile.ok, false);

  const second = await runKaiP1WorkerTick(dependencies);
  const secondEntry = second.data.activated[0];
  assert.equal(secondEntry.dataDictionary.ok, true);
  assert.equal(
    dictionaryCalls[0].fileProfileId,
    dictionaryCalls[1].fileProfileId,
    "the same dictionary identity must be reused across ticks, never a second authoritative bundle",
  );
  assert.equal(dictionaryCalls[1].fileProfileId, OUTPUT_PROFILE_ID);
  assert.equal(secondEntry.sensitivityProfile.ok, true);
  assert.equal(sensitivityCalls.length, 2);
});

test("D. non-completed P1-03 results never reach P1-04, even a malformed/fake result carrying unrelated data", async () => {
  const dictionaryCalls = [];
  const sensitivityCalls = [];

  const notCompletedCases = [
    async () => ({ ok: false, data: null, error: { code: "conflict_current_state_changed" } }),
    async () => ({ ok: true, data: { activated: false, reason: "not_eligible_for_p1" }, error: null }),
    async () => ({
      ok: true,
      data: { activated: true, run: { run: { parser_status: "queued", output_profile_id: OUTPUT_PROFILE_ID } } },
      error: null,
    }),
    async () => ({
      ok: true,
      data: { activated: true, run: { run: { parser_status: "running", output_profile_id: OUTPUT_PROFILE_ID } } },
      error: null,
    }),
    async () => ({
      ok: true,
      data: { activated: false, run: { run: { parser_status: "failed", output_profile_id: null } } },
      error: null,
    }),
    // Malformed/fake result: truthy `activated` and unrelated data, but no
    // completed run/output_profile_id at the expected shape.
    async () => ({ ok: true, data: { activated: true, unrelated: { output_profile_id: OUTPUT_PROFILE_ID } }, error: null }),
  ];

  for (const activateParserProfileWorkForIntakeFile of notCompletedCases) {
    // eslint-disable-next-line no-await-in-loop
    await runKaiP1WorkerTick({
      env: ENABLED_ENV,
      listActionableKaiP1WorkCandidates: async () => [
        { organization_id: ORG_A, intake_file_id: "file-1" },
      ],
      activateParserProfileWorkForIntakeFile,
      createDraftDataDictionary: async (input) => {
        dictionaryCalls.push(input);
        return { ok: true, data: { dictionary: { data_dictionary_id: DATA_DICTIONARY_ID } }, error: null };
      },
      persistIntakeSensitivityProfile: async (input) => {
        sensitivityCalls.push(input);
        return { ok: true, data: { sensitivityProfile: { intake_sensitivity_profile_id: "sp-1" } }, error: null };
      },
    });
  }

  assert.equal(dictionaryCalls.length, 0);
  assert.equal(sensitivityCalls.length, 0);
});

test("E. P1-06 boundary: no P1-06 seam is ever imported or reachable from the runtime module", () => {
  const source = readFileSync("Backend/kai/parsing/p1WorkerRuntime.js", "utf8");
  const importLines = source.match(/^import .+$/gm) || [];
  for (const line of importLines) {
    assert.doesNotMatch(line, /createSensitivityReviewQueueItem|kaiReviewQueueService|review-?queue/i);
  }
  assert.doesNotMatch(source, /createSensitivityReviewQueueItem\s*\(/);
});

function completedChainDependencies(calls) {
  return {
    env: ENABLED_ENV,
    activateParserProfileWorkForIntakeFile: fakeCompletedActivation(calls.activation),
    createDraftDataDictionary: async (input) => {
      calls.dictionary.push(input);
      return { ok: true, data: { dictionary: { data_dictionary_id: DATA_DICTIONARY_ID } }, error: null };
    },
    persistIntakeSensitivityProfile: async (input) => {
      calls.sensitivity.push(input);
      return { ok: true, data: { sensitivityProfile: { intake_sensitivity_profile_id: "sp-1" } }, error: null };
    },
    createProductionMetadataOnlyAudit: () => ({ prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => {} }) }),
    p1DownstreamRecoveryRepository: grantingRecoveryRepository(),
    now: () => "2026-10-10T12:00:00.000Z",
  };
}

function emptyCalls() {
  return { activation: [], dictionary: [], sensitivity: [] };
}

test("shared file operation: either feature gate disabled => feature_disabled with zero activation or downstream work", async () => {
  for (const env of [
    { ...ENABLED_ENV, KAI_SPRINT2_ENABLED: "false" },
    { ...ENABLED_ENV, KAI_WORKER_ENABLED: "false" },
    {},
  ]) {
    const calls = emptyCalls();
    const result = await processKaiP1IntakeFile(
      { organizationId: ORG_A, intakeFileId: "file-1" },
      { ...completedChainDependencies(calls), env },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "feature_disabled");
    assert.equal(calls.activation.length, 0);
    assert.equal(calls.dictionary.length, 0);
    assert.equal(calls.sensitivity.length, 0);
  }
});

test("shared file operation: accepts only file identity - a caller cannot supply retry, an actor, or any eligibility fact", async () => {
  for (const input of [
    { organizationId: ORG_A, intakeFileId: "file-1", retry: true },
    { organizationId: ORG_A, intakeFileId: "file-1", actorContext: { actorType: "human", actorUserId: "u-1" } },
    { organizationId: ORG_A, intakeFileId: "file-1", filePolicyStatus: "passed" },
    { organizationId: ORG_A, intakeFileId: "file-1", uploadState: "confirmed" },
    { organizationId: ORG_A },
    { intakeFileId: "file-1" },
    { organizationId: "", intakeFileId: "file-1" },
    null,
    [ORG_A, "file-1"],
  ]) {
    const calls = emptyCalls();
    const result = await processKaiP1IntakeFile(input, completedChainDependencies(calls));
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, "validation_blocker", JSON.stringify(input));
    assert.equal(calls.activation.length, 0);
  }
});

test("shared file operation: runs P1-03 -> P1-04 -> P1-05 with the fixed system actor, retry:false, and forwards only a narrowing expectation", async () => {
  const calls = emptyCalls();
  const expectedFileFacts = { objectVersionId: "ov-1", verifiedChecksum: "a".repeat(64), verifiedSizeBytes: 57 };
  const result = await processKaiP1IntakeFile(
    { organizationId: ORG_A, intakeFileId: "file-1", expectedFileFacts },
    completedChainDependencies(calls),
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.organizationId, ORG_A);
  assert.equal(result.data.intakeFileId, "file-1");
  assert.equal(result.data.stoppedAt, undefined);
  assert.equal(result.data.dataDictionary.ok, true);
  assert.equal(result.data.sensitivityProfile.ok, true);

  assert.deepEqual(calls.activation, [{
    organizationId: ORG_A,
    intakeFileId: "file-1",
    actorContext: KAI_P1_WORKER_SYNTHETIC_ACTOR_CONTEXT,
    retry: false,
    expectedFileFacts,
  }]);
  assert.equal(calls.dictionary[0].fileProfileId, OUTPUT_PROFILE_ID);
  assert.equal(calls.sensitivity[0].dataDictionaryId, DATA_DICTIONARY_ID);

  const withoutExpectation = emptyCalls();
  await processKaiP1IntakeFile({ organizationId: ORG_A, intakeFileId: "file-1" }, completedChainDependencies(withoutExpectation));
  assert.equal("expectedFileFacts" in withoutExpectation.activation[0], false);
});

test("shared file operation: stoppedAt names the stage a chain stopped at, and a downstream failure never re-runs P1-03", async () => {
  const notCompleted = emptyCalls();
  const notEligible = await processKaiP1IntakeFile(
    { organizationId: ORG_A, intakeFileId: "file-1" },
    {
      ...completedChainDependencies(notCompleted),
      activateParserProfileWorkForIntakeFile: async (input) => {
        notCompleted.activation.push(input);
        return { ok: true, data: { activated: false, reason: "not_eligible_for_p1" }, error: null };
      },
    },
  );
  assert.equal(notEligible.data.stoppedAt, "parser_profile_activation");
  assert.equal(notCompleted.dictionary.length, 0);

  const dictionaryFails = emptyCalls();
  const p104 = await processKaiP1IntakeFile(
    { organizationId: ORG_A, intakeFileId: "file-1" },
    {
      ...completedChainDependencies(dictionaryFails),
      createDraftDataDictionary: async (input) => {
        dictionaryFails.dictionary.push(input);
        return { ok: false, data: null, error: { code: "validation_blocker" } };
      },
    },
  );
  assert.equal(p104.data.stoppedAt, "draft_data_dictionary");
  assert.equal(dictionaryFails.activation.length, 1);
  assert.equal(dictionaryFails.dictionary.length, 1);
  assert.equal(dictionaryFails.sensitivity.length, 0);

  const sensitivityFails = emptyCalls();
  const p105 = await processKaiP1IntakeFile(
    { organizationId: ORG_A, intakeFileId: "file-1" },
    {
      ...completedChainDependencies(sensitivityFails),
      persistIntakeSensitivityProfile: async (input) => {
        sensitivityFails.sensitivity.push(input);
        return { ok: false, data: null, error: { code: "system_error" } };
      },
    },
  );
  assert.equal(p105.data.stoppedAt, "persist_intake_sensitivity_profile");
  assert.equal(sensitivityFails.activation.length, 1);
  assert.equal(sensitivityFails.sensitivity.length, 1);
});

test("the scheduled tick delegates each candidate to the same shared file operation, in candidate order", async () => {
  const tickCalls = emptyCalls();
  const tick = await runKaiP1WorkerTick({
    ...completedChainDependencies(tickCalls),
    listActionableKaiP1WorkCandidates: async () => [
      { organization_id: ORG_B, intake_file_id: "file-2" },
      { organization_id: ORG_A, intake_file_id: "file-1" },
    ],
  });

  const directCalls = emptyCalls();
  const direct = [
    await processKaiP1IntakeFile({ organizationId: ORG_B, intakeFileId: "file-2" }, completedChainDependencies(directCalls)),
    await processKaiP1IntakeFile({ organizationId: ORG_A, intakeFileId: "file-1" }, completedChainDependencies(directCalls)),
  ];

  assert.equal(tick.ok, true);
  assert.deepEqual(tick.data.activated, direct.map((entry) => entry.data));
  assert.deepEqual(tickCalls, directCalls);
  assert.deepEqual(tickCalls.activation.map((call) => call.intakeFileId), ["file-2", "file-1"]);
});

// --- Package 3: durable downstream decisions, cron cadence and overlap ---

function decidingRecoveryRepository(decisionFor) {
  const calls = [];
  return {
    calls,
    async claimDownstreamAttempt(input) {
      calls.push({ kind: "claim", stage: input.identity.stage });
      return { ok: true, data: decisionFor(input.identity.stage), error: null };
    },
    async completeDownstreamAttempt(input) {
      calls.push({ kind: "complete", stage: input.identity.stage, outcome: input.outcome });
      return { ok: true, data: { acknowledged: true, recoveryState: input.outcome === "succeeded" ? "succeeded" : "retry_scheduled" }, error: null };
    },
  };
}

test("a downstream stage that is not claimed - deferred, busy, exhausted, operator attention, not eligible, or an unreadable claim - is never invoked", async () => {
  for (const decision of [
    { decision: "deferred", errorCode: "system_error", attemptNumber: 1 },
    { decision: "busy", attemptNumber: 2 },
    { decision: "exhausted", errorCode: "system_error", attemptNumber: 3 },
    { decision: "operator_attention", errorCode: "validation_blocker", attemptNumber: 1 },
    { decision: "not_eligible" },
  ]) {
    const calls = emptyCalls();
    const repository = decidingRecoveryRepository(() => decision);
    const result = await processKaiP1IntakeFile(
      { organizationId: ORG_A, intakeFileId: "file-1" },
      { ...completedChainDependencies(calls), p1DownstreamRecoveryRepository: repository },
    );
    assert.equal(result.data.stoppedAt, "draft_data_dictionary", decision.decision);
    assert.equal(result.data.recovery[0].decision, decision.decision);
    assert.equal(calls.dictionary.length, 0, decision.decision);
    assert.equal(calls.sensitivity.length, 0);
    assert.equal(repository.calls.some((call) => call.kind === "complete"), false);
  }

  const calls = emptyCalls();
  const failing = {
    async claimDownstreamAttempt() { throw new Error("synthetic connection failure"); },
    async completeDownstreamAttempt() { throw new Error("unreachable"); },
  };
  const unreadable = await processKaiP1IntakeFile(
    { organizationId: ORG_A, intakeFileId: "file-1" },
    { ...completedChainDependencies(calls), p1DownstreamRecoveryRepository: failing },
  );
  assert.deepEqual(unreadable.data.recovery, [{ stage: "p1_04_data_dictionary", decision: "claim_failed", code: "system_error" }]);
  assert.equal(calls.dictionary.length, 0, "no stage runs without a durable claim");
});

test("an already-committed P1-04 output is reconciled: P1-04 is not re-run and P1-05 receives the committed dictionary id", async () => {
  const calls = emptyCalls();
  const repository = decidingRecoveryRepository((stage) => (stage === "p1_04_data_dictionary"
    ? { decision: "already_succeeded", outputId: DATA_DICTIONARY_ID }
    : { decision: "claimed", claimToken: "00000000-0000-4000-8000-000000000001", attemptNumber: 1 }));
  const result = await processKaiP1IntakeFile(
    { organizationId: ORG_A, intakeFileId: "file-1" },
    { ...completedChainDependencies(calls), p1DownstreamRecoveryRepository: repository },
  );
  assert.equal(result.data.stoppedAt, undefined);
  assert.equal(calls.dictionary.length, 0);
  assert.equal(calls.sensitivity[0].dataDictionaryId, DATA_DICTIONARY_ID);
  assert.equal(result.data.dataDictionary.data.reconciled, true);
});

test("downstream failure classification: only system_error is retryable; known blockers and anything unrecognized need an operator", () => {
  assert.deepEqual(classifyKaiP1DownstreamStageFailure({ ok: false, error: { code: "system_error" } }), { outcome: "retryable_failure", errorCode: "system_error" });
  for (const code of ["validation_blocker", "conflict_current_state_changed", "not_found", "feature_disabled", "authorization_denied", "tenant_boundary_violation", "state_transition_denied", "unclassified_stage_exception"]) {
    assert.deepEqual(classifyKaiP1DownstreamStageFailure({ ok: false, error: { code } }), { outcome: "non_retryable_failure", errorCode: code });
  }
  for (const result of [{ ok: false, error: { code: "brand_new_code" } }, { ok: false }, null, { ok: true, data: {} }]) {
    assert.deepEqual(classifyKaiP1DownstreamStageFailure(result), { outcome: "non_retryable_failure", errorCode: "unclassified_stage_failure" });
  }
});

test("the stage outcome reaches the fenced acknowledgment exactly once per claimed attempt", async () => {
  const calls = emptyCalls();
  const repository = grantingRecoveryRepository();
  await processKaiP1IntakeFile(
    { organizationId: ORG_A, intakeFileId: "file-1" },
    {
      ...completedChainDependencies(calls),
      p1DownstreamRecoveryRepository: repository,
      persistIntakeSensitivityProfile: async () => ({ ok: false, data: null, error: { code: "system_error" } }),
    },
  );
  assert.deepEqual(repository.calls.map(({ kind, stage, outcome, errorCode }) => [kind, stage, outcome ?? null, errorCode ?? null]), [
    ["claim", "p1_04_data_dictionary", null, null],
    ["complete", "p1_04_data_dictionary", "succeeded", null],
    ["claim", "p1_05_sensitivity_profile", null, null],
    ["complete", "p1_05_sensitivity_profile", "retryable_failure", "system_error"],
  ]);
});

test("the cron fallback is registered every minute in America/Vancouver, only with both gates", () => {
  const scheduled = [];
  const cronLib = { schedule: (expression, handler, options) => { scheduled.push({ expression, options }); return {}; } };
  for (const env of [{ KAI_SPRINT2_ENABLED: "true" }, { KAI_WORKER_ENABLED: "true" }, {}]) {
    assert.equal(registerKaiP1WorkerCron({ env, cronLib, createRuntimeDependencies: () => ({}) }).scheduled, false);
  }
  assert.equal(scheduled.length, 0);
  registerKaiP1WorkerCron({ env: ENABLED_ENV, cronLib, createRuntimeDependencies: () => ({}) });
  assert.deepEqual(scheduled, [{ expression: "* * * * *", options: { timezone: "America/Vancouver" } }]);
});

test("an overlapping cron fire is skipped rather than queued, and a failed or throwing tick never stops later fires or logs diagnostics", async () => {
  let handler;
  const cronLib = { schedule: (expression, callback) => { handler = callback; return {}; } };
  const lines = [];
  let release;
  const outcomes = [
    () => new Promise((resolve) => { release = () => resolve({ ok: true, data: { activated: [] }, error: null }); }),
    () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432 org a5d17c5a"), { stack: "secret" })),
    () => Promise.resolve({ ok: false, data: null, error: { code: "system_error" } }),
    () => Promise.resolve({
      ok: true,
      data: {
        activated: [
          { organizationId: ORG_A, intakeFileId: "file-1", sensitivityProfile: { ok: true } },
          { organizationId: ORG_A, intakeFileId: "file-2", stoppedAt: "draft_data_dictionary", recovery: [{ decision: "retry_scheduled", code: "system_error" }] },
          { organizationId: ORG_B, intakeFileId: "file-3", stoppedAt: "draft_data_dictionary", recovery: [{ decision: "exhausted", code: "system_error" }] },
          { organizationId: ORG_B, intakeFileId: "file-4", stoppedAt: "persist_intake_sensitivity_profile", recovery: [{ decision: "busy" }] },
          { organizationId: ORG_B, intakeFileId: "file-5", result: { ok: false, error: { code: "feature_disabled" } } },
        ],
      },
      error: null,
    }),
  ];
  let ticks = 0;
  registerKaiP1WorkerCron({
    env: ENABLED_ENV,
    cronLib,
    createRuntimeDependencies: () => ({}),
    runTick: () => outcomes[ticks++](),
    log: (line) => lines.push(line),
  });

  const first = handler();
  await handler();
  assert.equal(ticks, 1);
  release();
  await first;
  await handler();
  await handler();
  await handler();
  assert.equal(ticks, 4);
  assert.deepEqual(lines, [
    "[kai-p1-worker] tick skipped: previous tick still running",
    "[kai-p1-worker] tick failed",
    "[kai-p1-worker] tick failed",
    "[kai-p1-worker] candidates=5 completed_through_p1_05=1 deferred=1 busy=1 exhausted=1 rejected=1",
  ]);
});

test("P1-06 and later stay unreachable from the new recovery, guard, and cron modules", () => {
  for (const path of [
    "Backend/kai/parsing/postgresP1DownstreamRecoveryRepository.js",
    "Backend/kai/parsing/p1StageTransaction.js",
    "Backend/kai/parsing/p1WorkerCron.js",
    "Backend/kai/services/kaiP1RecoveryStatusService.js",
  ]) {
    const source = readFileSync(path, "utf8");
    for (const line of source.match(/^import .+$/gm) || []) {
      assert.doesNotMatch(line, /reviewQueue|review-?queue|sourceCandidate|sourcePromotion|evidence|\bclaims?\b|claimProposal|generat|exportReview|exportCandidate|humanAuthority/i, `${path}: ${line}`);
    }
    assert.doesNotMatch(source, /createSensitivityReviewQueueItem\s*\(|retry:\s*true/, path);
  }
});
