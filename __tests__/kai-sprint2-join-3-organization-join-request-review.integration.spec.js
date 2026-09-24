import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_JOIN_1_ORGANIZATION_JOIN_REQUESTS_DATABASE_URL;

/**
 * JOIN-3 real-PostgreSQL proof over the JOIN runner-owned ephemeral cluster
 * (scripts/kai-sprint2-join-1-organization-join-requests-local-postgres.js);
 * skipped everywhere else. Exercises the real review service, the real
 * access-administration membership core, the real JOIN-1 decision CAS, the
 * real membership + decision audits, the real GK-binding derived-admin
 * roster, and real transactions/row locks against a test-local pool.
 * Synthetic data only; every row this file creates is deleted afterwards.
 */
function assertLoopbackDatabaseUrl(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`JOIN-3 integration suite refused a non-loopback database host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("JOIN-3 organization join request review integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);

  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const joinQueries = await import("../Backend/kai/db/kaiOrganizationJoinRequestQueries.js");
  const accessQueries = await import("../Backend/kai/db/kaiAccessAdministrationQueries.js");
  const gkAdminQueries = await import("../Backend/kai/auth/gkOrganizationAdminQueries.js");
  const { insertRequiredSuccessfulAuditEvent } = await import("../Backend/kai/db/kaiAuditQueries.js");
  const { createProductionMetadataOnlyAuditForAccessAdministration } = await import(
    "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js"
  );
  const review = await import("../Backend/kai/services/kaiOrganizationJoinRequestReviewService.js");
  const testPool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 8 });

  const ORG_A = "3a000000-0000-4000-8000-00000000000a";
  const ORG_B = "3a000000-0000-4000-8000-00000000000b";
  const ORG_BOUND = "3a000000-0000-4000-8000-00000000000c";
  const ORG_IDS = [ORG_A, ORG_B, ORG_BOUND];
  const GK_ORG_BOUND = 93001;
  const LEGACY = { adminA: 93101, derivedAdmin: 93102, superuser: 93103, requesterDerived: 93104 };
  const USERS = {
    adminA: "3a000000-0000-4000-8000-0000000000a1",
    derivedAdmin: "3a000000-0000-4000-8000-0000000000a2",
    superuser: "3a000000-0000-4000-8000-0000000000a3",
    requesterDerived: "3a000000-0000-4000-8000-0000000000a4",
  };
  const requesterIds = Array.from({ length: 30 }, (_, i) => `3a000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`);
  const ALL_USER_IDS = [...Object.values(USERS), ...requesterIds];
  const NOW = "2026-09-24T12:00:00.000Z";

  const adminA = {
    actorType: "human",
    actorUserId: USERS.adminA,
    kaiRoles: [],
    organizationMemberships: [{ organization_id: ORG_A, user_id: USERS.adminA, role_name: "client_admin", membership_status: "active" }],
  };
  const derivedAdmin = {
    actorType: "human",
    actorUserId: USERS.derivedAdmin,
    kaiRoles: [],
    organizationMemberships: [
      { organization_id: ORG_BOUND, role_name: "client_admin", membership_status: "active", authority_source: "gk_organization_binding" },
    ],
  };
  const superuser = {
    actorType: "human",
    actorUserId: USERS.superuser,
    kaiRoles: [],
    organizationMemberships: [],
    platformSuperuser: true,
    platformSuperuserAuthority: "get_kinder_site_admin",
  };

  function deps(overrides = {}) {
    return {
      env: { KAI_SPRINT2_ENABLED: "true" },
      runInTransaction: (callback) => withTransaction(callback, testPool),
      getOrganizationJoinRequestForDecisionForUpdate: (input, db) => joinQueries.getOrganizationJoinRequestForDecisionForUpdate(input, db),
      listPendingOrganizationJoinRequestsForReview: (input) => joinQueries.listPendingOrganizationJoinRequestsForReview(input, testPool),
      recordOrganizationJoinRequestDecision: (input, db) => joinQueries.recordOrganizationJoinRequestDecision(input, db),
      listOrganizationMembershipRowsForUserInOrganization: (org, user, db) =>
        accessQueries.listOrganizationMembershipRowsForUserInOrganization(org, user, db),
      countActiveStoredClientAdminMemberships: (org, db, opts) => accessQueries.countActiveStoredClientAdminMemberships(org, db, opts),
      upsertOrganizationMembershipRoleStatus: (input, db) => accessQueries.upsertOrganizationMembershipRoleStatus(input, db),
      getActiveGkOrganizationIdForKaiOrganization: (org, db) => gkAdminQueries.getActiveGkOrganizationIdForKaiOrganization(org, db),
      listActiveGkOrganizationAdminLegacyUserIds: (gk, db) => gkAdminQueries.listActiveGkOrganizationAdminLegacyUserIds(gk, db),
      hasActiveDerivedClientAdminForOrganization: (org, db) => gkAdminQueries.hasActiveDerivedClientAdminForOrganization(org, db),
      createProductionMetadataOnlyAuditForAccessAdministration: (input) =>
        createProductionMetadataOnlyAuditForAccessAdministration({ ...input, insertAuditEvent: insertRequiredSuccessfulAuditEvent }),
      insertRequiredSuccessfulAuditEvent: (metadata, db) => insertRequiredSuccessfulAuditEvent(metadata, db),
      ...overrides,
    };
  }

  let nextRequester = 0;
  async function pendingRequest(organizationId, requesterUserId = requesterIds[nextRequester++]) {
    const result = await joinQueries.insertPendingOrganizationJoinRequest({ organizationId, requesterUserId }, testPool);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.joinRequest;
  }

  async function requestRow(id) {
    const { rows } = await testPool.query(
      `SELECT status, reviewed_by_user_id, reviewed_at FROM kai.organization_join_requests WHERE organization_join_request_id = $1`,
      [id],
    );
    return rows[0];
  }

  async function memberships(organizationId, userId) {
    const { rows } = await testPool.query(
      `SELECT role_name, membership_status FROM kai.organization_memberships
        WHERE organization_id = $1 AND user_id = $2 ORDER BY role_name`,
      [organizationId, userId],
    );
    return rows;
  }

  async function audits(organizationId, targetUserId) {
    const { rows } = await testPool.query(
      `SELECT action, metadata FROM kai.audit_events
        WHERE organization_id = $1 AND metadata->>'target_user_id' = $2 ORDER BY audit_event_id`,
      [organizationId, targetUserId],
    );
    return rows;
  }

  const approve = (actorContext, organizationId, id, extra = {}) =>
    review.approveOrganizationJoinRequest({ actorContext, organizationId, organizationJoinRequestId: id, now: NOW }, deps(extra));
  const decline = (actorContext, organizationId, id, extra = {}) =>
    review.declineOrganizationJoinRequest({ actorContext, organizationId, organizationJoinRequestId: id, now: NOW }, deps(extra));

  async function cleanup() {
    await testPool.query(`DELETE FROM kai.audit_events WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organization_join_requests WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organization_memberships WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.gk_organization_bindings WHERE kai_organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organizations WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.users WHERE user_id = ANY($1::uuid[])`, [ALL_USER_IDS]);
    await testPool.query(`DELETE FROM public.userdata WHERE id = ANY($1::int[])`, [Object.values(LEGACY)]);
    await testPool.query(`DELETE FROM public.organizations WHERE id = $1`, [GK_ORG_BOUND]);
  }

  test.before(async () => {
    await cleanup();
    await testPool.query(
      `INSERT INTO kai.organizations (organization_id, name) VALUES ($1, 'Synthetic A'), ($2, 'Synthetic B'), ($3, 'Synthetic Bound')`,
      ORG_IDS,
    );
    await testPool.query(`INSERT INTO public.organizations (id, name) VALUES ($1, 'Synthetic GK Bound')`, [GK_ORG_BOUND]);
    await testPool.query(
      `INSERT INTO kai.gk_organization_bindings (gk_organization_id, kai_organization_id, status) VALUES ($1, $2, 'active')`,
      [GK_ORG_BOUND, ORG_BOUND],
    );
    await testPool.query(
      `INSERT INTO public.userdata (id, org_id, org_rep) VALUES ($1, NULL, false), ($2, $5, true), ($3, NULL, false), ($4, $5, true)`,
      [LEGACY.adminA, LEGACY.derivedAdmin, LEGACY.superuser, LEGACY.requesterDerived, GK_ORG_BOUND],
    );
    for (const [key, userId] of Object.entries(USERS)) {
      await testPool.query(
        `INSERT INTO kai.users (user_id, legacy_identity_source, legacy_public_userdata_id, email)
         VALUES ($1, 'public.userdata', $2, $3)`,
        [userId, LEGACY[key], `${key}@synthetic.test`],
      );
    }
    for (const [index, userId] of requesterIds.entries()) {
      await testPool.query(
        `INSERT INTO kai.users (user_id, legacy_identity_source, email) VALUES ($1, 'synthetic', $2)`,
        [userId, `requester${index}@synthetic.test`],
      );
    }
    await testPool.query(
      `INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status)
       VALUES ($1, $2, 'client_admin', 'active')`,
      [ORG_A, USERS.adminA],
    );
  });

  test.after(async () => {
    await cleanup();
    await testPool.end();
  });

  test("queue: stored admin sees only its organization's pending requests with safe fields; other orgs are denied", async () => {
    const pendingA = await pendingRequest(ORG_A);
    await pendingRequest(ORG_B);
    const result = await review.listPendingOrganizationJoinRequestsForReviewer({ actorContext: adminA, organizationId: ORG_A }, deps());
    assert.equal(result.ok, true);
    const item = result.data.items.find((row) => row.organization_join_request_id === pendingA.organization_join_request_id);
    assert.deepEqual(Object.keys(item).sort(), [
      "organization_id",
      "organization_join_request_id",
      "requester_email",
      "requester_user_id",
      "status",
      "submitted_at",
    ]);
    assert.ok(result.data.items.every((row) => row.organization_id === ORG_A && row.status === "pending"));
    const denied = await review.listPendingOrganizationJoinRequestsForReviewer({ actorContext: adminA, organizationId: ORG_B }, deps());
    assert.equal(denied.error.code, "authorization_denied");
  });

  test("approve (stored client_admin): active client_contributor + approved request + membership and decision audits", async () => {
    const request = await pendingRequest(ORG_A);
    const result = await approve(adminA, ORG_A, request.organization_join_request_id);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(await memberships(ORG_A, request.requester_user_id), [{ role_name: "client_contributor", membership_status: "active" }]);
    const row = await requestRow(request.organization_join_request_id);
    assert.equal(row.status, "approved");
    assert.equal(row.reviewed_by_user_id, USERS.adminA);
    assert.ok(row.reviewed_at instanceof Date);

    const auditRows = await audits(ORG_A, request.requester_user_id);
    assert.deepEqual(auditRows.map((a) => a.action), ["organization_membership_assigned", "approve_organization_join_request"]);
    const decisionAudit = auditRows[1].metadata;
    assert.equal(decisionAudit.object_id, request.organization_join_request_id);
    assert.equal(decisionAudit.from_state, "pending");
    assert.equal(decisionAudit.to_state, "approved");
    assert.equal(decisionAudit.resulting_role_name, "client_contributor");
    assert.equal(decisionAudit.actor_user_id, USERS.adminA);
    assert.doesNotMatch(JSON.stringify(auditRows), /@synthetic|Synthetic/);
  });

  test("approve (derived GK->KAI client_admin) and platformSuperuser without membership both succeed", async () => {
    const bound = await pendingRequest(ORG_BOUND);
    assert.equal((await approve(derivedAdmin, ORG_BOUND, bound.organization_join_request_id)).ok, true);
    assert.deepEqual(await memberships(ORG_BOUND, bound.requester_user_id), [{ role_name: "client_contributor", membership_status: "active" }]);

    const b = await pendingRequest(ORG_B);
    assert.equal((await approve(superuser, ORG_B, b.organization_join_request_id)).ok, true);
    assert.equal((await requestRow(b.organization_join_request_id)).reviewed_by_user_id, USERS.superuser);
  });

  test("tenant: org-A admin cannot decide an org-B request; route org mismatch fails closed", async () => {
    const b = await pendingRequest(ORG_B);
    assert.equal((await approve(adminA, ORG_B, b.organization_join_request_id)).error.code, "authorization_denied");
    const mismatch = await approve(superuser, ORG_A, b.organization_join_request_id);
    assert.equal(mismatch.error.code, "not_found");
    assert.equal((await requestRow(b.organization_join_request_id)).status, "pending");
    assert.deepEqual(await memberships(ORG_B, b.requester_user_id), []);
  });

  test("self-review: blocked in the service (even as superuser) and by the JOIN-1 CHECK backstop", async () => {
    const own = await pendingRequest(ORG_B);
    const selfSuper = { ...superuser, actorUserId: own.requester_user_id };
    const result = await approve(selfSuper, ORG_B, own.organization_join_request_id);
    assert.equal(result.blockers[0].blocking_reason, "join_request_self_review_denied");
    assert.equal((await requestRow(own.organization_join_request_id)).status, "pending");
    assert.deepEqual(await memberships(ORG_B, own.requester_user_id), []);
    const backstop = await joinQueries.recordOrganizationJoinRequestDecision(
      { organizationId: ORG_B, organizationJoinRequestId: own.organization_join_request_id, decision: "approved", reviewerUserId: own.requester_user_id },
      testPool,
    );
    assert.deepEqual(backstop, { ok: false, error_code: "self_review_not_permitted" });
  });

  test("recheck: requester with derived GK->KAI authority -> no membership, request stays pending", async () => {
    const request = await pendingRequest(ORG_BOUND, USERS.requesterDerived);
    const result = await approve(superuser, ORG_BOUND, request.organization_join_request_id);
    assert.equal(result.blockers[0].blocking_reason, "join_request_requester_already_authorized");
    assert.equal((await requestRow(request.organization_join_request_id)).status, "pending");
    assert.deepEqual(await memberships(ORG_BOUND, USERS.requesterDerived), []);
  });

  test("recheck: stored active client_admin gained while pending is never replaced/downgraded; request stays pending", async () => {
    const request = await pendingRequest(ORG_A);
    await testPool.query(
      `INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1, $2, 'client_admin', 'active')`,
      [ORG_A, request.requester_user_id],
    );
    const result = await approve(adminA, ORG_A, request.organization_join_request_id);
    assert.equal(result.blockers[0].blocking_reason, "join_request_requester_already_authorized");
    assert.deepEqual(await memberships(ORG_A, request.requester_user_id), [{ role_name: "client_admin", membership_status: "active" }]);
    assert.equal((await requestRow(request.organization_join_request_id)).status, "pending");
  });

  test("recheck: revoked/invited membership -> administrator action, no reactivation; multiple rows fail closed", async () => {
    for (const membershipStatus of ["revoked", "invited"]) {
      const request = await pendingRequest(ORG_A);
      await testPool.query(
        `INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1, $2, 'client_contributor', $3)`,
        [ORG_A, request.requester_user_id, membershipStatus],
      );
      const result = await approve(adminA, ORG_A, request.organization_join_request_id);
      assert.equal(result.blockers[0].blocking_reason, "join_request_administrator_action_required");
      assert.deepEqual(await memberships(ORG_A, request.requester_user_id), [{ role_name: "client_contributor", membership_status: membershipStatus }]);
      assert.equal((await requestRow(request.organization_join_request_id)).status, "pending");
    }
    const multi = await pendingRequest(ORG_A);
    await testPool.query(
      `INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status)
       VALUES ($1, $2, 'client_contributor', 'inactive'), ($1, $2, 'client_reviewer', 'inactive')`,
      [ORG_A, multi.requester_user_id],
    );
    const result = await approve(adminA, ORG_A, multi.organization_join_request_id);
    assert.equal(result.blockers[0].blocking_reason, "join_request_membership_state_conflict");
    assert.equal((await memberships(ORG_A, multi.requester_user_id)).length, 2);
    assert.equal((await requestRow(multi.organization_join_request_id)).status, "pending");
  });

  test("rollback: decision-audit failure, decision failure, and membership failure leave no partial state", async () => {
    const failures = [
      { insertRequiredSuccessfulAuditEvent: async (metadata, db) =>
          metadata.operation === "approve_organization_join_request" ? { ok: false, skipped: true } : insertRequiredSuccessfulAuditEvent(metadata, db) },
      { recordOrganizationJoinRequestDecision: async () => ({ ok: false, error_code: "join_request_not_pending" }) },
      { upsertOrganizationMembershipRoleStatus: async () => { throw new Error("synthetic membership failure"); } },
    ];
    for (const override of failures) {
      const request = await pendingRequest(ORG_A);
      const result = await approve(adminA, ORG_A, request.organization_join_request_id, override);
      assert.equal(result.ok, false);
      assert.equal((await requestRow(request.organization_join_request_id)).status, "pending");
      assert.deepEqual(await memberships(ORG_A, request.requester_user_id), []);
      assert.deepEqual(await audits(ORG_A, request.requester_user_id), [], "membership audit must roll back too");
    }
  });

  test("decline: pending -> declined, reviewer recorded, no membership; terminal requests cannot be re-decided", async () => {
    const request = await pendingRequest(ORG_A);
    const result = await decline(adminA, ORG_A, request.organization_join_request_id);
    assert.equal(result.ok, true);
    assert.equal((await requestRow(request.organization_join_request_id)).status, "declined");
    assert.deepEqual(await memberships(ORG_A, request.requester_user_id), []);
    assert.deepEqual((await audits(ORG_A, request.requester_user_id)).map((a) => a.action), ["decline_organization_join_request"]);

    for (const operation of [approve, decline]) {
      const replay = await operation(adminA, ORG_A, request.organization_join_request_id);
      assert.equal(replay.error.code, "conflict_current_state_changed");
    }
    assert.deepEqual(await memberships(ORG_A, request.requester_user_id), []);
    assert.equal((await audits(ORG_A, request.requester_user_id)).length, 1);

    const approved = await pendingRequest(ORG_A);
    await approve(adminA, ORG_A, approved.organization_join_request_id);
    const again = await approve(superuser, ORG_A, approved.organization_join_request_id);
    assert.equal(again.error.code, "conflict_current_state_changed");
    assert.equal((await memberships(ORG_A, approved.requester_user_id)).length, 1);
    assert.equal((await audits(ORG_A, approved.requester_user_id)).length, 2);
  });

  test("concurrency: two reviewers race to approve -> one decision, one membership, one pair of audits", async () => {
    const request = await pendingRequest(ORG_A);
    const results = await Promise.all([
      approve(adminA, ORG_A, request.organization_join_request_id),
      approve(superuser, ORG_A, request.organization_join_request_id),
      approve(adminA, ORG_A, request.organization_join_request_id),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    assert.ok(results.filter((r) => !r.ok).every((r) => r.error.code === "conflict_current_state_changed"));
    assert.deepEqual(await memberships(ORG_A, request.requester_user_id), [{ role_name: "client_contributor", membership_status: "active" }]);
    assert.equal((await requestRow(request.organization_join_request_id)).status, "approved");
    assert.equal((await audits(ORG_A, request.requester_user_id)).length, 2);
  });

  test("concurrency: approve races decline -> exactly one coherent terminal outcome", async () => {
    const request = await pendingRequest(ORG_A);
    const [approved, declined] = await Promise.all([
      approve(adminA, ORG_A, request.organization_join_request_id),
      decline(superuser, ORG_A, request.organization_join_request_id),
    ]);
    assert.equal([approved, declined].filter((r) => r.ok).length, 1);
    const row = await requestRow(request.organization_join_request_id);
    const rows = await memberships(ORG_A, request.requester_user_id);
    if (row.status === "approved") {
      assert.deepEqual(rows, [{ role_name: "client_contributor", membership_status: "active" }]);
    } else {
      assert.equal(row.status, "declined");
      assert.deepEqual(rows, []);
    }
  });
}
