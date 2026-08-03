import test from "node:test";
import assert from "node:assert/strict";

import { Client } from "pg";
import { createInMemoryUploadLifecycleRepository } from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";
import { createPostgresUploadLifecycleRepository } from "../Backend/kai/upload/postgresUploadLifecycleRepository.js";

const DATABASE_URL = process.env.KAI_P0_POSTGRES_ADAPTER_DATABASE_URL;
const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
const BATCH = "10000000-0000-4000-8000-000000000001";
const OTHER_BATCH = "10000000-0000-4000-8000-000000000099";
const NOW = "2026-07-23T10:00:00.000Z";
const PLUS_ONE_HOUR = "2026-07-23T11:00:00.000Z";
const PLUS_TWO_HOURS = "2026-07-23T12:00:00.000Z";
const POLICY_NOW = "2026-07-23T13:00:00.000Z";
const BEFORE_EXPIRY = "2026-07-24T09:59:59.999Z";
const AT_EXPIRY = "2026-07-24T10:00:00.000Z";
const CHECKSUM_A = "a".repeat(64);
const CHECKSUM_B = "b".repeat(64);

const AUTHORIZED_EDGES = Object.freeze([
  ["reserved", "upload_started"],
  ["reserved", "policy_blocked"],
  ["reserved", "abandoned"],
  ["reserved", "expired"],
  ["upload_started", "uploaded_unconfirmed"],
  ["upload_started", "policy_blocked"],
  ["upload_started", "abandoned"],
  ["upload_started", "expired"],
  ["uploaded_unconfirmed", "confirmed"],
  ["uploaded_unconfirmed", "policy_blocked"],
  ["uploaded_unconfirmed", "abandoned"],
  ["uploaded_unconfirmed", "expired"],
  ["confirmed", "policy_blocked"],
]);

function fileIdFrom(number) {
  return `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

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
  if (!DATABASE_URL) return;
  await withClient((client) => client.query("TRUNCATE kai.upload_lifecycle_audit, kai.upload_policy_decision_replay, kai.intake_files"));
}

function createInput(fileId, overrides = {}) {
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
    now: overrides.now || PLUS_ONE_HOUR,
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
            if (publishThrows) throw new Error("synthetic unexpected dependency failure /private/path");
            published.push(input);
          },
        };
      },
    },
  };
}

function policyInput(fileId, outcome, overrides = {}) {
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
      expectedFilePolicyStatus: "pending",
      policyDecisionOutcome: outcome,
      sanitizedResult: overrides.sanitizedResult || {
        policy: outcome === "passed" ? "pass" : outcome,
        category: outcome === "blocked" ? "unsupported_extension" : "encoding_gate_pass",
      },
      metadataOnlyAudit: audit.dependency,
      now: overrides.now || POLICY_NOW,
    },
    audit,
  };
}

async function seedMetadataRow(fileId, overrides = {}) {
  if (!DATABASE_URL) return;
  const input = createInput(fileId, overrides);
  await withClient((client) => client.query(
    `INSERT INTO kai.intake_files (
       intake_file_id, intake_batch_id, organization_id, original_filename, safe_filename,
       checksum, hash_algorithm, force_new_version, processing_status, parse_status,
       file_policy_status, created_at
     )
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'sha256', true, 'quarantined', 'quarantined', 'pending', $7::timestamptz)`,
    [
      input.intakeFileId,
      input.intakeBatchId,
      input.organizationId,
      `parity-${fileId}.txt`,
      `parity-${fileId}.txt`,
      overrides.checksum || CHECKSUM_A,
      input.now,
    ],
  ));
}

function implementations() {
  const entries = [{ name: "in-memory", repo: createInMemoryUploadLifecycleRepository(), needsSeed: false }];
  if (DATABASE_URL) {
    entries.push({ name: "postgres", repo: createPostgresUploadLifecycleRepository(), needsSeed: true });
  }
  return entries;
}

async function prepareReservation(impl, fileId, overrides = {}) {
  if (impl.needsSeed) await seedMetadataRow(fileId, overrides);
  return impl.repo.createReservedUploadLifecycle(createInput(fileId, overrides));
}

async function createState(impl, fileId, state) {
  assert.equal((await prepareReservation(impl, fileId)).ok, true);
  if (state === "reserved") return;
  if (state === "expired") {
    assert.equal((await impl.repo.transitionUploadLifecycle(transitionInput(fileId, "reserved", "expired", { now: AT_EXPIRY }))).ok, true);
    return;
  }
  if (state === "policy_blocked" || state === "abandoned") {
    assert.equal((await impl.repo.transitionUploadLifecycle(transitionInput(fileId, "reserved", state))).ok, true);
    return;
  }
  assert.equal((await impl.repo.transitionUploadLifecycle(transitionInput(fileId, "reserved", "upload_started"))).ok, true);
  if (state === "upload_started") return;
  assert.equal((await impl.repo.transitionUploadLifecycle(transitionInput(fileId, "upload_started", "uploaded_unconfirmed", {
    objectVersionId: "object-version-1",
    now: BEFORE_EXPIRY,
  }))).ok, true);
  if (state === "uploaded_unconfirmed") return;
  assert.equal((await impl.repo.transitionUploadLifecycle(transitionInput(fileId, "uploaded_unconfirmed", "confirmed", {
    objectVersionId: "object-version-1",
    verifiedChecksum: CHECKSUM_A,
    verifiedSizeBytes: 7,
    now: PLUS_TWO_HOURS,
  }))).ok, true);
}

async function auditCount(fileId, operation) {
  if (!DATABASE_URL) return 0;
  const result = await withClient((client) => client.query(
    "SELECT count(*)::integer AS count FROM kai.upload_lifecycle_audit WHERE intake_file_id = $1::uuid AND operation = $2",
    [fileId, operation],
  ));
  return result.rows[0].count;
}

test("upload lifecycle implementations expose complete callable surface and validation envelopes", async () => {
  await resetTables();
  for (const impl of implementations()) {
    assert.deepEqual(Object.keys(impl.repo), [
      "createReservedUploadLifecycle",
      "getUploadLifecycle",
      "transitionUploadLifecycle",
      "compareAndSetPolicyDecision",
    ], impl.name);
    assert.deepEqual(await impl.repo.createReservedUploadLifecycle({}), {
      ok: false,
      data: null,
      error: { code: "validation_blocker", status: 422 },
    }, impl.name);
  }
});

test("upload lifecycle implementations preserve tenant/batch scoping, existing-row creation, replay, and changed facts", async () => {
  await resetTables();
  let suffix = 10;
  for (const impl of implementations()) {
    const fileId = fileIdFrom(suffix++);
    const missing = await impl.repo.getUploadLifecycle({ organizationId: OTHER_ORG, intakeFileId: fileId });
    assert.deepEqual(missing, { ok: false, data: null, error: { code: "not_found", status: 404 } }, impl.name);

    const created = await prepareReservation(impl, fileId);
    assert.equal(created.ok, true, impl.name);
    assert.equal(created.data.replayed, false, impl.name);

    const replay = await impl.repo.createReservedUploadLifecycle(createInput(fileId, { now: PLUS_TWO_HOURS }));
    assert.equal(replay.ok, true, impl.name);
    assert.equal(replay.data.replayed, true, impl.name);
    assert.deepEqual(replay.data.record, created.data.record, impl.name);

    assert.deepEqual(await impl.repo.createReservedUploadLifecycle(createInput(fileId, { intakeBatchId: OTHER_BATCH })), {
      ok: false,
      data: null,
      error: { code: "conflict_current_state_changed", status: 409 },
    }, impl.name);
  }
});

test("upload lifecycle implementations align on expiry, allowed transitions, denied transitions, confirmation, and checksum mismatch", async () => {
  await resetTables();
  let suffix = 20;
  for (const impl of implementations()) {
    for (const [from, to] of AUTHORIZED_EDGES) {
      if (impl.needsSeed) await resetTables();
      const fileId = fileIdFrom(suffix++);
      await createState(impl, fileId, from);
      const overrides = {};
      if (to === "uploaded_unconfirmed") overrides.objectVersionId = "object-version-1";
      if (to === "confirmed") {
        overrides.objectVersionId = "object-version-1";
        overrides.verifiedChecksum = CHECKSUM_A;
        overrides.verifiedSizeBytes = 7;
      }
      if (to === "expired") overrides.now = AT_EXPIRY;
      const result = await impl.repo.transitionUploadLifecycle(transitionInput(fileId, from, to, overrides));
      assert.equal(result.ok, true, `${impl.name} ${from}->${to}`);
    }

    const deniedFile = fileIdFrom(suffix++);
    if (impl.needsSeed) await resetTables();
    await createState(impl, deniedFile, "reserved");
    assert.deepEqual(await impl.repo.transitionUploadLifecycle(transitionInput(deniedFile, "reserved", "expired", { now: PLUS_ONE_HOUR })), {
      ok: false,
      data: null,
      error: { code: "state_transition_denied", status: 422 },
    }, impl.name);

    const checksumFile = fileIdFrom(suffix++);
    if (impl.needsSeed) await resetTables();
    await createState(impl, checksumFile, "confirmed");
    const before = await impl.repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: checksumFile });
    const auditBefore = impl.needsSeed ? await auditCount(checksumFile, "confirm_upload") : 0;
    assert.deepEqual(await impl.repo.transitionUploadLifecycle(transitionInput(checksumFile, "uploaded_unconfirmed", "confirmed", {
      objectVersionId: "object-version-1",
      verifiedChecksum: CHECKSUM_B,
      verifiedSizeBytes: 7,
    })), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }, impl.name);
    assert.deepEqual(await impl.repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: checksumFile }), before, impl.name);
    if (impl.needsSeed) assert.equal(await auditCount(checksumFile, "confirm_upload"), auditBefore);
  }
});

test("upload lifecycle implementations align on policy decisions, replays, changed facts, and audit atomicity", async () => {
  await resetTables();
  let suffix = 70;
  for (const impl of implementations()) {
    for (const [outcome, expectedState, expectedStatus] of [
      ["passed", "confirmed", "passed"],
      ["blocked", "policy_blocked", "blocked"],
      ["failed", "confirmed", "failed"],
    ]) {
      const fileId = fileIdFrom(suffix++);
      await createState(impl, fileId, "confirmed");
      const policy = policyInput(fileId, outcome);
      const result = await impl.repo.compareAndSetPolicyDecision(policy.input);
      assert.equal(result.ok, true, `${impl.name} ${outcome}`);
      assert.equal(result.data.record.upload_state, expectedState, `${impl.name} ${outcome}`);
      assert.equal(result.data.record.file_policy_status, expectedStatus, `${impl.name} ${outcome}`);
      assert.equal(policy.audit.published.length, 1, `${impl.name} ${outcome}`);
    }

    const replayFile = fileIdFrom(suffix++);
    await createState(impl, replayFile, "confirmed");
    const first = policyInput(replayFile, "passed");
    const firstResult = await impl.repo.compareAndSetPolicyDecision(first.input);
    assert.equal(firstResult.ok, true, impl.name);
    const replayAudit = createAuditProbe();
    const replay = await impl.repo.compareAndSetPolicyDecision({ ...first.input, metadataOnlyAudit: replayAudit.dependency, now: PLUS_TWO_HOURS });
    assert.equal(replay.ok, true, impl.name);
    assert.equal(replay.data.replayed, true, impl.name);
    assert.equal(replayAudit.published.length, 0, impl.name);

    const changedAudit = createAuditProbe();
    assert.deepEqual(await impl.repo.compareAndSetPolicyDecision({
      ...first.input,
      confirmedFileFacts: { ...first.input.confirmedFileFacts, verifiedSizeBytes: 8 },
      metadataOnlyAudit: changedAudit.dependency,
    }), { ok: false, data: null, error: { code: "conflict_current_state_changed", status: 409 } }, impl.name);
    assert.equal(changedAudit.published.length, 0, impl.name);

    const auditFailureFile = fileIdFrom(suffix++);
    await createState(impl, auditFailureFile, "confirmed");
    const before = await impl.repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: auditFailureFile });
    const auditFailure = policyInput(auditFailureFile, "passed", { audit: createAuditProbe({ prepareOk: false }) });
    assert.deepEqual(await impl.repo.compareAndSetPolicyDecision(auditFailure.input), {
      ok: false,
      data: null,
      error: { code: "validation_blocker", status: 422 },
    }, impl.name);
    assert.deepEqual(await impl.repo.getUploadLifecycle({ organizationId: ORG, intakeFileId: auditFailureFile }), before, impl.name);
    assert.equal(auditFailure.audit.published.length, 0, impl.name);
  }
});

test("PostgreSQL adapter maps unexpected dependency failures to safe system_error", async (t) => {
  if (!DATABASE_URL) {
    t.skip("requires runner-owned PostgreSQL target");
    return;
  }
  await resetTables();
  const repo = createPostgresUploadLifecycleRepository();
  const fileId = fileIdFrom(120);
  await seedMetadataRow(fileId);
  await createState({ name: "postgres", repo, needsSeed: false }, fileId, "confirmed");
  const result = await repo.compareAndSetPolicyDecision(policyInput(fileId, "passed", {
    audit: createAuditProbe({ publishThrows: true }),
  }).input);
  assert.deepEqual(result, { ok: false, data: null, error: { code: "system_error", status: 500 } });
  assert.doesNotMatch(JSON.stringify(result), /SELECT|INSERT|UPDATE|postgres:|DATABASE_URL|\/private|\/Users|stack/i);
});
