import test from "node:test";
import assert from "node:assert/strict";

const RUNNER_OWNED_DATABASE_URL = process.env.KAI_JOIN_1_ORGANIZATION_JOIN_REQUESTS_DATABASE_URL;

/**
 * JOIN-5 assembled Join Existing Organization flow over real PostgreSQL
 * (the JOIN runner-owned ephemeral cluster; skipped elsewhere). Uses the
 * real resolveKaiActorContext (JIT kai.users mapping, stored memberships,
 * Get Kinder site-admin -> platformSuperuser), the real
 * listAuthorizedOrganizations authority, the real JOIN-2 discovery/submit/
 * own-status service, and the real JOIN-3 review service - all bound to a
 * test-local pool. Only kai.user_roles (not in the synthetic schema) and the
 * derived GK-binding roster (covered by JOIN-3's integration spec) are
 * stubbed empty. Synthetic data only; everything is deleted afterwards.
 */
function assertLoopbackDatabaseUrl(url) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`JOIN-5 assembled suite refused a non-loopback database host: ${host}`);
  }
}

if (!RUNNER_OWNED_DATABASE_URL) {
  test("JOIN-5 assembled flow integration requires the runner-owned database", { skip: true }, () => {});
} else {
  assertLoopbackDatabaseUrl(RUNNER_OWNED_DATABASE_URL);

  const { Pool } = await import("pg");
  const { withTransaction } = await import("../Backend/kai/db/kaiDb.js");
  const kaiQueries = await import("../Backend/kai/db/kaiQueries.js");
  const joinQueries = await import("../Backend/kai/db/kaiOrganizationJoinRequestQueries.js");
  const accessQueries = await import("../Backend/kai/db/kaiAccessAdministrationQueries.js");
  const gkAdminQueries = await import("../Backend/kai/auth/gkOrganizationAdminQueries.js");
  const { insertRequiredSuccessfulAuditEvent } = await import("../Backend/kai/db/kaiAuditQueries.js");
  const { createProductionMetadataOnlyAuditForAccessAdministration } = await import(
    "../Backend/kai/services/kaiMetadataOnlyAuditComposition.js"
  );
  const { resolveKaiActorContext } = await import("../Backend/kai/auth/kaiActorContext.js");
  const { listAuthorizedOrganizations } = await import("../Backend/kai/services/kaiOrganizationContextService.js");
  const joinService = await import("../Backend/kai/services/kaiOrganizationJoinRequestService.js");
  const reviewService = await import("../Backend/kai/services/kaiOrganizationJoinRequestReviewService.js");
  const { deriveJoinRequestView, toJoinSearchResults, toJoinReviewQueueItems, isJoinReviewAvailable } = await import(
    "../frontend/kaiOrganizationJoinLogic.js"
  );
  const testPool = new Pool({ connectionString: RUNNER_OWNED_DATABASE_URL, ssl: false, max: 6 });

  const ORG_JOIN = "5b000000-0000-4000-8000-00000000000a";
  const ORG_SECOND = "5b000000-0000-4000-8000-00000000000b";
  const ORG_IDS = [ORG_JOIN, ORG_SECOND];
  const LEGACY = { requester: 95001, clientAdmin: 95002, siteAdmin: 95003 };
  const NOW = "2026-09-24T12:00:00.000Z";
  const env = { KAI_SPRINT2_ENABLED: "true" };

  const actorDeps = {
    findOrCreateKaiUserByLegacyPublicUserdataId: (input) => kaiQueries.findOrCreateKaiUserByLegacyPublicUserdataId(input, testPool),
    listKaiRolesForUser: async () => [],
    listOrganizationMembershipsForUser: (userId) => kaiQueries.listOrganizationMembershipsForUser(userId, testPool),
    resolveEffectiveClientOrganizationMembershipsForLegacyUser: async () => [],
  };
  async function signIn(legacyId, extra = {}) {
    const result = await resolveKaiActorContext({ user: { id: legacyId, email: `${legacyId}@synthetic.test`, ...extra } }, actorDeps);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.actorContext;
  }
  async function authorizedOrganizationIds(actorContext) {
    const result = await listAuthorizedOrganizations({ actorContext }, { env });
    assert.equal(result.ok, true);
    return result.data.items.map((item) => item.organization_id);
  }

  const joinDeps = {
    env,
    runInTransaction: (callback) => withTransaction(callback, testPool),
    getJoinableKaiOrganization: (input, db = testPool) => joinQueries.getJoinableKaiOrganization(input, db),
    getActorOrganizationAccess: (userId, organizationId, db = testPool) => kaiQueries.getActorOrganizationAccess(userId, organizationId, db),
    getPendingOrganizationJoinRequestForRequester: (input, db = testPool) => joinQueries.getPendingOrganizationJoinRequestForRequester(input, db),
    insertPendingOrganizationJoinRequest: (input, db) => joinQueries.insertPendingOrganizationJoinRequest(input, db),
    insertRequiredSuccessfulAuditEvent: (metadata, db) => insertRequiredSuccessfulAuditEvent(metadata, db),
    searchJoinableKaiOrganizations: (input) => joinQueries.searchJoinableKaiOrganizations(input, testPool),
    listOwnOrganizationJoinRequestsWithOrganization: (input) => joinQueries.listOwnOrganizationJoinRequestsWithOrganization(input, testPool),
  };
  const reviewDeps = {
    env,
    runInTransaction: (callback) => withTransaction(callback, testPool),
    getOrganizationJoinRequestForDecisionForUpdate: (input, db) => joinQueries.getOrganizationJoinRequestForDecisionForUpdate(input, db),
    listPendingOrganizationJoinRequestsForReview: (input) => joinQueries.listPendingOrganizationJoinRequestsForReview(input, testPool),
    recordOrganizationJoinRequestDecision: (input, db) => joinQueries.recordOrganizationJoinRequestDecision(input, db),
    listOrganizationMembershipRowsForUserInOrganization: (org, user, db) => accessQueries.listOrganizationMembershipRowsForUserInOrganization(org, user, db),
    countActiveStoredClientAdminMemberships: (org, db, opts) => accessQueries.countActiveStoredClientAdminMemberships(org, db, opts),
    upsertOrganizationMembershipRoleStatus: (input, db) => accessQueries.upsertOrganizationMembershipRoleStatus(input, db),
    getActiveGkOrganizationIdForKaiOrganization: (org, db) => gkAdminQueries.getActiveGkOrganizationIdForKaiOrganization(org, db),
    listActiveGkOrganizationAdminLegacyUserIds: (gk, db) => gkAdminQueries.listActiveGkOrganizationAdminLegacyUserIds(gk, db),
    hasActiveDerivedClientAdminForOrganization: (org, db) => gkAdminQueries.hasActiveDerivedClientAdminForOrganization(org, db),
    createProductionMetadataOnlyAuditForAccessAdministration: (input) =>
      createProductionMetadataOnlyAuditForAccessAdministration({ ...input, insertAuditEvent: insertRequiredSuccessfulAuditEvent }),
    insertRequiredSuccessfulAuditEvent: (metadata, db) => insertRequiredSuccessfulAuditEvent(metadata, db),
  };

  async function userIdFor(legacyId) {
    const { rows } = await testPool.query(`SELECT user_id FROM kai.users WHERE legacy_public_userdata_id = $1`, [legacyId]);
    return rows[0]?.user_id || null;
  }

  async function cleanup() {
    await testPool.query(`DELETE FROM kai.audit_events WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organization_join_requests WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organization_memberships WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.organizations WHERE organization_id = ANY($1::uuid[])`, [ORG_IDS]);
    await testPool.query(`DELETE FROM kai.users WHERE legacy_public_userdata_id = ANY($1::int[])`, [Object.values(LEGACY)]);
  }

  test.before(async () => {
    await cleanup();
    await testPool.query(
      `INSERT INTO kai.organizations (organization_id, name) VALUES ($1, 'Assembled Synthetic Harbour Trust'), ($2, 'Assembled Synthetic Cedar Fund')`,
      ORG_IDS,
    );
    // The organization's existing client_admin (a stored membership).
    const admin = await signIn(LEGACY.clientAdmin);
    await testPool.query(
      `INSERT INTO kai.organization_memberships (organization_id, user_id, role_name, membership_status) VALUES ($1, $2, 'client_admin', 'active')`,
      [ORG_JOIN, admin.actorUserId],
    );
  });

  test.after(async () => {
    await cleanup();
    await testPool.end();
  });

  test("assembled: zero org -> search -> pending -> client_admin approves -> reload shows the org; existing user joins another; site admin declines; no role escalation", async () => {
    // Signed-in user with a personal account and zero organizations.
    let requester = await signIn(LEGACY.requester);
    assert.deepEqual(await authorizedOrganizationIds(requester), [], "zero-org Impact Home");

    // Bounded search (min term enforced), backend display_name only.
    const tooShort = await joinService.searchJoinableOrganizations({ actorContext: requester, searchTerm: "a" }, joinDeps);
    assert.equal(tooShort.ok, false);
    const search = await joinService.searchJoinableOrganizations({ actorContext: requester, searchTerm: "assembled synthetic" }, joinDeps);
    const results = toJoinSearchResults(search.data.items);
    assert.deepEqual(results.map((r) => r.display_name).sort(), ["Assembled Synthetic Cedar Fund", "Assembled Synthetic Harbour Trust"]);

    // Submit -> pending (and the UI's derived state says pending).
    const submitted = await joinService.submitOrganizationJoinRequest({ actorContext: requester, organizationId: ORG_JOIN }, joinDeps);
    assert.equal(submitted.data.outcome, "created");
    const replay = await joinService.submitOrganizationJoinRequest({ actorContext: requester, organizationId: ORG_JOIN }, joinDeps);
    assert.equal(replay.data.outcome, "existing_pending");
    let mine = await joinService.listMyOrganizationJoinRequests({ actorContext: requester }, joinDeps);
    let view = deriveJoinRequestView({ requests: mine.data.items, authorizedOrganizationIds: await authorizedOrganizationIds(requester) });
    assert.deepEqual(view.pending.map((p) => p.organization_display_name), ["Assembled Synthetic Harbour Trust"]);

    // The organization's client_admin has a review surface (queue GET succeeds).
    const clientAdmin = await signIn(LEGACY.clientAdmin);
    const queue = await reviewService.listPendingOrganizationJoinRequestsForReviewer({ actorContext: clientAdmin, organizationId: ORG_JOIN }, reviewDeps);
    assert.equal(isJoinReviewAvailable({ statusCode: queue.ok ? 200 : 403, body: queue }), true);
    const queueItems = toJoinReviewQueueItems(queue.data.items);
    assert.equal(queueItems.length, 1);
    assert.equal(queueItems[0].requester_email, `${LEGACY.requester}@synthetic.test`);

    // The requester (an ordinary user) has no review capability.
    const denied = await reviewService.listPendingOrganizationJoinRequestsForReviewer({ actorContext: requester, organizationId: ORG_JOIN }, reviewDeps);
    assert.equal(denied.error.code, "authorization_denied");

    // Approve as contributor -> active client_contributor.
    const approved = await reviewService.approveOrganizationJoinRequest(
      { actorContext: clientAdmin, organizationId: ORG_JOIN, organizationJoinRequestId: queueItems[0].organization_join_request_id, now: NOW },
      reviewDeps,
    );
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const requesterUserId = await userIdFor(LEGACY.requester);
    const { rows: membershipRows } = await testPool.query(
      `SELECT organization_id, role_name, membership_status FROM kai.organization_memberships WHERE user_id = $1 ORDER BY organization_id`,
      [requesterUserId],
    );
    assert.deepEqual(membershipRows, [{ organization_id: ORG_JOIN, role_name: "client_contributor", membership_status: "active" }]);

    // Approved user reloads: the organization appears through the real authority.
    requester = await signIn(LEGACY.requester);
    const authorizedAfterApproval = await authorizedOrganizationIds(requester);
    assert.deepEqual(authorizedAfterApproval, [ORG_JOIN], "one org -> existing auto-select takes over");
    mine = await joinService.listMyOrganizationJoinRequests({ actorContext: requester }, joinDeps);
    view = deriveJoinRequestView({ requests: mine.data.items, authorizedOrganizationIds: authorizedAfterApproval });
    assert.deepEqual(view, { pending: [], declined: [], stalePending: [], pendingOrganizationIds: [] }, "no parallel approved state");

    // Existing user: already-authorized org is not offered; can join another.
    const againSearch = await joinService.searchJoinableOrganizations({ actorContext: requester, searchTerm: "assembled synthetic" }, joinDeps);
    assert.deepEqual(toJoinSearchResults(againSearch.data.items).map((r) => r.organization_id), [ORG_SECOND]);
    const second = await joinService.submitOrganizationJoinRequest({ actorContext: requester, organizationId: ORG_SECOND }, joinDeps);
    assert.equal(second.data.outcome, "created");

    // Site-admin fallback reviewer (no membership) declines -> no membership.
    const siteAdmin = await signIn(LEGACY.siteAdmin, { is_admin: true });
    assert.equal(siteAdmin.platformSuperuser, true);
    const secondQueue = await reviewService.listPendingOrganizationJoinRequestsForReviewer({ actorContext: siteAdmin, organizationId: ORG_SECOND }, reviewDeps);
    const declined = await reviewService.declineOrganizationJoinRequest(
      { actorContext: siteAdmin, organizationId: ORG_SECOND, organizationJoinRequestId: secondQueue.data.items[0].organization_join_request_id, now: NOW },
      reviewDeps,
    );
    assert.equal(declined.ok, true);
    requester = await signIn(LEGACY.requester);
    assert.deepEqual(await authorizedOrganizationIds(requester), [ORG_JOIN], "decline creates no membership; the usable org remains usable");
    mine = await joinService.listMyOrganizationJoinRequests({ actorContext: requester }, joinDeps);
    view = deriveJoinRequestView({ requests: mine.data.items, authorizedOrganizationIds: [ORG_JOIN] });
    assert.deepEqual(view.declined.map((d) => d.organization_id), [ORG_SECOND]);
    const retry = await joinService.submitOrganizationJoinRequest({ actorContext: requester, organizationId: ORG_SECOND }, joinDeps);
    assert.equal(retry.data.outcome, "created", "declined permits a new request");

    // Role policy: the workflow never produced client_admin/client_reviewer for the requester.
    const { rows: roles } = await testPool.query(`SELECT DISTINCT role_name FROM kai.organization_memberships WHERE user_id = $1`, [requesterUserId]);
    assert.deepEqual(roles.map((r) => r.role_name), ["client_contributor"]);
  });
}
