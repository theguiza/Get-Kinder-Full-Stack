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
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async () => [
      { organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" },
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
  assert.deepEqual(dictionaryCalls[0].organizationId, IN_SCOPE_ORG);
  assert.deepEqual(dictionaryCalls[0].fileProfileId, OUTPUT_PROFILE_ID);

  assert.equal(sensitivityCalls.length, 1);
  assert.equal(sensitivityCalls[0].organizationId, IN_SCOPE_ORG);
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
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async () => [
      { organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" },
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
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async () => [
      { organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" },
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
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async () => [
      { organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" },
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
    listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async () => [
      { organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" },
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
      listKaiP1WorkerSyntheticScopedEligibleIntakeFiles: async () => [
        { organization_id: IN_SCOPE_ORG, intake_file_id: "file-1" },
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
