import test from "node:test";
import assert from "node:assert/strict";

if (!process.env.KAI_P0_POSTGRES_ADAPTER_DATABASE_URL) {
  test("PostgreSQL upload lifecycle adapter integration requires the runner-owned database", { skip: true }, () => {});
} else {
  await runAdapterIntegrationSuite();
}

async function runAdapterIntegrationSuite() {
  const { Client } = await import("pg");
  const { createPostgresUploadLifecycleRepository } = await import("../Backend/kai/upload/postgresUploadLifecycleRepository.js");
  const { createInMemoryUploadLifecycleRepository } = await import("../Backend/kai/upload/inMemoryUploadLifecycleRepository.js");

const DATABASE_URL = process.env.KAI_P0_POSTGRES_ADAPTER_DATABASE_URL;
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const BATCH = "10000000-0000-4000-8000-000000000001";
const NOW = "2026-07-23T10:00:00.000Z";
const PLUS_ONE_HOUR = "2026-07-23T11:00:00.000Z";
const PLUS_TWO_HOURS = "2026-07-23T12:00:00.000Z";
const AT_EXPIRY = "2026-07-24T10:00:00.000Z";
const CHECKSUM_A = "a".repeat(64);
const CHECKSUM_B = "b".repeat(64);

async function withClient(callback) {
  const client = new Client({ connectionString: DATABASE_URL, ssl: false });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function resetTables() {
  await withClient((client) => client.query("TRUNCATE kai.upload_lifecycle_audit, kai.upload_policy_decision_replay, kai.intake_files"));
}

function createRepo() {
  return createPostgresUploadLifecycleRepository();
}

function createInput(fileId = "20000000-0000-4000-8000-000000000001", overrides = {}) {
  return {
    organizationId: ORG,
    intakeBatchId: BATCH,
    intakeFileId: fileId,
    now: NOW,
    ...overrides,
  };
}

function transitionInput(fileId, expectedUploadState, newUploadState, overrides = {}) {
  return {
    organizationId: ORG,
    intakeFileId: fileId,
    expectedUploadState,
    newUploadState,
    now: PLUS_ONE_HOUR,
    ...overrides,
  };
}

function createAuditProbe({ prepareOk = true, publishThrows = false } = {}) {
  const prepared = [];
  const published = [];
  return {
    prepared,
    published,
    dependency: {
      prepareMetadataOnlyAudit(input) {
        prepared.push(input);
        if (!prepareOk) return { ok: false };
        return {
          ok: true,
          publish() {
            if (publishThrows) throw new Error("synthetic audit publish failure with /private/path");
            published.push(input);
          },
        };
      },
    },
  };
}

function policyInput(fileId, policyDecisionOutcome, overrides = {}) {
  const audit = overrides.audit || createAuditProbe();
  return {
    input: {
      confirmedFileFacts: {
        organizationId: ORG,
        intakeFileId: fileId,
        objectVersionId: "object-version-1",
        verifiedChecksum: CHECKSUM_A,
        verifiedSizeBytes: 7,
        declaredMime: "text/plain",
        extension: ".txt",
        ...overrides.confirmedFileFacts,
      },
      expectedFilePolicyStatus: overrides.expectedFilePolicyStatus || "pending",
      policyDecisionOutcome,
      sanitizedResult: overrides.sanitizedResult || {
        policy: policyDecisionOutcome === "passed" ? "pass" : policyDecisionOutcome,
        category: policyDecisionOutcome === "blocked" ? "unsupported_extension" : "encoding_gate_pass",
      },
      metadataOnlyAudit: audit.dependency,
      now: overrides.now || "2026-07-23T13:00:00.000Z",
    },
    audit,
  };
}

async function createConfirmed(repo, fileId) {
  assert.equal((await repo.createReservedUploadLifecycle(createInput(fileId))).ok, true);
  assert.equal((await repo.transitionUploadLifecycle(transitionInput(fileId, "reserved", "upload_started"))).ok, true);
  assert.equal((await repo.transitionUploadLifecycle(transitionInput(fileId, "upload_started", "uploaded_unconfirmed", {
    objectVersionId: "object-version-1",
  }))).ok, true);
  assert.equal((await repo.transitionUploadLifecycle(transitionInput(fileId, "uploaded_unconfirmed", "confirmed", {
    objectVersionId: "object-version-1",
    verifiedChecksum: CHECKSUM_A,
    verifiedSizeBytes: 7,
    now: PLUS_TWO_HOURS,
  }))).ok, true);
}

async function auditCount(fileId, operation) {
  const result = await withClient((client) => client.query(
    "SELECT count(*)::integer AS count FROM kai.upload_lifecycle_audit WHERE intake_file_id = $1::uuid AND operation = $2",
    [fileId, operation],
  ));
  return result.rows[0].count;
}

test("PostgreSQL adapter exposes every upload lifecycle callable", async () => {
  await resetTables();
  assert.deepEqual(Object.keys(createRepo()), [
    "createReservedUploadLifecycle",
    "getUploadLifecycle",
    "transitionUploadLifecycle",
    "compareAndSetPolicyDecision",
  ]);
});

test("fresh reservation persists, exact replay is authoritative, changed-fact reservation conflicts, cross-tenant is absent", async () => {
  await resetTables();
  const repo = createRepo();
  const fileId = "20000000-0000-4000-8000-000000000010";
  const first = await repo.createReservedUploadLifecycle(createInput(fileId));
  assert.equal(first.ok, true);
  assert.equal(first.data.replayed, false);
  assert.equal(first.data.record.upload_state, "reserved");
  assert.equal(first.data.record.upload_expires_at, "2026-07-24T10:00:00.000Z");

  const replay = await repo.createReservedUploadLifecycle(createInput(fileId, { now: PLUS_TWO_HOURS }));
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.record, first.data.record);

  assert.deepEqual(await repo.createReservedUploadLifecycle(createInput(fileId, {
    intakeBatchId: "10000000-0000-4000-8000-000000000099",
  })), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } });

  assert.deepEqual(await repo.getUploadLifecycle({ organizationId: OTHER_ORG, intakeFileId: fileId }), {
    ok: false,
    data: null,
    error: { code: "not_found", status: 404 },
  });
});

test("transitions enforce 24h expiry, directed edges, object-version immutability, confirmation facts, and checksum mismatch zero transition", async () => {
  await resetTables();
  const repo = createRepo();
  const fileId = "20000000-0000-4000-8000-000000000020";
  assert.equal((await repo.createReservedUploadLifecycle(createInput(fileId))).ok, true);
  assert.deepEqual(await repo.transitionUploadLifecycle(transitionInput(fileId, "reserved", "expired", { now: PLUS_ONE_HOUR })), {
    ok: false,
    data: null,
    error: { code: "state_transition_denied", status: 422 },
  });
  assert.equal((await repo.transitionUploadLifecycle(transitionInput(fileId, "reserved", "upload_started"))).ok, true);
  assert.deepEqual(await repo.transitionUploadLifecycle(transitionInput(fileId, "upload_started", "policy_blocked", { now: AT_EXPIRY })), {
    ok: false,
    data: null,
    error: { code: "state_transition_denied", status: 422 },
  });
  const uploaded = await repo.transitionUploadLifecycle(transitionInput(fileId, "upload_started", "uploaded_unconfirmed", {
    objectVersionId: "object-version-1",
  }));
  assert.equal(uploaded.ok, true);
  assert.deepEqual(await repo.transitionUploadLifecycle(transitionInput(fileId, "uploaded_unconfirmed", "confirmed", {
    objectVersionId: "object-version-2",
    verifiedChecksum: CHECKSUM_A,
    verifiedSizeBytes: 7,
  })), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } });
  assert.deepEqual(await repo.transitionUploadLifecycle(transitionInput(fileId, "uploaded_unconfirmed", "confirmed", {
    objectVersionId: "object-version-1",
    verifiedChecksum: CHECKSUM_B,
    verifiedSizeBytes: 7,
  })), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } });
  const confirmed = await repo.transitionUploadLifecycle(transitionInput(fileId, "uploaded_unconfirmed", "confirmed", {
    objectVersionId: "object-version-1",
    verifiedChecksum: CHECKSUM_A,
    verifiedSizeBytes: 7,
  }));
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.record.verified_checksum, CHECKSUM_A);

  const sameConfirmation = await repo.transitionUploadLifecycle(transitionInput(fileId, "uploaded_unconfirmed", "confirmed", {
    objectVersionId: "object-version-1",
    verifiedChecksum: CHECKSUM_A,
    verifiedSizeBytes: 7,
    now: "2026-07-25T10:00:00.000Z",
  }));
  assert.equal(sameConfirmation.ok, true);
  assert.equal(sameConfirmation.data.replayed, true);
  assert.deepEqual(sameConfirmation.data.record, confirmed.data.record);
});

test("policy decision CAS persists passed, blocked, and failed outcomes and exact replay creates no duplicate audit", async () => {
  await resetTables();
  const repo = createRepo();
  for (const [suffix, outcome, expectedState, expectedStatus] of [
    ["031", "passed", "confirmed", "passed"],
    ["032", "blocked", "policy_blocked", "blocked"],
    ["033", "failed", "confirmed", "failed"],
  ]) {
    const fileId = `20000000-0000-4000-8000-000000000${suffix}`;
    await createConfirmed(repo, fileId);
    const { input, audit } = policyInput(fileId, outcome);
    const result = await repo.compareAndSetPolicyDecision(input);
    assert.equal(result.ok, true);
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.record.upload_state, expectedState);
    assert.equal(result.data.record.file_policy_status, expectedStatus);
    assert.equal(result.data.record.policy_decision_replay.file_policy_status, expectedStatus);
    assert.equal(audit.published.length, 1);
  }

  const replayFile = "20000000-0000-4000-8000-000000000034";
  await createConfirmed(repo, replayFile);
  const first = policyInput(replayFile, "passed");
  const firstResult = await repo.compareAndSetPolicyDecision(first.input);
  assert.equal(firstResult.ok, true);
  const replayAudit = createAuditProbe();
  const replay = await repo.compareAndSetPolicyDecision({ ...first.input, metadataOnlyAudit: replayAudit.dependency });
  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.record, firstResult.data.record);
  assert.equal(await auditCount(replayFile, "policy_decision_compare_and_set"), 1);
  assert.equal(replayAudit.published.length, 0);
});

test("changed policy replay facts conflict without mutation or audit", async () => {
  await resetTables();
  const repo = createRepo();
  const fileId = "20000000-0000-4000-8000-000000000040";
  await createConfirmed(repo, fileId);
  const first = policyInput(fileId, "passed");
  assert.equal((await repo.compareAndSetPolicyDecision(first.input)).ok, true);
  const before = await repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: fileId });
  const changed = policyInput(fileId, "passed", {
    sanitizedResult: { policy: "pass", category: "different" },
  });
  assert.deepEqual(await repo.compareAndSetPolicyDecision(changed.input), {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409 },
  });
  assert.deepEqual(await repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: fileId }), before);
  assert.equal(await auditCount(fileId, "policy_decision_compare_and_set"), 1);
});

test("transaction boundary rolls back mutation when audit insert fails and rolls back audit when publish fails", async () => {
  await resetTables();
  const repo = createRepo();
  const auditFailFile = "20000000-0000-4000-8000-000000000050";
  await createConfirmed(repo, auditFailFile);
  const beforeAuditFailure = await repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: auditFailFile });
  await withClient((client) => client.query(
    "ALTER TABLE kai.upload_lifecycle_audit ADD CONSTRAINT adapter_test_fail_policy_audit CHECK (operation <> 'policy_decision_compare_and_set')",
  ));
  try {
    const result = await repo.compareAndSetPolicyDecision(policyInput(auditFailFile, "passed").input);
    assert.deepEqual(result, { ok: false, data: null, error: { code: "validation_blocker", status: 422 } });
  } finally {
    await withClient((client) => client.query("ALTER TABLE kai.upload_lifecycle_audit DROP CONSTRAINT adapter_test_fail_policy_audit"));
  }
  assert.deepEqual(await repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: auditFailFile }), beforeAuditFailure);

  const publishFailFile = "20000000-0000-4000-8000-000000000051";
  await createConfirmed(repo, publishFailFile);
  const beforePublishFailure = await repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: publishFailFile });
  const publishFailure = policyInput(publishFailFile, "passed", { audit: createAuditProbe({ publishThrows: true }) });
  assert.deepEqual(await repo.compareAndSetPolicyDecision(publishFailure.input), {
    ok: false,
    data: null,
    error: { code: "validation_blocker", status: 422 },
  });
  assert.deepEqual(await repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: publishFailFile }), beforePublishFailure);
  assert.equal(await auditCount(publishFailFile, "policy_decision_compare_and_set"), 0);
});

test("concurrent policy decisions converge for identical facts and expose one authority plus one conflict for changed facts", async () => {
  await resetTables();
  const repo = createRepo();
  const identicalFile = "20000000-0000-4000-8000-000000000060";
  await createConfirmed(repo, identicalFile);
  const identicalInput = policyInput(identicalFile, "passed");
  const identical = await Promise.all([
    repo.compareAndSetPolicyDecision(identicalInput.input),
    repo.compareAndSetPolicyDecision(identicalInput.input),
  ]);
  assert.deepEqual(identical.map((result) => result.ok).sort(), [true, true]);
  assert.equal(identical.filter((result) => result.data.replayed).length, 1);
  assert.equal(await auditCount(identicalFile, "policy_decision_compare_and_set"), 1);

  const conflictFile = "20000000-0000-4000-8000-000000000061";
  await createConfirmed(repo, conflictFile);
  const conflict = await Promise.all([
    repo.compareAndSetPolicyDecision(policyInput(conflictFile, "passed").input),
    repo.compareAndSetPolicyDecision(policyInput(conflictFile, "failed", {
      sanitizedResult: { status: "failed", category: "assessor_failed" },
    }).input),
  ]);
  assert.equal(conflict.filter((result) => result.ok).length, 1);
  assert.equal(conflict.filter((result) => result.error?.code === "conflict_current_state_changed").length, 1);
  assert.equal(await auditCount(conflictFile, "policy_decision_compare_and_set"), 1);
});

test("adapter failure envelopes expose no SQL, credentials, private paths, or stacks", async () => {
  await resetTables();
  const result = await createRepo().getUploadLifecycle({ organizationId: ORG, intakeFileId: "bad" });
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SELECT|INSERT|UPDATE|postgres:|DATABASE_URL|\/private|\/Users|stack|synthetic audit publish failure/i);
});

test("in-memory and PostgreSQL implementations agree on the callable lifecycle contract", async () => {
  await resetTables();
  const fileId = "20000000-0000-4000-8000-000000000070";
  const memory = createInMemoryUploadLifecycleRepository();
  const postgres = createRepo();
  for (const repo of [memory, postgres]) {
    assert.equal((await repo.createReservedUploadLifecycle(createInput(fileId))).ok, true);
    assert.equal((await repo.transitionUploadLifecycle(transitionInput(fileId, "reserved", "upload_started"))).ok, true);
    assert.equal((await repo.transitionUploadLifecycle(transitionInput(fileId, "upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
    }))).ok, true);
    assert.equal((await repo.transitionUploadLifecycle(transitionInput(fileId, "uploaded_unconfirmed", "confirmed", {
      objectVersionId: "object-version-1",
      verifiedChecksum: CHECKSUM_A,
      verifiedSizeBytes: 7,
    }))).ok, true);
    const policy = policyInput(fileId, "passed");
    assert.equal((await repo.compareAndSetPolicyDecision(policy.input)).ok, true);
  }
  const memoryRead = await memory.getUploadLifecycle({ organizationId: ORG, intakeFileId: fileId });
  const postgresRead = await postgres.getUploadLifecycle({ organizationId: ORG, intakeFileId: fileId });
  assert.deepEqual(postgresRead, memoryRead);
});
}
