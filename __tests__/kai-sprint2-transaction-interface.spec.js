import test from "node:test";
import assert from "node:assert/strict";

import { withTransaction } from "../Backend/kai/db/kaiDb.js";
import {
  createTransactionHarness,
  withTestTransaction,
} from "./support/kaiMutationOrchestrationTestHarness.js";

test("production transaction interface retains callback-only default usage", () => {
  assert.equal(withTransaction.length, 1);
});

test("repository transaction commits when its callback completes successfully", async () => {
  const harness = createTransactionHarness();
  const expected = { intakeBatchId: "synthetic-batch" };

  const result = await withTestTransaction(async (transactionContext) => {
    assert.strictEqual(transactionContext, harness.transactionContext);
    harness.events.push("CALLBACK");
    return expected;
  }, harness);

  assert.strictEqual(result, expected);
  assert.deepEqual(harness.events, ["CONNECT", "BEGIN", "CALLBACK", "COMMIT", "RELEASE"]);
});

for (const [failureKind, callback] of [
  ["thrown error", () => { throw new Error("synthetic transaction failure"); }],
  ["rejected promise", () => Promise.reject(new Error("synthetic transaction failure"))],
]) {
  test(`repository transaction rolls back on callback ${failureKind}`, async () => {
    const harness = createTransactionHarness();

    await assert.rejects(
      withTestTransaction(callback, harness),
      /synthetic transaction failure/,
    );

    assert.deepEqual(harness.events, ["CONNECT", "BEGIN", "ROLLBACK", "RELEASE"]);
    assert.equal(harness.events.includes("COMMIT"), false);
  });
}

test("mutation persistence and required audit receive one consistent transaction context", async () => {
  const harness = createTransactionHarness();
  const receivedContexts = [];
  const persistMutation = async (_record, transactionContext) => {
    receivedContexts.push(transactionContext);
    harness.events.push("MUTATION");
  };
  const persistRequiredAudit = async (_record, transactionContext) => {
    receivedContexts.push(transactionContext);
    harness.events.push("REQUIRED_AUDIT");
  };

  await withTestTransaction(async (...callbackArguments) => {
    assert.equal(callbackArguments.length, 1);
    const [transactionContext] = callbackArguments;
    await persistMutation({ id: "synthetic-mutation" }, transactionContext);
    await persistRequiredAudit({ id: "synthetic-audit" }, transactionContext);
  }, harness);

  assert.deepEqual(receivedContexts, [harness.transactionContext, harness.transactionContext]);
  assert.deepEqual(harness.events, [
    "CONNECT",
    "BEGIN",
    "MUTATION",
    "REQUIRED_AUDIT",
    "COMMIT",
    "RELEASE",
  ]);
});

test("best-effort metrics remain outside the transaction interface and cannot cause rollback", async () => {
  const harness = createTransactionHarness();
  const emitBestEffortMetric = async () => {
    harness.events.push("METRIC");
    throw new Error("synthetic metrics failure");
  };

  await withTestTransaction(async (...callbackArguments) => {
    assert.equal(callbackArguments.length, 1);
    harness.events.push("CALLBACK");
  }, harness);

  await assert.rejects(emitBestEffortMetric(), /synthetic metrics failure/);

  assert.deepEqual(harness.events, [
    "CONNECT",
    "BEGIN",
    "CALLBACK",
    "COMMIT",
    "RELEASE",
    "METRIC",
  ]);
  assert.equal(harness.events.includes("ROLLBACK"), false);
});
