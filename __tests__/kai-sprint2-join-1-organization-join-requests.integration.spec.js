import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_JOIN_1_ORGANIZATION_JOIN_REQUESTS_DATABASE_URL;

/**
 * JOIN-1 real-PostgreSQL proof. Runs only against the ephemeral, loopback,
 * runner-owned cluster created by
 * scripts/kai-sprint2-join-1-organization-join-requests-local-postgres.js;
 * skipped everywhere else. Database modules are imported dynamically so a
 * skipped run never loads `pg`. All data is synthetic and every test runs
 * inside a transaction that is rolled back.
 */
function assertLoopbackDatabaseUrl(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`JOIN-1 integration suite refused a non-loopback database host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("JOIN-1 organization join requests integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);

  const { Pool } = await import("pg");
  const queries = await import("../Backend/kai/db/kaiOrganizationJoinRequestQueries.js");
  const pool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 4 });

  const ORG_A = "1a000000-0000-4000-8000-00000000000a";
  const ORG_B = "1a000000-0000-4000-8000-00000000000b";
  const REQUESTER = "1a000000-0000-4000-8000-000000000001";
  const REVIEWER = "1a000000-0000-4000-8000-000000000002";
  const MISSING = "1a000000-0000-4000-8000-0000000000ff";

  async function inRolledBackTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO kai.organizations (organization_id, name) VALUES ($1, 'Synthetic Org A'), ($2, 'Synthetic Org B')`,
        [ORG_A, ORG_B],
      );
      await client.query(
        `INSERT INTO kai.users (user_id, legacy_identity_source) VALUES ($1, 'synthetic'), ($2, 'synthetic')`,
        [REQUESTER, REVIEWER],
      );
      return await work(client);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }

  async function savepointError(client, sql, params) {
    await client.query("SAVEPOINT s");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT s");
      return null;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT s");
      return error;
    }
  }

  test.after(async () => {
    await pool.end();
  });

  test("submit -> pending; a second pending request for the same requester+org is refused; another org is independent", async () => {
    await inRolledBackTransaction(async (client) => {
      const first = await queries.insertPendingOrganizationJoinRequest({ organizationId: ORG_A, requesterUserId: REQUESTER }, client);
      assert.equal(first.ok, true);
      assert.equal(first.joinRequest.status, "pending");
      assert.equal(first.joinRequest.reviewed_at, null);
      assert.equal(first.joinRequest.reviewed_by_user_id, null);
      assert.ok(first.joinRequest.created_at instanceof Date);

      await client.query("SAVEPOINT dup");
      const duplicate = await queries.insertPendingOrganizationJoinRequest({ organizationId: ORG_A, requesterUserId: REQUESTER }, client);
      await client.query("ROLLBACK TO SAVEPOINT dup");
      assert.deepEqual(duplicate, { ok: false, error_code: "pending_request_exists" });

      const other = await queries.insertPendingOrganizationJoinRequest({ organizationId: ORG_B, requesterUserId: REQUESTER }, client);
      assert.equal(other.ok, true);

      const pending = await queries.getPendingOrganizationJoinRequestForRequester({ organizationId: ORG_A, requesterUserId: REQUESTER }, client);
      assert.equal(pending.organization_join_request_id, first.joinRequest.organization_join_request_id);
      const own = await queries.listOrganizationJoinRequestsForRequester({ requesterUserId: REQUESTER }, client);
      assert.equal(own.length, 2);
    });
  });

  test("unknown organization or requester is refused by FK", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query("SAVEPOINT fk1");
      const badOrg = await queries.insertPendingOrganizationJoinRequest({ organizationId: MISSING, requesterUserId: REQUESTER }, client);
      await client.query("ROLLBACK TO SAVEPOINT fk1");
      assert.deepEqual(badOrg, { ok: false, error_code: "invalid_reference" });

      await client.query("SAVEPOINT fk2");
      const badUser = await queries.insertPendingOrganizationJoinRequest({ organizationId: ORG_A, requesterUserId: MISSING }, client);
      await client.query("ROLLBACK TO SAVEPOINT fk2");
      assert.deepEqual(badUser, { ok: false, error_code: "invalid_reference" });
    });
  });

  test("decline is terminal; a new request may follow a declined one", async () => {
    await inRolledBackTransaction(async (client) => {
      const first = await queries.insertPendingOrganizationJoinRequest({ organizationId: ORG_A, requesterUserId: REQUESTER }, client);
      const id = first.joinRequest.organization_join_request_id;

      const declined = await queries.recordOrganizationJoinRequestDecision(
        { organizationId: ORG_A, organizationJoinRequestId: id, decision: "declined", reviewerUserId: REVIEWER },
        client,
      );
      assert.equal(declined.ok, true);
      assert.equal(declined.joinRequest.status, "declined");
      assert.equal(declined.joinRequest.reviewed_by_user_id, REVIEWER);
      assert.ok(declined.joinRequest.reviewed_at instanceof Date);

      const redecide = await queries.recordOrganizationJoinRequestDecision(
        { organizationId: ORG_A, organizationJoinRequestId: id, decision: "approved", reviewerUserId: REVIEWER },
        client,
      );
      assert.deepEqual(redecide, { ok: false, error_code: "join_request_not_pending" });

      const again = await queries.insertPendingOrganizationJoinRequest({ organizationId: ORG_A, requesterUserId: REQUESTER }, client);
      assert.equal(again.ok, true);
      assert.notEqual(again.joinRequest.organization_join_request_id, id);

      const queue = await queries.listPendingOrganizationJoinRequestsForOrganization({ organizationId: ORG_A }, client);
      assert.deepEqual(queue.map((r) => r.organization_join_request_id), [again.joinRequest.organization_join_request_id]);
    });
  });

  test("approve records reviewer; decisions are organization-scoped and self-review is refused", async () => {
    await inRolledBackTransaction(async (client) => {
      const { joinRequest } = await queries.insertPendingOrganizationJoinRequest({ organizationId: ORG_A, requesterUserId: REQUESTER }, client);
      const id = joinRequest.organization_join_request_id;

      const wrongOrg = await queries.recordOrganizationJoinRequestDecision(
        { organizationId: ORG_B, organizationJoinRequestId: id, decision: "approved", reviewerUserId: REVIEWER },
        client,
      );
      assert.deepEqual(wrongOrg, { ok: false, error_code: "join_request_not_pending" });
      assert.equal(await queries.getOrganizationJoinRequestForOrganization({ organizationId: ORG_B, organizationJoinRequestId: id }, client), null);

      await client.query("SAVEPOINT self");
      const selfReview = await queries.recordOrganizationJoinRequestDecision(
        { organizationId: ORG_A, organizationJoinRequestId: id, decision: "approved", reviewerUserId: REQUESTER },
        client,
      );
      await client.query("ROLLBACK TO SAVEPOINT self");
      assert.deepEqual(selfReview, { ok: false, error_code: "self_review_not_permitted" });

      const approved = await queries.recordOrganizationJoinRequestDecision(
        { organizationId: ORG_A, organizationJoinRequestId: id, decision: "approved", reviewerUserId: REVIEWER },
        client,
      );
      assert.equal(approved.ok, true);
      assert.equal(approved.joinRequest.status, "approved");
      assert.equal(approved.joinRequest.reviewed_by_user_id, REVIEWER);
    });
  });

  test("schema constraints and lifecycle trigger reject invalid rows and transitions directly", async () => {
    await inRolledBackTransaction(async (client) => {
      const invalidStatus = await savepointError(
        client,
        `INSERT INTO kai.organization_join_requests (organization_id, requester_user_id, status) VALUES ($1, $2, 'client_admin')`,
        [ORG_A, REQUESTER],
      );
      assert.equal(invalidStatus?.code, "23514");

      const approvedWithoutReviewer = await savepointError(
        client,
        `INSERT INTO kai.organization_join_requests (organization_id, requester_user_id, status) VALUES ($1, $2, 'approved')`,
        [ORG_A, REQUESTER],
      );
      assert.equal(approvedWithoutReviewer?.constraint, "organization_join_requests_j1_review_fields_check");

      const pendingWithReviewer = await savepointError(
        client,
        `INSERT INTO kai.organization_join_requests (organization_id, requester_user_id, reviewed_at, reviewed_by_user_id)
         VALUES ($1, $2, now(), $3)`,
        [ORG_A, REQUESTER, REVIEWER],
      );
      assert.equal(pendingWithReviewer?.constraint, "organization_join_requests_j1_review_fields_check");

      const { rows } = await client.query(
        `INSERT INTO kai.organization_join_requests (organization_id, requester_user_id) VALUES ($1, $2)
         RETURNING organization_join_request_id`,
        [ORG_A, REQUESTER],
      );
      const id = rows[0].organization_join_request_id;

      const moveOrg = await savepointError(
        client,
        `UPDATE kai.organization_join_requests SET organization_id = $2 WHERE organization_join_request_id = $1`,
        [id, ORG_B],
      );
      assert.equal(moveOrg?.code, "23514");
      assert.match(moveOrg.message, /identity columns are immutable/);

      const stayPending = await savepointError(
        client,
        `UPDATE kai.organization_join_requests SET updated_at = now() WHERE organization_join_request_id = $1`,
        [id],
      );
      assert.match(stayPending?.message ?? "", /may only transition to approved or declined/);

      await client.query(
        `UPDATE kai.organization_join_requests SET status = 'declined', reviewed_at = now(), reviewed_by_user_id = $2
          WHERE organization_join_request_id = $1`,
        [id, REVIEWER],
      );
      const reopen = await savepointError(
        client,
        `UPDATE kai.organization_join_requests SET status = 'pending', reviewed_at = NULL, reviewed_by_user_id = NULL
          WHERE organization_join_request_id = $1`,
        [id],
      );
      assert.match(reopen?.message ?? "", /declined request is terminal/);

      const orgDelete = await savepointError(client, `DELETE FROM kai.organizations WHERE organization_id = $1`, [ORG_A]);
      assert.equal(orgDelete?.code, "23503");
    });
  });

  test("no requested-role column exists on the deployed relation", async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'kai' AND table_name = 'organization_join_requests'
        ORDER BY ordinal_position`,
    );
    assert.deepEqual(rows.map((r) => r.column_name), [
      "organization_join_request_id",
      "organization_id",
      "requester_user_id",
      "status",
      "created_at",
      "reviewed_at",
      "reviewed_by_user_id",
      "updated_at",
    ]);
  });
}
