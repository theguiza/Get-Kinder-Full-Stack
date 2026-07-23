import test from "node:test";
import assert from "node:assert/strict";

import { KAI_SPRINT2_P0_UPLOAD_STATES } from "../Backend/kai/config/kaiSprint2P0Contract.js";
import { createInMemoryUploadLifecycleRepository } from "../Backend/kai/upload/inMemoryUploadLifecycleRepository.js";
import { createUploadLifecycleRepository } from "../Backend/kai/upload/uploadLifecycleRepository.js";

const BASE_CREATE = Object.freeze({
  organizationId: "org-1",
  intakeBatchId: "batch-1",
  intakeFileId: "file-1",
  now: "2026-07-23T10:00:00.000Z",
});

const PLUS_ONE_HOUR = "2026-07-23T11:00:00.000Z";
const PLUS_TWO_HOURS = "2026-07-23T12:00:00.000Z";
const AT_EXPIRY = "2026-07-24T10:00:00.000Z";
const CHECKSUM_A = "a".repeat(64);

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

const AUTHORIZED_EDGE_KEYS = Object.freeze(new Set(AUTHORIZED_EDGES.map(([from, to]) => `${from}->${to}`)));

function transitionInput(expectedUploadState, newUploadState, overrides = {}) {
  return {
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
    expectedUploadState,
    newUploadState,
    now: PLUS_ONE_HOUR,
    ...overrides,
  };
}

function createRepoWithState(state) {
  const repo = createInMemoryUploadLifecycleRepository();
  assert.equal(repo.createReservedUploadLifecycle(BASE_CREATE).ok, true);

  if (state === "reserved") return repo;

  if (state === "policy_blocked" || state === "abandoned") {
    assert.equal(
      repo.transitionUploadLifecycle(transitionInput("reserved", state)).ok,
      true,
    );
    return repo;
  }

  if (state === "expired") {
    assert.equal(
      repo.transitionUploadLifecycle(transitionInput("reserved", "expired", { now: AT_EXPIRY })).ok,
      true,
    );
    return repo;
  }

  assert.equal(
    repo.transitionUploadLifecycle(transitionInput("reserved", "upload_started")).ok,
    true,
  );
  if (state === "upload_started") return repo;

  assert.equal(
    repo.transitionUploadLifecycle(
      transitionInput("upload_started", "uploaded_unconfirmed", {
        objectVersionId: "object-version-1",
      }),
    ).ok,
    true,
  );
  if (state === "uploaded_unconfirmed") return repo;

  assert.equal(
    repo.transitionUploadLifecycle(
      transitionInput("uploaded_unconfirmed", "confirmed", {
        objectVersionId: "object-version-1",
        verifiedChecksum: CHECKSUM_A,
        verifiedSizeBytes: 7,
      }),
    ).ok,
    true,
  );
  return repo;
}

test("DI factory exposes exactly the three authorized operations", () => {
  const operations = {
    createReservedUploadLifecycle() {},
    getUploadLifecycle() {},
    transitionUploadLifecycle() {},
  };

  const repo = createUploadLifecycleRepository(operations);

  assert.deepEqual(Object.keys(repo), [
    "createReservedUploadLifecycle",
    "getUploadLifecycle",
    "transitionUploadLifecycle",
  ]);
  assert.throws(
    () => createUploadLifecycleRepository({ ...operations, listUploadLifecycles() {} }),
    /invalid operation set/,
  );
});

test("creation creates exactly the synthetic reserved lifecycle record", () => {
  const repo = createInMemoryUploadLifecycleRepository();
  const result = repo.createReservedUploadLifecycle(BASE_CREATE);

  assert.equal(result.ok, true);
  assert.equal(result.data.replayed, false);
  assert.deepEqual(Object.keys(result.data.record), [
    "organization_id",
    "intake_batch_id",
    "intake_file_id",
    "upload_state",
    "file_policy_status",
    "upload_state_changed_at",
    "upload_expires_at",
    "object_version_id",
    "verified_checksum",
    "verified_size_bytes",
    "verified_at",
    "created_at",
  ]);
  assert.deepEqual(result.data.record, {
    organization_id: "org-1",
    intake_batch_id: "batch-1",
    intake_file_id: "file-1",
    upload_state: "reserved",
    file_policy_status: "pending",
    upload_state_changed_at: "2026-07-23T10:00:00.000Z",
    upload_expires_at: "2026-07-24T10:00:00.000Z",
    object_version_id: null,
    verified_checksum: null,
    verified_size_bytes: null,
    verified_at: null,
    created_at: "2026-07-23T10:00:00.000Z",
  });
  assert.equal(KAI_SPRINT2_P0_UPLOAD_STATES.includes(result.data.record.upload_state), true);
});

test("creation replay returns the existing record without extending expiry", () => {
  const repo = createInMemoryUploadLifecycleRepository();
  const first = repo.createReservedUploadLifecycle(BASE_CREATE);
  const replay = repo.createReservedUploadLifecycle({
    ...BASE_CREATE,
    now: "2026-07-23T13:00:00.000Z",
  });

  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.record, first.data.record);
});

test("creation conflicts on the same scoped file with a different batch", () => {
  const repo = createInMemoryUploadLifecycleRepository();
  assert.equal(repo.createReservedUploadLifecycle(BASE_CREATE).ok, true);

  const result = repo.createReservedUploadLifecycle({
    ...BASE_CREATE,
    intakeBatchId: "batch-2",
  });

  assert.deepEqual(result, {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409 },
  });
});

test("read is scoped by organization and intake file and returns defensive copies", () => {
  const repo = createInMemoryUploadLifecycleRepository();
  assert.equal(repo.createReservedUploadLifecycle(BASE_CREATE).ok, true);

  const missing = repo.getUploadLifecycle({ organizationId: "org-2", intakeFileId: "file-1" });
  assert.deepEqual(missing, {
    ok: false,
    data: null,
    error: { code: "not_found", status: 404 },
  });

  const read = repo.getUploadLifecycle({ organizationId: "org-1", intakeFileId: "file-1" });
  read.data.record.upload_state = "confirmed";

  const reread = repo.getUploadLifecycle({ organizationId: "org-1", intakeFileId: "file-1" });
  assert.equal(reread.data.record.upload_state, "reserved");
});

test("all and only the thirteen directed edges are authorized", () => {
  assert.equal(AUTHORIZED_EDGES.length, 13);

  for (const [from, to] of AUTHORIZED_EDGES) {
    const repo = createRepoWithState(from);
    const overrides = {};
    if (to === "uploaded_unconfirmed") overrides.objectVersionId = "object-version-1";
    if (to === "confirmed") {
      overrides.objectVersionId = "object-version-1";
      overrides.verifiedChecksum = CHECKSUM_A;
      overrides.verifiedSizeBytes = 7;
    }
    if (to === "expired") overrides.now = AT_EXPIRY;

    const result = repo.transitionUploadLifecycle(transitionInput(from, to, overrides));

    assert.equal(result.ok, true, `${from} -> ${to}`);
    assert.equal(result.data.replayed, false);
    assert.equal(result.data.record.upload_state, to);
    if (to === "policy_blocked") assert.equal(result.data.record.file_policy_status, "blocked");
  }

  const unauthorized = createRepoWithState("confirmed").transitionUploadLifecycle(
    transitionInput("confirmed", "expired", { now: AT_EXPIRY }),
  );
  assert.deepEqual(unauthorized, {
    ok: false,
    data: null,
    error: { code: "state_transition_denied", status: 422 },
  });
});

test("all twenty-nine unauthorized directed lifecycle edges are denied without mutation", () => {
  assert.equal(KAI_SPRINT2_P0_UPLOAD_STATES.length, 7);
  assert.equal(AUTHORIZED_EDGES.length, 13);

  const directedNonSelfPairs = KAI_SPRINT2_P0_UPLOAD_STATES.flatMap((from) =>
    KAI_SPRINT2_P0_UPLOAD_STATES
      .filter((to) => to !== from)
      .map((to) => [from, to]),
  );
  const unauthorizedEdges = directedNonSelfPairs.filter(
    ([from, to]) => !AUTHORIZED_EDGE_KEYS.has(`${from}->${to}`),
  );

  assert.equal(directedNonSelfPairs.length, 42);
  assert.equal(unauthorizedEdges.length, 29);
  assert.deepEqual(
    unauthorizedEdges.filter(([from]) =>
      ["policy_blocked", "abandoned", "expired"].includes(from),
    ),
    [
      ["policy_blocked", "reserved"],
      ["policy_blocked", "upload_started"],
      ["policy_blocked", "uploaded_unconfirmed"],
      ["policy_blocked", "confirmed"],
      ["policy_blocked", "abandoned"],
      ["policy_blocked", "expired"],
      ["abandoned", "reserved"],
      ["abandoned", "upload_started"],
      ["abandoned", "uploaded_unconfirmed"],
      ["abandoned", "confirmed"],
      ["abandoned", "policy_blocked"],
      ["abandoned", "expired"],
      ["expired", "reserved"],
      ["expired", "upload_started"],
      ["expired", "uploaded_unconfirmed"],
      ["expired", "confirmed"],
      ["expired", "policy_blocked"],
      ["expired", "abandoned"],
    ],
  );

  for (const [from, to] of unauthorizedEdges) {
    const repo = createRepoWithState(from);
    const before = repo.getUploadLifecycle({
      organizationId: BASE_CREATE.organizationId,
      intakeFileId: BASE_CREATE.intakeFileId,
    });
    assert.equal(before.ok, true, `${from} -> ${to} setup`);

    const overrides = {};
    if (to === "uploaded_unconfirmed" || to === "confirmed") {
      overrides.objectVersionId = "object-version-1";
    }
    if (to === "confirmed") {
      overrides.verifiedChecksum = CHECKSUM_A;
      overrides.verifiedSizeBytes = 7;
    }

    const result = repo.transitionUploadLifecycle(transitionInput(from, to, overrides));

    assert.deepEqual(
      result,
      {
        ok: false,
        data: null,
        error: {
          code: "state_transition_denied",
          status: 422,
        },
      },
      `${from} -> ${to}`,
    );

    const after = repo.getUploadLifecycle({
      organizationId: BASE_CREATE.organizationId,
      intakeFileId: BASE_CREATE.intakeFileId,
    });
    assert.equal(after.ok, true, `${from} -> ${to} readback`);
    assert.deepEqual(after.data.record, before.data.record, `${from} -> ${to} mutated stored record`);
  }
});

test("uploaded and confirmed transitions enforce immutable object and integrity facts", () => {
  const repo = createRepoWithState("upload_started");

  const uploaded = repo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
    }),
  );
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.data.record.object_version_id, "object-version-1");

  const wrongObject = repo.transitionUploadLifecycle(
    transitionInput("uploaded_unconfirmed", "confirmed", {
      objectVersionId: "object-version-2",
      verifiedChecksum: CHECKSUM_A,
      verifiedSizeBytes: 7,
    }),
  );
  assert.deepEqual(wrongObject, {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409 },
  });

  const confirmed = repo.transitionUploadLifecycle(
    transitionInput("uploaded_unconfirmed", "confirmed", {
      objectVersionId: "object-version-1",
      verifiedChecksum: CHECKSUM_A,
      verifiedSizeBytes: 7,
      now: PLUS_TWO_HOURS,
    }),
  );
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.data.record.verified_at, PLUS_TWO_HOURS);
  assert.equal(confirmed.data.record.upload_state_changed_at, PLUS_TWO_HOURS);
});

test("transition replay runs before expiry and does not alter timestamps", () => {
  const repo = createRepoWithState("upload_started");
  const uploaded = repo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
      now: PLUS_ONE_HOUR,
    }),
  );

  const replay = repo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
      now: "2026-07-25T10:00:00.000Z",
    }),
  );

  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.record, uploaded.data.record);
});

test("same-target replay fact conflicts and expected-state conflicts return 409", () => {
  const repo = createRepoWithState("uploaded_unconfirmed");

  const factConflict = repo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "different-object-version",
    }),
  );
  assert.deepEqual(factConflict, {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409 },
  });

  const expectedConflict = repo.transitionUploadLifecycle(
    transitionInput("reserved", "policy_blocked"),
  );
  assert.deepEqual(expectedConflict, {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409 },
  });
});

test("non-replay pre-confirmation expiry allows only the expired transition", () => {
  const repo = createRepoWithState("upload_started");

  const denied = repo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
      now: AT_EXPIRY,
    }),
  );
  assert.deepEqual(denied, {
    ok: false,
    data: null,
    error: { code: "state_transition_denied", status: 422 },
  });

  const expired = repo.transitionUploadLifecycle(
    transitionInput("upload_started", "expired", { now: AT_EXPIRY }),
  );
  assert.equal(expired.ok, true);
  assert.equal(expired.data.record.upload_state, "expired");
});

test("validation blockers cover malformed inputs and transition facts", () => {
  const repo = createInMemoryUploadLifecycleRepository();

  assert.deepEqual(repo.createReservedUploadLifecycle({ ...BASE_CREATE, extra: true }), {
    ok: false,
    data: null,
    error: { code: "validation_blocker", status: 422 },
  });
  assert.deepEqual(repo.getUploadLifecycle({ organizationId: "org-1" }), {
    ok: false,
    data: null,
    error: { code: "validation_blocker", status: 422 },
  });
  assert.deepEqual(
    repo.transitionUploadLifecycle(
      transitionInput("uploaded_unconfirmed", "confirmed", {
        objectVersionId: "object-version-1",
        verifiedChecksum: CHECKSUM_A.toUpperCase(),
        verifiedSizeBytes: 7,
      }),
    ),
    {
      ok: false,
      data: null,
      error: { code: "validation_blocker", status: 422 },
    },
  );
});

test("repository instances share no in-memory state", () => {
  const first = createInMemoryUploadLifecycleRepository();
  const second = createInMemoryUploadLifecycleRepository();
  assert.equal(first.createReservedUploadLifecycle(BASE_CREATE).ok, true);

  assert.deepEqual(second.getUploadLifecycle({ organizationId: "org-1", intakeFileId: "file-1" }), {
    ok: false,
    data: null,
    error: { code: "not_found", status: 404 },
  });
});
