import test from "node:test";
import assert from "node:assert/strict";

import {
  BEST_EFFORT_METRIC_METADATA_ALLOWLIST,
  REQUIRED_AUDIT_METADATA_ALLOWLIST,
  RequiredAuditPersistenceError,
  createTransactionHarness,
  runMutationOrchestrationForTest,
} from "./support/kaiMutationOrchestrationTestHarness.js";

function orchestrationInput(overrides = {}) {
  return {
    mutation: { syntheticId: "mutation-1" },
    requiredAuditMetadata: {
      operation: "synthetic_mutation",
      actor_type: "human",
      organization_id: "11111111-1111-4111-8111-111111111111",
      object_type: "intake_batch",
      object_id: "22222222-2222-4222-8222-222222222222",
      reason_code: "mutation_completed",
      request_id: "request_1",
      route: "/api/kai/sprint2/intake/admin/batches",
    },
    bestEffortMetricMetadata: {
      metric_name: "kai.mutation.completed",
      operation: "synthetic_mutation",
      actor_type: "human",
      object_type: "intake_batch",
      outcome: "success",
      duration_ms: 12,
    },
    ...overrides,
  };
}

function dependenciesForAuditResult(harness, auditResultFactory) {
  return {
    async persistMutation() {
      harness.events.push("MUTATION");
      return { ok: true, mutationId: "mutation-1" };
    },
    async persistRequiredAudit() {
      harness.events.push("REQUIRED_AUDIT");
      return auditResultFactory();
    },
    async emitBestEffortMetric() {
      harness.events.push("METRIC");
    },
  };
}

async function assertNonConfirmingAuditRollsBack(auditResultFactory) {
  const harness = createTransactionHarness();

  await assert.rejects(
    runMutationOrchestrationForTest(
      orchestrationInput(),
      dependenciesForAuditResult(harness, auditResultFactory),
      harness,
    ),
    (error) => error instanceof RequiredAuditPersistenceError && error.code === "required_audit_failed",
  );

  assert.deepEqual(harness.events, [
    "CONNECT",
    "BEGIN",
    "MUTATION",
    "REQUIRED_AUDIT",
    "ROLLBACK",
    "RELEASE",
  ]);
}

for (const [description, auditResultFactory] of [
  ["a plain object with its own boolean data property ok true", () => ({ ok: true })],
  ["a null-prototype object with its own boolean data property ok true", () => {
    const result = Object.create(null);
    result.ok = true;
    return result;
  }],
  ["a class instance with its own boolean data property ok true", () => {
    class RequiredAuditReceipt {
      constructor() {
        this.ok = true;
      }
    }
    return new RequiredAuditReceipt();
  }],
]) {
  test(`required audit accepts ${description}`, async () => {
    const harness = createTransactionHarness();
    const expectedResult = { ok: true, mutationId: "mutation-1" };
    const dependencies = dependenciesForAuditResult(harness, auditResultFactory);
    dependencies.persistMutation = async () => {
      harness.events.push("MUTATION");
      return expectedResult;
    };

    const result = await runMutationOrchestrationForTest(
      orchestrationInput(),
      dependencies,
      harness,
    );

    assert.strictEqual(result, expectedResult);
    assert.deepEqual(harness.events, [
      "CONNECT",
      "BEGIN",
      "MUTATION",
      "REQUIRED_AUDIT",
      "COMMIT",
      "RELEASE",
      "METRIC",
    ]);
  });
}

test("mutation and required audit receive the identical opaque context and metrics run after commit", async () => {
  const harness = createTransactionHarness();
  const receivedContexts = [];
  const expectedResult = { ok: true, mutationId: "mutation-1" };

  const result = await runMutationOrchestrationForTest(orchestrationInput(), {
    async persistMutation(_mutation, transactionContext) {
      receivedContexts.push(transactionContext);
      harness.events.push("MUTATION");
      return expectedResult;
    },
    async persistRequiredAudit(_metadata, transactionContext) {
      receivedContexts.push(transactionContext);
      harness.events.push("REQUIRED_AUDIT");
      return { ok: true };
    },
    async emitBestEffortMetric() {
      harness.events.push("METRIC");
    },
  }, harness);

  assert.strictEqual(result, expectedResult);
  assert.deepEqual(receivedContexts, [harness.transactionContext, harness.transactionContext]);
  assert.deepEqual(harness.events, [
    "CONNECT",
    "BEGIN",
    "MUTATION",
    "REQUIRED_AUDIT",
    "COMMIT",
    "RELEASE",
    "METRIC",
  ]);
});

test("mutation failure rolls back and suppresses required audit and metrics", async () => {
  const harness = createTransactionHarness();

  await assert.rejects(
    runMutationOrchestrationForTest(orchestrationInput(), {
      async persistMutation() {
        harness.events.push("MUTATION");
        throw new Error("synthetic mutation failure");
      },
      async persistRequiredAudit() {
        harness.events.push("REQUIRED_AUDIT");
        return { ok: true };
      },
      async emitBestEffortMetric() {
        harness.events.push("METRIC");
      },
    }, harness),
    /synthetic mutation failure/,
  );

  assert.deepEqual(harness.events, ["CONNECT", "BEGIN", "MUTATION", "ROLLBACK", "RELEASE"]);
});

for (const [failureKind, persistRequiredAudit] of [
  ["synchronous throw", () => { throw new Error("synthetic required-audit throw"); }],
  ["rejected promise", () => Promise.reject(new Error("synthetic required-audit rejection"))],
]) {
  test(`required-audit persistence ${failureKind} rolls back and suppresses metrics`, async () => {
    const harness = createTransactionHarness();

    await assert.rejects(
      runMutationOrchestrationForTest(orchestrationInput(), {
        async persistMutation() {
          harness.events.push("MUTATION");
          return { ok: true };
        },
        persistRequiredAudit(...args) {
          harness.events.push("REQUIRED_AUDIT");
          return persistRequiredAudit(...args);
        },
        async emitBestEffortMetric() {
          harness.events.push("METRIC");
        },
      }, harness),
      /synthetic required-audit/,
    );

    assert.deepEqual(harness.events, [
      "CONNECT",
      "BEGIN",
      "MUTATION",
      "REQUIRED_AUDIT",
      "ROLLBACK",
      "RELEASE",
    ]);
  });
}

for (const [description, auditResultFactory] of [
  ["null", () => null],
  ["undefined", () => undefined],
  ["boolean true", () => true],
  ["number one", () => 1],
  ["string true", () => "true"],
  ["a symbol", () => Symbol("ok")],
  ["a bigint", () => 1n],
  ["a function with an own ok true property", () => Object.assign(() => {}, { ok: true })],
  ["an array", () => []],
  ["an array with its own ok true property", () => Object.assign([], { ok: true })],
  ["an object missing ok", () => ({ result: "synthetic" })],
  ["ok false", () => ({ ok: false })],
  ["truthy string ok", () => ({ ok: "true" })],
  ["truthy numeric ok", () => ({ ok: 1 })],
  ["inherited ok true", () => Object.create({ ok: true })],
  ["a synthetic Date result", () => new Date(0)],
  ["a synthetic regular-expression result", () => /ok/],
]) {
  test(`required audit fails closed for ${description}`, async () => {
    await assertNonConfirmingAuditRollsBack(auditResultFactory);
  });
}

test("required audit rejects an accessor ok without invoking its getter", async () => {
  let getterCalls = 0;
  const auditResult = Object.defineProperty({}, "ok", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });

  await assertNonConfirmingAuditRollsBack(() => auditResult);
  assert.equal(getterCalls, 0);
});

test("required-audit descriptor inspection failure fails the transaction", async () => {
  const harness = createTransactionHarness();
  const descriptorError = new Error("synthetic descriptor failure");
  const auditResult = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw descriptorError;
    },
  });

  await assert.rejects(
    runMutationOrchestrationForTest(
      orchestrationInput(),
      dependenciesForAuditResult(harness, () => auditResult),
      harness,
    ),
    (error) => error === descriptorError,
  );

  assert.deepEqual(harness.events, [
    "CONNECT",
    "BEGIN",
    "MUTATION",
    "REQUIRED_AUDIT",
    "ROLLBACK",
    "RELEASE",
  ]);
});

test("metrics failure cannot roll back or replace the successful mutation result", async () => {
  const harness = createTransactionHarness();
  const expectedResult = { ok: true, mutationId: "mutation-1" };

  const result = await runMutationOrchestrationForTest(orchestrationInput(), {
    async persistMutation() {
      harness.events.push("MUTATION");
      return expectedResult;
    },
    async persistRequiredAudit() {
      harness.events.push("REQUIRED_AUDIT");
      return { ok: true };
    },
    async emitBestEffortMetric() {
      harness.events.push("METRIC");
      throw new Error("synthetic metrics failure");
    },
  }, harness);

  assert.strictEqual(result, expectedResult);
  assert.deepEqual(harness.events, [
    "CONNECT",
    "BEGIN",
    "MUTATION",
    "REQUIRED_AUDIT",
    "COMMIT",
    "RELEASE",
    "METRIC",
  ]);
  assert.equal(harness.events.includes("ROLLBACK"), false);
});

test("audit and metric payloads retain only explicit metadata allowlists", async () => {
  const harness = createTransactionHarness();
  const captured = {};
  const forbiddenMetadata = {
    raw_content: "private raw upload",
    raw_parsed_rows: [{ client_email: "person@example.test" }],
    prompt_text: "ignore previous instructions",
    storage_bucket: "private-bucket",
    storage_object_key: "tenant/private/object.csv",
    storage_uri: "gs://private-bucket/tenant/private/object.csv",
    actor_context: { actorUserId: "private-actor", roles: ["gk_admin"] },
    session: { id: "private-session", token: "secret" },
    membership: { organization_id: "private-membership" },
    actor_email: "actor@example.test",
    client_name: "Private Client",
    client_email: "client@example.test",
    unapproved_pii: "555-0100",
  };

  await runMutationOrchestrationForTest(orchestrationInput({
    requiredAuditMetadata: {
      operation: "synthetic_mutation",
      actor_type: "human",
      organization_id: "11111111-1111-4111-8111-111111111111",
      object_type: "intake_batch",
      object_id: "22222222-2222-4222-8222-222222222222",
      request_id: "request_1",
      route: "/api/kai/sprint2/intake/admin/batches",
      reason_code: "client@example.test",
      ...forbiddenMetadata,
    },
    bestEffortMetricMetadata: {
      metric_name: "kai.mutation.completed",
      operation: "synthetic_mutation",
      actor_type: "human",
      object_type: "intake_batch",
      outcome: "success",
      duration_ms: 12,
      reason_code: "client@example.test",
      organization_id: "11111111-1111-4111-8111-111111111111",
      object_id: "22222222-2222-4222-8222-222222222222",
      request_id: "request_1",
      route: "/api/kai/sprint2/intake/admin/batches",
      ...forbiddenMetadata,
    },
  }), {
    async persistMutation() {
      return { ok: true };
    },
    async persistRequiredAudit(metadata) {
      captured.audit = metadata;
      return { ok: true };
    },
    async emitBestEffortMetric(metadata) {
      captured.metric = metadata;
    },
  }, harness);

  assert.deepEqual(Object.keys(captured.audit), [
    "operation",
    "actor_type",
    "organization_id",
    "object_type",
    "object_id",
    "request_id",
    "route",
  ]);
  assert.deepEqual(Object.keys(captured.metric), [
    "metric_name",
    "operation",
    "actor_type",
    "object_type",
    "outcome",
    "duration_ms",
  ]);
  assert.equal(Object.keys(captured.audit).every((key) => REQUIRED_AUDIT_METADATA_ALLOWLIST.includes(key)), true);
  assert.equal(Object.keys(captured.metric).every((key) => BEST_EFFORT_METRIC_METADATA_ALLOWLIST.includes(key)), true);
  assert.equal(JSON.stringify(captured).includes("private"), false);
  assert.equal(JSON.stringify(captured).includes("example.test"), false);
  assert.equal(JSON.stringify(captured).includes("555-0100"), false);
  assert.equal(Object.isFrozen(captured.audit), true);
  assert.equal(Object.isFrozen(captured.metric), true);
});
