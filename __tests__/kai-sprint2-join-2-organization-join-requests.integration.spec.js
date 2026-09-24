import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_JOIN_1_ORGANIZATION_JOIN_REQUESTS_DATABASE_URL;

/**
 * JOIN-2 real-PostgreSQL proof over the JOIN-1 runner-owned ephemeral
 * cluster (scripts/kai-sprint2-join-1-organization-join-requests-local-postgres.js);
 * skipped everywhere else. Exercises the real JOIN-2 service, the real
 * JOIN-1 query helpers, the real listAuthorizedOrganizations authority, the
 * real required-audit insert, and real transactions against a test-local
 * pool. Synthetic data only; every row this file creates is deleted after.
 */
function assertLoopbackDatabaseUrl(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`JOIN-2 integration suite refused a non-loopback database host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("JOIN-2 organization join requests integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);

  const { Pool } = await import("pg");
  const queries = await import("../Backend/kai/db/kaiOrganizationJoinRequestQueries.js");
  const { getActorOrganizationAccess } = await import("../Backend/kai/db/kaiQueries.js");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const { insertRequiredSuccessfulAuditEvent } = await import("../Backend/kai/db/kaiAuditQueries.js");
  const service = await import("../Backend/kai/services/kaiOrganizationJoinRequestService.js");
  const testPool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 6 });

  const ORG_OPEN = "2a000000-0000-4000-8000-00000000000a";
  const ORG_MEMBER = "2a000000-0000-4000-8000-00000000000b";
  const ORG_DERIVED = "2a000000-0000-4000-8000-00000000000c";
  const ORG_DRAFT = "2a000000-0000-4000-8000-00000000000d";
  const ORG_REVOKED = "2a000000-0000-4000-8000-00000000000e";
  const ORG_IDS = [ORG_OPEN, ORG_MEMBER, ORG_DERIVED, ORG_DRAFT, ORG_REVOKED];
  const REQUESTER = "2a000000-0000-4000-8000-000000000001";
  const OTHER = "2a000000-0000-4000-8000-000000000002";

  function actorFor(userId, memberships = []) {
    return { actorType: "human", actorUserId: userId, legacyPublicUserdataId: 501, organizationMemberships: memberships };
  }

  // Every repository dependency is bound to the runner-owned pool; the
  // ambient kaiDb pool (loopback sentinel) is never used.
  function deps(overrides = {}) {
    return {
      env: { KAI_SPRINT2_ENABLED: "true" },
      runInTransaction: (callback) => withTransaction(callback, testPool),
      getJoinableKaiOrganization: (input, db = testPool) => queries.getJoinableKaiOrganization(input, db),
      getActorOrganizationAccess: (userId, organizationId, db = testPool) => getActorOrganizationAccess(userId, organizationId, db),
      getPendingOrganizationJoinRequestForRequester: (input, db = testPool) =>
        queries.getPendingOrganizationJoinRequestForRequester(input, db),
      insertPendingOrganizationJoinRequest: (input, db) => queries.insertPendingOrganizationJoinRequest(input, db),
      insertRequiredSuccessfulAuditEvent: (metadata, db) => insertRequiredSuccessfulAuditEvent(metadata, db),
      searchJoinableKaiOrganizations: (input) => queries.searchJoinableKaiOrganizations(input, testPool),
      listOwnOrganizationJoinRequestsWithOrganization: (input) =>
        queries.listOwnOrganizationJoinRequestsWithOrganization(input, testPool),
      ...overrides,
    };
  }

  async function requestCount(organizationId, userId = REQUESTER) {
    const { rows } = await testPool.query(
      `SELECT count(*)::int AS n FROM kai.organization_join_requests WHERE organization_id = $1 AND requester_user_id = $2`,
      [organizationId, userId],
    );
    return rows[0].n;
  }

  async function auditCount(organizationId) {
    const { rows } = await testPool.query(
      `SELECT count(*)::int AS n FROM kai.audit_events
        WHERE organization_id = $1 AND action = 'submit_organization_join_request'`,
      [organizationId],
    );
    return rows[0].n;
  }

  async function cleanup() {
    await testPool.query(`DELETE FROM kai.audit_events WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organization_join_requests WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organization_memberships WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organizations WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.users WHERE user_id = ANY($1::uuid[])`, [[REQUESTER, OTHER]]);
  }

  test.before(async () => {
    await cleanup();
    await testPool.query(
      `INSERT INTO kai.organizations (organization_id, name, status, organization_code, contract_ref) VALUES
         ($1, 'Harbour Synthetic Open', 'active', 'SYN-OPEN', 'contract-secret'),
         ($2, 'Harbour Synthetic Member', 'active', 'SYN-MEMBER', NULL),
         ($3, 'Harbour Synthetic Derived', 'active', 'SYN-DERIVED', NULL),
         ($4, 'Harbour Synthetic Draft', 'draft', 'SYN-DRAFT', NULL),
         ($5, 'Harbour Synthetic Revoked', 'active', 'SYN-REVOKED', NULL)`,
      ORG_IDS,
    );
    await testPool.query(
      `INSERT INTO kai.users (user_id, legacy_identity_source) VALUES ($1, 'synthetic'), ($2, 'synthetic')`,
      [REQUESTER, OTHER],
    );
    await testPool.query(
      `INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES
         ($1, $3, 'client_contributor', 'active'),
         ($2, $3, 'client_contributor', 'revoked')`,
      [ORG_MEMBER, ORG_REVOKED, REQUESTER],
    );
  });

  test.after(async () => {
    await cleanup();
    await testPool.end();
  });

  // The requester's stored active membership in ORG_MEMBER, plus a derived
  // (non-persisted) GK-binding client_admin membership for ORG_DERIVED -
  // exactly the merged shape resolveKaiActorContext produces.
  const requesterActor = actorFor(REQUESTER, [
    { organization_id: ORG_MEMBER, user_id: REQUESTER, role_name: "client_contributor", membership_status: "active" },
    { organization_id: ORG_REVOKED, user_id: REQUESTER, role_name: "client_contributor", membership_status: "revoked" },
    { organization_id: ORG_DERIVED, role_name: "client_admin", membership_status: "active", authority_source: "gk_organization_binding" },
  ]);

  test("discovery: active KAI orgs only, safe fields only, already-authorized excluded, bounded", async () => {
    const result = await service.searchJoinableOrganizations({ searchTerm: "harbour synthetic", actorContext: requesterActor }, deps());
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.items, [
      { organization_id: ORG_OPEN, display_name: "Harbour Synthetic Open" },
      { organization_id: ORG_REVOKED, display_name: "Harbour Synthetic Revoked" },
    ]);
    const wildcard = await service.searchJoinableOrganizations({ searchTerm: "%%", actorContext: requesterActor }, deps());
    assert.deepEqual(wildcard.data.items, [], "LIKE wildcards are literal, so '%%' does not enumerate every organization");
  });

  test("submit: new pending request + exactly one audit event, committed together", async () => {
    const result = await service.submitOrganizationJoinRequest({ organizationId: ORG_OPEN, actorContext: requesterActor }, deps());
    assert.equal(result.ok, true);
    assert.equal(result.data.outcome, "created");
    assert.equal(result.data.join_request.status, "pending");
    assert.equal(result.data.join_request.organization_display_name, "Harbour Synthetic Open");
    assert.equal(await requestCount(ORG_OPEN), 1);
    assert.equal(await auditCount(ORG_OPEN), 1);

    const { rows } = await testPool.query(
      `SELECT actor_user_id, object_type::text AS object_type, metadata FROM kai.audit_events
        WHERE organization_id = $1 AND action = 'submit_organization_join_request'`,
      [ORG_OPEN],
    );
    assert.equal(rows[0].actor_user_id, REQUESTER);
    assert.equal(rows[0].metadata.object_id, result.data.join_request.organization_join_request_id);
    assert.equal(rows[0].metadata.target_object_type, "organization_join_request");
    assert.equal(rows[0].metadata.metadata_only, true);
    assert.doesNotMatch(JSON.stringify(rows[0].metadata), /Harbour|role/);
  });

  test("submit: duplicate pending (sequential and concurrent) replays one row with no extra audit", async () => {
    const replay = await service.submitOrganizationJoinRequest({ organizationId: ORG_OPEN, actorContext: requesterActor }, deps());
    assert.equal(replay.data.outcome, "existing_pending");

    const concurrent = await Promise.all(
      [1, 2, 3].map(() => service.submitOrganizationJoinRequest({ organizationId: ORG_OPEN, actorContext: requesterActor }, deps())),
    );
    assert.ok(concurrent.every((r) => r.ok && r.data.outcome === "existing_pending"));
    assert.equal(await requestCount(ORG_OPEN), 1);
    assert.equal(await auditCount(ORG_OPEN), 1);
  });

  test("submit: concurrent first submissions race on the unique index -> one row, one audit", async () => {
    const other = actorFor(OTHER);
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => service.submitOrganizationJoinRequest({ organizationId: ORG_REVOKED, actorContext: other }, deps())),
    );
    assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
    assert.equal(results.filter((r) => r.data.outcome === "created").length, 1);
    assert.equal(await requestCount(ORG_REVOKED, OTHER), 1);
    assert.equal(await auditCount(ORG_REVOKED), 1);
  });

  test("submit: stored active member and derived GK->KAI authority are blocked", async () => {
    for (const organizationId of [ORG_MEMBER, ORG_DERIVED]) {
      const result = await service.submitOrganizationJoinRequest({ organizationId, actorContext: requesterActor }, deps());
      assert.equal(result.blockers[0].blocking_reason, "join_request_already_authorized");
      assert.equal(await requestCount(organizationId), 0);
    }
    // Even if the actor context were stale, the in-transaction stored read blocks.
    const stale = await service.submitOrganizationJoinRequest({ organizationId: ORG_MEMBER, actorContext: actorFor(REQUESTER) }, deps());
    assert.equal(stale.blockers[0].blocking_reason, "join_request_already_authorized");
    assert.equal(await requestCount(ORG_MEMBER), 0);
  });

  test("submit: revoked membership -> administrator action required; membership row untouched", async () => {
    const result = await service.submitOrganizationJoinRequest({ organizationId: ORG_REVOKED, actorContext: requesterActor }, deps());
    assert.equal(result.blockers[0].blocking_reason, "join_request_administrator_action_required");
    assert.equal(await requestCount(ORG_REVOKED), 0);
    const { rows } = await testPool.query(
      `SELECT membership_status FROM kai.organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [ORG_REVOKED, REQUESTER],
    );
    assert.deepEqual(rows, [{ membership_status: "revoked" }]);
  });

  test("submit: draft (non-joinable) and unknown organizations -> not_found", async () => {
    for (const organizationId of [ORG_DRAFT, "2a000000-0000-4000-8000-0000000000ff"]) {
      const result = await service.submitOrganizationJoinRequest({ organizationId, actorContext: requesterActor }, deps());
      assert.equal(result.error.code, "not_found");
      assert.equal(await requestCount(organizationId), 0);
    }
  });

  test("audit failure rolls back the inserted request (no orphan row)", async () => {
    const result = await service.submitOrganizationJoinRequest(
      { organizationId: ORG_OPEN, actorContext: actorFor(OTHER) },
      deps({ insertRequiredSuccessfulAuditEvent: async () => ({ ok: false, skipped: true }) }),
    );
    assert.equal(result.error.code, "audit_payload_rejected");
    assert.equal(await requestCount(ORG_OPEN, OTHER), 0);
    assert.equal(await auditCount(ORG_OPEN), 1);

    await assert.rejects(
      service.submitOrganizationJoinRequest(
        { organizationId: ORG_OPEN, actorContext: actorFor(OTHER) },
        deps({ insertRequiredSuccessfulAuditEvent: async () => { throw new Error("audit insert exploded"); } }),
      ),
      /audit insert exploded/,
    );
    assert.equal(await requestCount(ORG_OPEN, OTHER), 0);
  });

  test("own status: each user sees only their own requests, without reviewer identity", async () => {
    const mine = await service.listMyOrganizationJoinRequests({ actorContext: requesterActor }, deps());
    assert.equal(mine.ok, true);
    assert.deepEqual(mine.data.items.map((item) => item.organization_id), [ORG_OPEN]);
    assert.deepEqual(Object.keys(mine.data.items[0]).sort(), [
      "organization_display_name",
      "organization_id",
      "organization_join_request_id",
      "reviewed_at",
      "status",
      "submitted_at",
    ]);

    const theirs = await service.listMyOrganizationJoinRequests({ actorContext: actorFor(OTHER) }, deps());
    assert.deepEqual(theirs.data.items.map((item) => item.organization_id), [ORG_REVOKED]);
    assert.ok(!theirs.data.items.some((item) => item.organization_id === ORG_OPEN));
  });
}
