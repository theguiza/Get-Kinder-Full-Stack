import assert from "node:assert/strict";
import test from "node:test";

import {
  ORGANIZATION_JOIN_REQUEST_DECISIONS,
  ORGANIZATION_JOIN_REQUEST_STATUSES,
  getOrganizationJoinRequestForOrganization,
  getPendingOrganizationJoinRequestForRequester,
  insertPendingOrganizationJoinRequest,
  listOrganizationJoinRequestsForRequester,
  listPendingOrganizationJoinRequestsForOrganization,
  recordOrganizationJoinRequestDecision,
} from "../Backend/kai/db/kaiOrganizationJoinRequestQueries.js";

const ORG_A = "00000000-0000-4000-8000-00000000000a";
const REQUESTER = "90000000-0000-4000-8000-000000000001";
const REVIEWER = "90000000-0000-4000-8000-000000000002";
const REQUEST_ID = "00000000-0000-4000-8000-000000000301";

function row(overrides = {}) {
  return {
    organization_join_request_id: REQUEST_ID,
    organization_id: ORG_A,
    requester_user_id: REQUESTER,
    status: "pending",
    created_at: "2026-09-24T00:00:00.000Z",
    reviewed_at: null,
    reviewed_by_user_id: null,
    updated_at: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

function recordingDb(result = { rows: [row()] }) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function pgError(code, constraint) {
  return Object.assign(new Error(`pg ${code}`), { code, constraint });
}

test("lifecycle vocabulary is pending/approved/declined and only approved/declined are decisions", () => {
  assert.deepEqual([...ORGANIZATION_JOIN_REQUEST_STATUSES], ["pending", "approved", "declined"]);
  assert.deepEqual([...ORGANIZATION_JOIN_REQUEST_DECISIONS], ["approved", "declined"]);
  assert.ok(Object.isFrozen(ORGANIZATION_JOIN_REQUEST_STATUSES));
});

test("insert writes only organization_id and requester_user_id - no role, no name", async () => {
  const db = recordingDb();
  const result = await insertPendingOrganizationJoinRequest(
    { organizationId: ORG_A, requesterUserId: REQUESTER, roleName: "client_admin", organizationName: "Acme" },
    db,
  );
  assert.equal(result.ok, true);
  assert.equal(result.joinRequest.status, "pending");
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /INSERT INTO kai\.organization_join_requests \(organization_id, requester_user_id\)/);
  assert.deepEqual(db.calls[0].params, [ORG_A, REQUESTER]);
  assert.doesNotMatch(db.calls[0].text, /role|name/i);
});

test("insert refuses missing identifiers without querying", async () => {
  const db = recordingDb();
  assert.deepEqual(await insertPendingOrganizationJoinRequest({ organizationId: ORG_A }, db), {
    ok: false,
    error_code: "invalid_join_request_fields",
  });
  assert.deepEqual(await insertPendingOrganizationJoinRequest({ requesterUserId: REQUESTER }, db), {
    ok: false,
    error_code: "invalid_join_request_fields",
  });
  assert.equal(db.calls.length, 0);
});

test("insert maps unique/FK/check violations to stable error codes and rethrows anything else", async () => {
  const input = { organizationId: ORG_A, requesterUserId: REQUESTER };
  assert.deepEqual(await insertPendingOrganizationJoinRequest(input, recordingDb(pgError("23505"))), {
    ok: false,
    error_code: "pending_request_exists",
  });
  assert.deepEqual(await insertPendingOrganizationJoinRequest(input, recordingDb(pgError("23503"))), {
    ok: false,
    error_code: "invalid_reference",
  });
  assert.deepEqual(await insertPendingOrganizationJoinRequest(input, recordingDb(pgError("22P02"))), {
    ok: false,
    error_code: "invalid_join_request_fields",
  });
  await assert.rejects(insertPendingOrganizationJoinRequest(input, recordingDb(pgError("57P01"))), /pg 57P01/);
});

test("reads are scoped by organization_id and request/requester identity", async () => {
  const db = recordingDb();
  await getOrganizationJoinRequestForOrganization({ organizationId: ORG_A, organizationJoinRequestId: REQUEST_ID }, db);
  assert.match(db.calls[0].text, /WHERE organization_id = \$1\s+AND organization_join_request_id = \$2/);
  assert.deepEqual(db.calls[0].params, [ORG_A, REQUEST_ID]);

  await getPendingOrganizationJoinRequestForRequester({ organizationId: ORG_A, requesterUserId: REQUESTER }, db);
  assert.match(db.calls[1].text, /organization_id = \$1\s+AND requester_user_id = \$2\s+AND status = 'pending'/);
  assert.deepEqual(db.calls[1].params, [ORG_A, REQUESTER]);

  assert.equal(await getOrganizationJoinRequestForOrganization({ organizationId: ORG_A }, db), null);
  assert.equal(await getPendingOrganizationJoinRequestForRequester({ requesterUserId: REQUESTER }, db), null);
  assert.equal(db.calls.length, 2);
});

test("list helpers are deterministic and bound the limit to 1..100", async () => {
  const db = recordingDb({ rows: [] });
  await listOrganizationJoinRequestsForRequester({ requesterUserId: REQUESTER, limit: 10_000 }, db);
  assert.match(db.calls[0].text, /WHERE requester_user_id = \$1\s+ORDER BY created_at DESC, organization_join_request_id ASC/);
  assert.deepEqual(db.calls[0].params, [REQUESTER, 100]);

  await listPendingOrganizationJoinRequestsForOrganization({ organizationId: ORG_A, limit: 0 }, db);
  assert.match(db.calls[1].text, /WHERE organization_id = \$1\s+AND status = 'pending'\s+ORDER BY created_at ASC/);
  assert.deepEqual(db.calls[1].params, [ORG_A, 1]);

  await listPendingOrganizationJoinRequestsForOrganization({ organizationId: ORG_A, limit: "7" }, db);
  assert.deepEqual(db.calls[2].params, [ORG_A, 50]);

  assert.deepEqual(await listOrganizationJoinRequestsForRequester({}, db), []);
  assert.deepEqual(await listPendingOrganizationJoinRequestsForOrganization({}, db), []);
  assert.equal(db.calls.length, 3);
});

test("decision is a pending-only compare-and-swap that records reviewer and reviewed_at", async () => {
  const db = recordingDb({ rows: [row({ status: "approved", reviewed_by_user_id: REVIEWER, reviewed_at: "x" })] });
  const result = await recordOrganizationJoinRequestDecision(
    { organizationId: ORG_A, organizationJoinRequestId: REQUEST_ID, decision: "approved", reviewerUserId: REVIEWER },
    db,
  );
  assert.equal(result.ok, true);
  assert.match(db.calls[0].text, /SET status = \$1,\s+reviewed_at = now\(\),\s+reviewed_by_user_id = \$2/);
  assert.match(db.calls[0].text, /WHERE organization_id = \$3\s+AND organization_join_request_id = \$4\s+AND status = 'pending'/);
  assert.deepEqual(db.calls[0].params, ["approved", REVIEWER, ORG_A, REQUEST_ID]);
  assert.doesNotMatch(db.calls[0].text, /role/i);
});

test("decision rejects non-terminal or unknown decisions and missing identifiers without querying", async () => {
  const db = recordingDb();
  const base = { organizationId: ORG_A, organizationJoinRequestId: REQUEST_ID, reviewerUserId: REVIEWER };
  for (const decision of ["pending", "client_admin", undefined]) {
    assert.deepEqual(await recordOrganizationJoinRequestDecision({ ...base, decision }, db), {
      ok: false,
      error_code: "invalid_join_request_decision",
    });
  }
  assert.deepEqual(await recordOrganizationJoinRequestDecision({ ...base, decision: "declined", reviewerUserId: null }, db), {
    ok: false,
    error_code: "invalid_join_request_fields",
  });
  assert.equal(db.calls.length, 0);
});

test("decision reports zero-row CAS, self-review, and FK failures as stable error codes", async () => {
  const input = { organizationId: ORG_A, organizationJoinRequestId: REQUEST_ID, decision: "declined", reviewerUserId: REVIEWER };
  assert.deepEqual(await recordOrganizationJoinRequestDecision(input, recordingDb({ rows: [] })), {
    ok: false,
    error_code: "join_request_not_pending",
  });
  assert.deepEqual(
    await recordOrganizationJoinRequestDecision(
      input,
      recordingDb(pgError("23514", "organization_join_requests_j1_no_self_review_check")),
    ),
    { ok: false, error_code: "self_review_not_permitted" },
  );
  assert.deepEqual(await recordOrganizationJoinRequestDecision(input, recordingDb(pgError("23514"))), {
    ok: false,
    error_code: "invalid_join_request_fields",
  });
  assert.deepEqual(await recordOrganizationJoinRequestDecision(input, recordingDb(pgError("23503"))), {
    ok: false,
    error_code: "invalid_reference",
  });
  await assert.rejects(recordOrganizationJoinRequestDecision(input, recordingDb(pgError("40001"))), /pg 40001/);
});
