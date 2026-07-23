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
const BEFORE_EXPIRY = "2026-07-24T09:59:59.999Z";
const AT_EXPIRY = "2026-07-24T10:00:00.000Z";
const AFTER_EXPIRY = "2026-07-24T10:00:00.001Z";
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

function readStoredRecord(repo) {
  const read = repo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  assert.equal(read.ok, true);
  return read.data.record;
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

test("pre-expiry transitions remain exact-replayable at and after expiry without mutation", () => {
  const repo = createRepoWithState("upload_started");
  const uploaded = repo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
      now: BEFORE_EXPIRY,
    }),
  );
  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.data.replayed, false);
  const storedBeforeReplay = readStoredRecord(repo);

  for (const now of [AT_EXPIRY, AFTER_EXPIRY]) {
    const replay = repo.transitionUploadLifecycle(
      transitionInput("upload_started", "uploaded_unconfirmed", {
        objectVersionId: "object-version-1",
        now,
      }),
    );

    assert.equal(replay.ok, true, now);
    assert.equal(replay.data.replayed, true, now);
    assert.deepEqual(replay.data.record, storedBeforeReplay, now);
    assert.deepEqual(readStoredRecord(repo), storedBeforeReplay, now);
    assert.equal(replay.data.record.upload_expires_at, AT_EXPIRY, now);
  }
});

test("uploaded_unconfirmed replay requires the same object version and never mutates stored state", () => {
  const replayRepo = createRepoWithState("upload_started");
  const uploaded = replayRepo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
      now: PLUS_ONE_HOUR,
    }),
  );
  assert.equal(uploaded.ok, true);
  const uploadedBefore = readStoredRecord(replayRepo);

  const replay = replayRepo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
      now: PLUS_TWO_HOURS,
    }),
  );

  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.record, uploadedBefore);
  assert.deepEqual(readStoredRecord(replayRepo), uploadedBefore);

  const conflictRepo = createRepoWithState("uploaded_unconfirmed");
  const conflictBefore = readStoredRecord(conflictRepo);

  const conflict = conflictRepo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-2",
      now: PLUS_TWO_HOURS,
    }),
  );

  assert.deepEqual(conflict, {
    ok: false,
    data: null,
    error: { code: "conflict_current_state_changed", status: 409 },
  });
  assert.deepEqual(readStoredRecord(conflictRepo), conflictBefore);
});

test("confirmed replay requires matching object version, checksum, and size without timestamp mutation", () => {
  const repo = createRepoWithState("confirmed");
  const before = readStoredRecord(repo);

  const replay = repo.transitionUploadLifecycle(
    transitionInput("uploaded_unconfirmed", "confirmed", {
      objectVersionId: "object-version-1",
      verifiedChecksum: CHECKSUM_A,
      verifiedSizeBytes: 7,
      now: PLUS_TWO_HOURS,
    }),
  );

  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.record, before);
  assert.deepEqual(readStoredRecord(repo), before);
});

test("confirmed replay fact conflicts are independent 409s and leave stored state unchanged", () => {
  const cases = [
    {
      name: "object version",
      overrides: { objectVersionId: "object-version-2" },
    },
    {
      name: "checksum",
      overrides: { verifiedChecksum: CHECKSUM_B },
    },
    {
      name: "size",
      overrides: { verifiedSizeBytes: 8 },
    },
  ];

  for (const { name, overrides } of cases) {
    const repo = createRepoWithState("confirmed");
    const before = readStoredRecord(repo);

    const result = repo.transitionUploadLifecycle(
      transitionInput("uploaded_unconfirmed", "confirmed", {
        objectVersionId: "object-version-1",
        verifiedChecksum: CHECKSUM_A,
        verifiedSizeBytes: 7,
        now: PLUS_TWO_HOURS,
        ...overrides,
      }),
    );

    assert.deepEqual(
      result,
      {
        ok: false,
        data: null,
        error: { code: "conflict_current_state_changed", status: 409 },
      },
      name,
    );
    assert.deepEqual(readStoredRecord(repo), before, `${name} conflict mutated stored record`);
  }
});

test("confirmation accepts zero size and rejects invalid size and checksum facts without mutation", () => {
  const zeroSizeRepo = createRepoWithState("uploaded_unconfirmed");
  const zeroSize = zeroSizeRepo.transitionUploadLifecycle(
    transitionInput("uploaded_unconfirmed", "confirmed", {
      objectVersionId: "object-version-1",
      verifiedChecksum: CHECKSUM_A,
      verifiedSizeBytes: 0,
      now: PLUS_TWO_HOURS,
    }),
  );

  assert.equal(zeroSize.ok, true);
  assert.equal(zeroSize.data.replayed, false);
  assert.equal(zeroSize.data.record.verified_size_bytes, 0);

  const cases = [
    {
      name: "negative size",
      overrides: { verifiedSizeBytes: -1 },
    },
    {
      name: "non-integer size",
      overrides: { verifiedSizeBytes: 7.5 },
    },
    {
      name: "uppercase checksum",
      overrides: { verifiedChecksum: CHECKSUM_A.toUpperCase() },
    },
  ];

  for (const { name, overrides } of cases) {
    const repo = createRepoWithState("uploaded_unconfirmed");
    const before = readStoredRecord(repo);

    const result = repo.transitionUploadLifecycle(
      transitionInput("uploaded_unconfirmed", "confirmed", {
        objectVersionId: "object-version-1",
        verifiedChecksum: CHECKSUM_A,
        verifiedSizeBytes: 7,
        now: PLUS_TWO_HOURS,
        ...overrides,
      }),
    );

    assert.deepEqual(
      result,
      {
        ok: false,
        data: null,
        error: { code: "validation_blocker", status: 422 },
      },
      name,
    );
    assert.deepEqual(readStoredRecord(repo), before, `${name} mutated stored record`);
  }
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

test("expiry denial precedes expected-state mismatch and unauthorized-edge checks", () => {
  const expectedMismatchRepo = createRepoWithState("upload_started");
  const expectedMismatchBefore = readStoredRecord(expectedMismatchRepo);

  const expectedMismatch = expectedMismatchRepo.transitionUploadLifecycle(
    transitionInput("reserved", "policy_blocked", { now: AT_EXPIRY }),
  );

  assert.deepEqual(expectedMismatch, {
    ok: false,
    data: null,
    error: { code: "state_transition_denied", status: 422 },
  });
  assert.deepEqual(readStoredRecord(expectedMismatchRepo), expectedMismatchBefore);

  const unauthorizedEdgeRepo = createRepoWithState("upload_started");
  const unauthorizedEdgeBefore = readStoredRecord(unauthorizedEdgeRepo);

  const unauthorizedEdge = unauthorizedEdgeRepo.transitionUploadLifecycle(
    transitionInput("upload_started", "confirmed", {
      objectVersionId: "object-version-1",
      verifiedChecksum: CHECKSUM_A,
      verifiedSizeBytes: 7,
      now: AFTER_EXPIRY,
    }),
  );

  assert.deepEqual(unauthorizedEdge, {
    ok: false,
    data: null,
    error: { code: "state_transition_denied", status: 422 },
  });
  assert.deepEqual(readStoredRecord(unauthorizedEdgeRepo), unauthorizedEdgeBefore);
});

test("expiry boundary permits pre-confirmation progression only before expiry", () => {
  const beforeExpiryRepo = createRepoWithState("upload_started");
  const beforeExpiry = beforeExpiryRepo.transitionUploadLifecycle(
    transitionInput("upload_started", "uploaded_unconfirmed", {
      objectVersionId: "object-version-1",
      now: BEFORE_EXPIRY,
    }),
  );

  assert.equal(beforeExpiry.ok, true);
  assert.equal(beforeExpiry.data.replayed, false);
  assert.equal(beforeExpiry.data.record.upload_state, "uploaded_unconfirmed");

  for (const now of [AT_EXPIRY, AFTER_EXPIRY]) {
    const repo = createRepoWithState("upload_started");
    const before = readStoredRecord(repo);

    const denied = repo.transitionUploadLifecycle(
      transitionInput("upload_started", "uploaded_unconfirmed", {
        objectVersionId: "object-version-1",
        now,
      }),
    );

    assert.deepEqual(
      denied,
      {
        ok: false,
        data: null,
        error: { code: "state_transition_denied", status: 422 },
      },
      now,
    );
    assert.deepEqual(readStoredRecord(repo), before, now);
  }
});

test("expired transition is allowed at and after expiry only from pre-confirmation states", () => {
  for (const sourceState of ["reserved", "upload_started", "uploaded_unconfirmed"]) {
    for (const now of [AT_EXPIRY, AFTER_EXPIRY]) {
      const repo = createRepoWithState(sourceState);

      const expired = repo.transitionUploadLifecycle(
        transitionInput(sourceState, "expired", { now }),
      );

      assert.equal(expired.ok, true, `${sourceState} at ${now}`);
      assert.equal(expired.data.replayed, false, `${sourceState} at ${now}`);
      assert.equal(expired.data.record.upload_state, "expired", `${sourceState} at ${now}`);
      assert.equal(expired.data.record.upload_expires_at, AT_EXPIRY, `${sourceState} at ${now}`);
    }
  }

  for (const sourceState of ["confirmed", "policy_blocked", "abandoned"]) {
    const repo = createRepoWithState(sourceState);
    const before = readStoredRecord(repo);

    const denied = repo.transitionUploadLifecycle(
      transitionInput(sourceState, "expired", { now: AFTER_EXPIRY }),
    );

    assert.deepEqual(
      denied,
      {
        ok: false,
        data: null,
        error: { code: "state_transition_denied", status: 422 },
      },
      sourceState,
    );
    assert.deepEqual(readStoredRecord(repo), before, sourceState);
  }
});

test("confirmed records do not expire when caller-supplied now is past upload expiry", () => {
  const repo = createRepoWithState("confirmed");
  const before = readStoredRecord(repo);

  const replay = repo.transitionUploadLifecycle(
    transitionInput("uploaded_unconfirmed", "confirmed", {
      objectVersionId: "object-version-1",
      verifiedChecksum: CHECKSUM_A,
      verifiedSizeBytes: 7,
      now: AFTER_EXPIRY,
    }),
  );

  assert.equal(replay.ok, true);
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.record, before);
  assert.deepEqual(readStoredRecord(repo), before);
  assert.equal(replay.data.record.upload_state, "confirmed");
  assert.equal(replay.data.record.upload_expires_at, AT_EXPIRY);
});

test("expiry denials and expired transitions retain readable records without expiry extension", () => {
  const deniedRepo = createRepoWithState("upload_started");
  const deniedBefore = readStoredRecord(deniedRepo);

  const denied = deniedRepo.transitionUploadLifecycle(
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
  const deniedReadback = deniedRepo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  assert.equal(deniedReadback.ok, true);
  assert.deepEqual(deniedReadback.data.record, deniedBefore);
  assert.equal(deniedReadback.data.record.upload_expires_at, AT_EXPIRY);

  const expiredRepo = createRepoWithState("uploaded_unconfirmed");
  const expiredBefore = readStoredRecord(expiredRepo);
  const expired = expiredRepo.transitionUploadLifecycle(
    transitionInput("uploaded_unconfirmed", "expired", { now: AFTER_EXPIRY }),
  );

  assert.equal(expired.ok, true);
  const expiredReadback = expiredRepo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  assert.equal(expiredReadback.ok, true);
  assert.equal(expiredReadback.data.record.upload_state, "expired");
  assert.equal(expiredReadback.data.record.upload_expires_at, expiredBefore.upload_expires_at);
  assert.equal(expiredReadback.data.record.object_version_id, expiredBefore.object_version_id);
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

test("success envelopes expose exact top-level and data shapes", () => {
  const repo = createInMemoryUploadLifecycleRepository();

  const created = repo.createReservedUploadLifecycle(BASE_CREATE);
  assert.deepEqual(Object.keys(created), ["ok", "data", "error"]);
  assert.equal(created.ok, true);
  assert.equal(created.error, null);
  assert.deepEqual(Object.keys(created.data), ["record", "replayed"]);
  assert.equal(typeof created.data.replayed, "boolean");

  const transitioned = repo.transitionUploadLifecycle(
    transitionInput("reserved", "upload_started", { now: PLUS_ONE_HOUR }),
  );
  assert.deepEqual(Object.keys(transitioned), ["ok", "data", "error"]);
  assert.equal(transitioned.ok, true);
  assert.equal(transitioned.error, null);
  assert.deepEqual(Object.keys(transitioned.data), ["record", "replayed"]);
  assert.equal(typeof transitioned.data.replayed, "boolean");

  const read = repo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  assert.deepEqual(Object.keys(read), ["ok", "data", "error"]);
  assert.equal(read.ok, true);
  assert.equal(read.error, null);
  assert.deepEqual(Object.keys(read.data), ["record"]);
  assert.equal(Object.hasOwn(read.data, "replayed"), false);
});

test("failure envelopes expose exact top-level and error shapes for every error class", () => {
  const cases = [
    {
      name: "validation_blocker",
      result: createInMemoryUploadLifecycleRepository().createReservedUploadLifecycle({
        ...BASE_CREATE,
        extra: true,
      }),
      code: "validation_blocker",
      status: 422,
    },
    {
      name: "state_transition_denied",
      result: createRepoWithState("reserved").transitionUploadLifecycle(
        transitionInput("reserved", "expired", { now: PLUS_ONE_HOUR }),
      ),
      code: "state_transition_denied",
      status: 422,
    },
    {
      name: "conflict_current_state_changed",
      result: createRepoWithState("upload_started").transitionUploadLifecycle(
        transitionInput("reserved", "policy_blocked"),
      ),
      code: "conflict_current_state_changed",
      status: 409,
    },
    {
      name: "not_found",
      result: createInMemoryUploadLifecycleRepository().getUploadLifecycle({
        organizationId: BASE_CREATE.organizationId,
        intakeFileId: BASE_CREATE.intakeFileId,
      }),
      code: "not_found",
      status: 404,
    },
  ];

  for (const { name, result, code, status } of cases) {
    assert.deepEqual(Object.keys(result), ["ok", "data", "error"], name);
    assert.equal(result.ok, false, name);
    assert.equal(result.data, null, name);
    assert.deepEqual(Object.keys(result.error), ["code", "status"], name);
    assert.equal(result.error.code, code, name);
    assert.equal(result.error.status, status, name);
  }
});

test("success records contain only authorized fields and no private storage boundary fields", () => {
  const repo = createInMemoryUploadLifecycleRepository();
  const authorizedFields = new Set([
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
  const prohibitedNormalizedKeys = new Set([
    "bucket",
    "objectkey",
    "path",
    "uri",
    "url",
    "signedurl",
    "rawbytes",
    "bytes",
    "buffer",
    "provider",
    "providerid",
    "provideridentifier",
    "providerprivateid",
    "providerprivateidentifier",
    "metadata",
    "unrestrictedmetadata",
  ]);

  const created = repo.createReservedUploadLifecycle(BASE_CREATE);
  assert.equal(created.ok, true);
  const read = repo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  assert.equal(read.ok, true);
  const transitioned = repo.transitionUploadLifecycle(
    transitionInput("reserved", "upload_started", { now: PLUS_ONE_HOUR }),
  );
  assert.equal(transitioned.ok, true);

  for (const [operationName, record] of [
    ["create", created.data.record],
    ["read", read.data.record],
    ["transition", transitioned.data.record],
  ]) {
    const recordKeys = Object.keys(record);
    assert.equal(
      recordKeys.every((key) => authorizedFields.has(key)),
      true,
      `${operationName} returned unauthorized keys: ${recordKeys.join(",")}`,
    );
    assert.equal(
      recordKeys.some((key) => {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        return prohibitedNormalizedKeys.has(normalized) || normalized.startsWith("provider");
      }),
      false,
      `${operationName} returned prohibited boundary keys: ${recordKeys.join(",")}`,
    );
  }
});

test("cross-tenant reads and transitions are indistinguishable from absent records", () => {
  const repo = createInMemoryUploadLifecycleRepository();
  assert.equal(repo.createReservedUploadLifecycle(BASE_CREATE).ok, true);

  const crossTenantRead = repo.getUploadLifecycle({
    organizationId: "org-2",
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  const absentRead = repo.getUploadLifecycle({
    organizationId: "org-2",
    intakeFileId: "absent-file",
  });
  assert.deepEqual(crossTenantRead, absentRead);
  assert.deepEqual(crossTenantRead, {
    ok: false,
    data: null,
    error: { code: "not_found", status: 404 },
  });

  const crossTenantTransition = repo.transitionUploadLifecycle({
    ...transitionInput("reserved", "upload_started"),
    organizationId: "org-2",
  });
  const absentTransition = repo.transitionUploadLifecycle({
    ...transitionInput("reserved", "upload_started"),
    organizationId: "org-2",
    intakeFileId: "absent-file",
  });
  assert.deepEqual(crossTenantTransition, absentTransition);
  assert.deepEqual(crossTenantTransition, {
    ok: false,
    data: null,
    error: { code: "not_found", status: 404 },
  });
});

test("returned lifecycle records are defensive copies across writes and reads", () => {
  const repo = createInMemoryUploadLifecycleRepository();
  const created = repo.createReservedUploadLifecycle(BASE_CREATE);
  assert.equal(created.ok, true);
  const originalCreatedRecord = { ...created.data.record };

  created.data.record.upload_state = "confirmed";
  created.data.record.organization_id = "mutated-org";
  created.data.record.verified_size_bytes = 999;

  const afterCreateMutation = repo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  assert.equal(afterCreateMutation.ok, true);
  assert.deepEqual(afterCreateMutation.data.record, originalCreatedRecord);

  const firstRead = repo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  const secondRead = repo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  assert.equal(firstRead.ok, true);
  assert.equal(secondRead.ok, true);
  assert.notStrictEqual(firstRead.data.record, secondRead.data.record);

  firstRead.data.record.upload_state = "confirmed";
  firstRead.data.record.intake_batch_id = "mutated-batch";
  assert.deepEqual(secondRead.data.record, originalCreatedRecord);

  const finalRead = repo.getUploadLifecycle({
    organizationId: BASE_CREATE.organizationId,
    intakeFileId: BASE_CREATE.intakeFileId,
  });
  assert.equal(finalRead.ok, true);
  assert.deepEqual(finalRead.data.record, originalCreatedRecord);
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
