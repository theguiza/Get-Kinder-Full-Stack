import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  approveOrganizationJoinRequest,
  declineOrganizationJoinRequest,
  listPendingOrganizationJoinRequestsForReviewer,
  __organizationJoinRequestReviewServiceContract,
} from "../Backend/kai/services/kaiOrganizationJoinRequestReviewService.js";
import { applyOrganizationMembershipChangeInTransaction } from "../Backend/kai/services/kaiAccessAdministrationService.js";
import {
  getOrganizationJoinRequestForDecisionForUpdate,
  listPendingOrganizationJoinRequestsForReview,
} from "../Backend/kai/db/kaiOrganizationJoinRequestQueries.js";

const enabledEnv = Object.freeze({ KAI_SPRINT2_ENABLED: "true" });
const ORG_A = "00000000-0000-4000-8000-0000000000aa";
const ORG_B = "00000000-0000-4000-8000-0000000000bb";
const REQUEST_ID = "00000000-0000-4000-8000-000000000301";
const REQUESTER = "90000000-0000-4000-8000-000000000001";
const REVIEWER = "90000000-0000-4000-8000-000000000002";
const NOW = "2026-09-24T12:00:00.000Z";

function actor(overrides = {}) {
  return { actorType: "human", actorUserId: REVIEWER, organizationMemberships: [], kaiRoles: [], ...overrides };
}
const storedAdminA = actor({ organizationMemberships: [{ organization_id: ORG_A, role_name: "client_admin", membership_status: "active" }] });
const derivedAdminA = actor({
  organizationMemberships: [{ organization_id: ORG_A, role_name: "client_admin", membership_status: "active", authority_source: "gk_organization_binding" }],
});
const superuser = actor({ platformSuperuser: true, platformSuperuserAuthority: "get_kinder_site_admin" });
const adminB = actor({ organizationMemberships: [{ organization_id: ORG_B, role_name: "client_admin", membership_status: "active" }] });
const contributorA = actor({ organizationMemberships: [{ organization_id: ORG_A, role_name: "client_contributor", membership_status: "active" }] });
const reviewerRoleA = actor({ organizationMemberships: [{ organization_id: ORG_A, role_name: "client_reviewer", membership_status: "active" }] });
const inactiveAdminA = actor({ organizationMemberships: [{ organization_id: ORG_A, role_name: "client_admin", membership_status: "inactive" }] });
const globalGkAdminOnly = actor({ kaiRoles: ["gk_admin"] });

function requestRow(overrides = {}) {
  return {
    organization_join_request_id: REQUEST_ID,
    organization_id: ORG_A,
    requester_user_id: REQUESTER,
    status: "pending",
    created_at: "2026-09-20T00:00:00.000Z",
    reviewed_at: null,
    reviewed_by_user_id: null,
    requester_kai_user_status: "active",
    requester_legacy_public_userdata_id: 501,
    ...overrides,
  };
}

/**
 * Fake transaction + repository. Writes are staged on the tx and only land
 * in state.committed when the callback resolves, so rollback is observable.
 */
function harness({
  request = requestRow(),
  storedRows = [],
  helperStoredRows = null,
  gkOrganizationId = null,
  gkAdminLegacyIds = [],
  upsert = null,
  decisionResult = null,
  decisionAudit = { ok: true },
  membershipAudit = { ok: true },
  pendingRows = [],
} = {}) {
  const state = { calls: [], committed: [], transactions: 0, rolledBack: 0 };
  const log = (...entry) => state.calls.push(entry);
  const deps = {
    env: enabledEnv,
    runInTransaction: async (callback) => {
      state.transactions += 1;
      const tx = {
        writes: [],
        async query(text, params) {
          log("tx.query", text, params);
          return { rows: [] };
        },
      };
      try {
        const result = await callback(tx);
        state.committed.push(...tx.writes);
        return result;
      } catch (error) {
        state.rolledBack += 1;
        throw error;
      }
    },
    getOrganizationJoinRequestForDecisionForUpdate: async (input, tx) => {
      log("getForUpdate", input, Boolean(tx));
      return request;
    },
    listOrganizationMembershipRowsForUserInOrganization: (() => {
      let calls = 0;
      return async (organizationId, userId, tx) => {
        calls += 1;
        log("listRows", organizationId, userId, Boolean(tx));
        return calls > 1 && helperStoredRows ? helperStoredRows : storedRows;
      };
    })(),
    getActiveGkOrganizationIdForKaiOrganization: async (organizationId, tx) => {
      log("getGkOrg", organizationId, Boolean(tx));
      return gkOrganizationId;
    },
    listActiveGkOrganizationAdminLegacyUserIds: async (gkId, tx) => {
      log("listGkAdmins", gkId, Boolean(tx));
      return gkAdminLegacyIds;
    },
    countActiveStoredClientAdminMemberships: async () => 1,
    hasActiveDerivedClientAdminForOrganization: async () => false,
    upsertOrganizationMembershipRoleStatus: async (input, tx) => {
      log("upsert", input);
      if (upsert) return upsert(input, tx);
      tx.writes.push(`membership:${input.roleName}:${input.membershipStatus}`);
      return { previousRow: null, newRow: { ...input }, mutated: true, replay: false };
    },
    createProductionMetadataOnlyAuditForAccessAdministration: (bound) => ({
      prepareMetadataOnlyAudit: ({ payload, db }) => ({
        ok: true,
        async publish() {
          log("membershipAudit", bound, payload);
          if (!membershipAudit.ok) throw new Error("kai_access_administration_metadata_only_audit_publish_failed");
          db.writes.push("membership_audit");
          return { ok: true };
        },
      }),
    }),
    recordOrganizationJoinRequestDecision: async (input, tx) => {
      log("decision", input);
      const result = decisionResult || {
        ok: true,
        joinRequest: { ...request, status: input.decision, reviewed_at: NOW, reviewed_by_user_id: input.reviewerUserId },
      };
      if (result.ok) tx.writes.push(`decision:${input.decision}`);
      return result;
    },
    insertRequiredSuccessfulAuditEvent: async (metadata, tx) => {
      log("decisionAudit", metadata);
      if (decisionAudit.ok) tx.writes.push("decision_audit");
      return decisionAudit;
    },
    listPendingOrganizationJoinRequestsForReview: async (input) => {
      log("listPending", input);
      return pendingRows;
    },
  };
  return { deps, state };
}

const calls = (state, name) => state.calls.filter((entry) => entry[0] === name);
const approve = (actorContext, deps, overrides = {}) =>
  approveOrganizationJoinRequest({ actorContext, organizationId: ORG_A, organizationJoinRequestId: REQUEST_ID, now: NOW, ...overrides }, deps);
const decline = (actorContext, deps, overrides = {}) =>
  declineOrganizationJoinRequest({ actorContext, organizationId: ORG_A, organizationJoinRequestId: REQUEST_ID, now: NOW, ...overrides }, deps);

// ---------------------------------------------------------------- AUTHORITY

test("authority: stored client_admin, derived client_admin, and platformSuperuser can list and approve", async () => {
  for (const reviewer of [storedAdminA, derivedAdminA, superuser]) {
    const listed = harness({ pendingRows: [{ ...requestRow(), requester_email: "r@example.test" }] });
    assert.equal((await listPendingOrganizationJoinRequestsForReviewer({ actorContext: reviewer, organizationId: ORG_A }, listed.deps)).ok, true);

    const { deps, state } = harness();
    const result = await approve(reviewer, deps);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(state.committed, ["membership:client_contributor:active", "membership_audit", "decision:approved", "decision_audit"]);
  }
});

test("authority: unrelated-org admin, contributor, client_reviewer, inactive admin, and global gk_admin role alone are denied before any read", async () => {
  for (const reviewer of [adminB, contributorA, reviewerRoleA, inactiveAdminA, globalGkAdminOnly]) {
    for (const operation of [
      (deps) => listPendingOrganizationJoinRequestsForReviewer({ actorContext: reviewer, organizationId: ORG_A }, deps),
      (deps) => approve(reviewer, deps),
      (deps) => decline(reviewer, deps),
    ]) {
      const { deps, state } = harness();
      const result = await operation(deps);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "authorization_denied");
      assert.equal(state.calls.length, 0, "no read or transaction may happen before authorization");
    }
  }
});

test("self-review: the requester cannot approve or decline their own request, even as client_admin or platformSuperuser", async () => {
  for (const selfActor of [
    { ...storedAdminA, actorUserId: REQUESTER },
    { ...superuser, actorUserId: REQUESTER },
  ]) {
    for (const operation of [approve, decline]) {
      const { deps, state } = harness();
      const result = await operation(selfActor, deps);
      assert.equal(result.error.code, "authorization_denied");
      assert.equal(result.blockers[0].blocking_reason, "join_request_self_review_denied");
      assert.equal(calls(state, "upsert").length, 0);
      assert.equal(calls(state, "decision").length, 0);
      assert.deepEqual(state.committed, []);
    }
  }
});

test("authority check uses the existing access-administration operations and client_admin allowed-role set", () => {
  const source = readFileSync("Backend/kai/services/kaiOrganizationJoinRequestReviewService.js", "utf8");
  assert.match(source, /validateActorCanPerformOperation\(actorContext, operation, organizationId, \{\s*allowedRoles: REVIEWER_ALLOWED_ROLES/);
  assert.match(source, /const \{ VIEW_KAI_ACCESS, MANAGE_ORGANIZATION_MEMBERSHIP \} = KAI_ACCESS_ADMINISTRATION_OPERATIONS/);
  assert.deepEqual([...__organizationJoinRequestReviewServiceContract.REVIEWER_ALLOWED_ROLES], ["client_admin"]);
  assert.doesNotMatch(source, /combineGlobalRoles|globalRolesOnly|kaiRoles/);
});

// ------------------------------------------------------------------ TENANT

test("tenant: a request that belongs to another organization is not found; nothing is decided", async () => {
  for (const operation of [approve, decline]) {
    const { deps, state } = harness({ request: requestRow({ organization_id: ORG_B }) });
    const result = await operation(storedAdminA, deps);
    assert.equal(result.error.code, "not_found");
    assert.equal(calls(state, "decision").length, 0);
    assert.equal(calls(state, "upsert").length, 0);
  }
  const missing = harness({ request: null });
  assert.equal((await approve(storedAdminA, missing.deps)).error.code, "not_found");
});

test("tenant: an Organization A admin cannot read or decide Organization B", async () => {
  const { deps, state } = harness();
  assert.equal((await listPendingOrganizationJoinRequestsForReviewer({ actorContext: storedAdminA, organizationId: ORG_B }, deps)).error.code, "authorization_denied");
  assert.equal((await approve(storedAdminA, deps, { organizationId: ORG_B })).error.code, "authorization_denied");
  assert.equal((await decline(storedAdminA, deps, { organizationId: ORG_B })).error.code, "authorization_denied");
  assert.equal(state.calls.length, 0);
});

test("validation: non-canonical ids or a non-normalized now are refused before authorization", async () => {
  const { deps, state } = harness();
  for (const overrides of [
    { organizationId: ORG_A.toUpperCase() },
    { organizationJoinRequestId: "x" },
    { now: "yesterday" },
  ]) {
    assert.equal((await approve(superuser, deps, overrides)).error.code, "validation_blocker");
  }
  assert.equal(state.calls.length, 0);
});

// ----------------------------------------------------------------- QUEUE

test("queue: only pending requests of the requested organization, safe fields only", async () => {
  const { deps } = harness({
    pendingRows: [
      { ...requestRow(), requester_email: "r@example.test", requester_legacy_public_userdata_id: 501 },
      { ...requestRow({ organization_join_request_id: "x", status: "approved" }), requester_email: "z@example.test" },
      { ...requestRow({ organization_join_request_id: "y", organization_id: ORG_B }), requester_email: "b@example.test" },
    ],
  });
  const result = await listPendingOrganizationJoinRequestsForReviewer({ actorContext: storedAdminA, organizationId: ORG_A }, deps);
  assert.deepEqual(result.data.items, [
    {
      organization_join_request_id: REQUEST_ID,
      organization_id: ORG_A,
      requester_user_id: REQUESTER,
      requester_email: "r@example.test",
      status: "pending",
      submitted_at: "2026-09-20T00:00:00.000Z",
    },
  ]);
});

test("queue/decision SQL: pending-only, tenant-scoped, safe kai.users columns, request row locked FOR UPDATE", async () => {
  const seen = [];
  const db = { async query(text, params) { seen.push({ text, params }); return { rows: [] }; } };
  await listPendingOrganizationJoinRequestsForReview({ organizationId: ORG_A }, db);
  assert.match(seen[0].text, /WHERE r\.organization_id = \$1\s+AND r\.status = 'pending'/);
  assert.match(seen[0].text, /u\.email AS requester_email/);
  assert.doesNotMatch(seen[0].text, /legacy_|firstname|lastname|reviewed_by|public\./);
  await getOrganizationJoinRequestForDecisionForUpdate({ organizationJoinRequestId: REQUEST_ID }, db);
  assert.match(seen[1].text, /FOR UPDATE OF r/);
  assert.match(seen[1].text, /WHERE r\.organization_join_request_id = \$1/);
});

// ----------------------------------------------------------------- APPROVE

test("approve: clean non-member -> active client_contributor via the access-admin core, request approved by reviewer, audits in one transaction", async () => {
  const { deps, state } = harness();
  const result = await approve(storedAdminA, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "approved");
  assert.equal(result.data.reviewed_by_user_id, REVIEWER);
  assert.equal(result.data.reviewed_at, NOW);
  assert.deepEqual(result.data.membership, { role_name: "client_contributor", membership_status: "active" });
  assert.equal(state.transactions, 1);

  const [upsertCall] = calls(state, "upsert");
  assert.deepEqual(upsertCall[1], { organizationId: ORG_A, userId: REQUESTER, roleName: "client_contributor", membershipStatus: "active" });
  const [lockCall] = calls(state, "tx.query");
  assert.match(lockCall[1], /pg_advisory_xact_lock/);
  assert.deepEqual(lockCall[2], [`kai_org_admin_lock:${ORG_A}`]);

  const [decisionCall] = calls(state, "decision");
  assert.deepEqual(decisionCall[1], {
    organizationId: ORG_A,
    organizationJoinRequestId: REQUEST_ID,
    decision: "approved",
    reviewerUserId: REVIEWER,
  });

  const [, membershipBound, membershipPayload] = calls(state, "membershipAudit")[0];
  assert.equal(membershipBound.targetUserId, REQUESTER);
  assert.equal(membershipPayload.attempted_operation, "organization_membership_assigned");
  assert.equal(membershipPayload.resulting_role_name, "client_contributor");

  const [, decisionMetadata] = calls(state, "decisionAudit")[0];
  assert.deepEqual(
    {
      operation: decisionMetadata.operation,
      object_id: decisionMetadata.object_id,
      organization_id: decisionMetadata.organization_id,
      target_user_id: decisionMetadata.target_user_id,
      actor_user_id: decisionMetadata.actor_user_id,
      from_state: decisionMetadata.from_state,
      to_state: decisionMetadata.to_state,
      resulting_role_name: decisionMetadata.resulting_role_name,
      resulting_membership_status: decisionMetadata.resulting_membership_status,
      metadata_only: decisionMetadata.metadata_only,
    },
    {
      operation: "approve_organization_join_request",
      object_id: REQUEST_ID,
      organization_id: ORG_A,
      target_user_id: REQUESTER,
      actor_user_id: REVIEWER,
      from_state: "pending",
      to_state: "approved",
      resulting_role_name: "client_contributor",
      resulting_membership_status: "active",
      metadata_only: true,
    },
  );
  assert.doesNotMatch(JSON.stringify(decisionMetadata), /@|email|display_name|"name"|organization_name/);
});

test("approve: role and membership status are server-fixed; no client_admin/client_reviewer path exists", async () => {
  const { deps, state } = harness();
  await approve(storedAdminA, deps, {});
  const extra = await approveOrganizationJoinRequest(
    { actorContext: storedAdminA, organizationId: ORG_A, organizationJoinRequestId: REQUEST_ID, now: NOW, roleName: "client_admin", membershipStatus: "invited" },
    deps,
  );
  assert.equal(extra.ok, true);
  for (const [, input] of calls(state, "upsert")) {
    assert.equal(input.roleName, "client_contributor");
    assert.equal(input.membershipStatus, "active");
  }
  const source = readFileSync("Backend/kai/services/kaiOrganizationJoinRequestReviewService.js", "utf8");
  assert.doesNotMatch(source.replace(/\/\*\*[\s\S]*?\*\//g, ""), /"client_reviewer"|roleName: input|membershipStatus: input/);
});

test("recheck: requester gained effective access (stored active, derived GK->KAI) -> no membership mutation, request stays pending", async () => {
  for (const setup of [
    { storedRows: [{ organization_id: ORG_A, user_id: REQUESTER, role_name: "client_admin", membership_status: "active" }] },
    { storedRows: [{ organization_id: ORG_A, user_id: REQUESTER, role_name: "client_contributor", membership_status: "active" }] },
    { gkOrganizationId: 22, gkAdminLegacyIds: [7, 501] },
  ]) {
    const { deps, state } = harness(setup);
    const result = await approve(storedAdminA, deps);
    assert.equal(result.error.code, "membership_state_conflict");
    assert.equal(result.blockers[0].blocking_reason, "join_request_requester_already_authorized");
    assert.equal(calls(state, "upsert").length, 0);
    assert.equal(calls(state, "decision").length, 0);
    assert.deepEqual(state.committed, []);
  }
});

test("recheck: inactive/revoked/invited/unknown stored membership or non-active kai user -> administrator action, no reactivation", async () => {
  const setups = ["inactive", "revoked", "invited", "suspended"].map((membershipStatus) => ({
    storedRows: [{ organization_id: ORG_A, user_id: REQUESTER, role_name: "client_contributor", membership_status: membershipStatus }],
  }));
  setups.push({ request: requestRow({ requester_kai_user_status: "deprovisioned" }) });
  for (const setup of setups) {
    const { deps, state } = harness(setup);
    const result = await approve(superuser, deps);
    assert.equal(result.blockers[0].blocking_reason, "join_request_administrator_action_required");
    assert.equal(calls(state, "upsert").length, 0);
    assert.equal(calls(state, "decision").length, 0);
  }
});

test("recheck: multiple stored rows fail closed; a row appearing under the membership lock also fails closed (onlyCreate)", async () => {
  const multiple = harness({
    storedRows: [
      { organization_id: ORG_A, user_id: REQUESTER, role_name: "client_contributor", membership_status: "inactive" },
      { organization_id: ORG_A, user_id: REQUESTER, role_name: "client_reviewer", membership_status: "active" },
    ],
  });
  const result = await approve(storedAdminA, multiple.deps);
  assert.equal(result.blockers[0].blocking_reason, "join_request_membership_state_conflict");
  assert.equal(calls(multiple.state, "upsert").length, 0);

  const raced = harness({
    helperStoredRows: [{ organization_id: ORG_A, user_id: REQUESTER, role_name: "client_admin", membership_status: "active" }],
  });
  const racedResult = await approve(storedAdminA, raced.deps);
  assert.equal(racedResult.error.code, "membership_state_conflict");
  assert.equal(calls(raced.state, "upsert").length, 0, "an existing client_admin must never be replaced/downgraded");
  assert.deepEqual(raced.state.committed, []);
});

test("approve: membership mutation failure leaves the request pending (rollback, no decision)", async () => {
  const { deps, state } = harness({ upsert: async () => { throw new Error("membership insert failed"); } });
  const result = await approve(storedAdminA, deps);
  assert.equal(result.error.code, "system_error");
  assert.equal(calls(state, "decision").length, 0);
  assert.equal(state.rolledBack, 1);
  assert.deepEqual(state.committed, []);
});

test("approve: join-decision failure rolls back the membership mutation", async () => {
  for (const [decisionResult, expectedCode] of [
    [{ ok: false, error_code: "join_request_not_pending" }, "conflict_current_state_changed"],
    [{ ok: false, error_code: "self_review_not_permitted" }, "authorization_denied"],
    [{ ok: false, error_code: "invalid_join_request_fields" }, "system_error"],
  ]) {
    const { deps, state } = harness({ decisionResult });
    const result = await approve(storedAdminA, deps);
    assert.equal(result.error.code, expectedCode);
    assert.equal(calls(state, "upsert").length, 1);
    assert.equal(state.rolledBack, 1);
    assert.deepEqual(state.committed, [], "membership + membership audit must roll back");
  }
});

test("approve: required membership audit or decision audit failure rolls back every JOIN-3 mutation", async () => {
  for (const setup of [{ membershipAudit: { ok: false } }, { decisionAudit: { ok: false, skipped: true } }]) {
    const { deps, state } = harness(setup);
    const result = await approve(storedAdminA, deps);
    assert.equal(result.ok, false);
    assert.equal(state.rolledBack, 1);
    assert.deepEqual(state.committed, []);
  }
});

test("terminal: approving or declining a decided request changes nothing", async () => {
  for (const status of ["approved", "declined"]) {
    for (const operation of [approve, decline]) {
      const { deps, state } = harness({ request: requestRow({ status, reviewed_at: NOW, reviewed_by_user_id: REVIEWER }) });
      const result = await operation(storedAdminA, deps);
      assert.equal(result.error.code, "conflict_current_state_changed");
      assert.equal(result.blockers[0].blocking_reason, "join_request_not_pending");
      assert.equal(calls(state, "upsert").length, 0);
      assert.equal(calls(state, "decision").length, 0);
    }
  }
});

// ----------------------------------------------------------------- DECLINE

test("decline: pending -> declined with reviewer, audited, and no membership read or mutation", async () => {
  const { deps, state } = harness();
  const result = await decline(derivedAdminA, deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "declined");
  assert.equal(result.data.reviewed_by_user_id, REVIEWER);
  assert.ok(!Object.hasOwn(result.data, "membership"));
  assert.deepEqual(state.committed, ["decision:declined", "decision_audit"]);
  assert.equal(calls(state, "listRows").length, 0);
  assert.equal(calls(state, "upsert").length, 0);
  const [, metadata] = calls(state, "decisionAudit")[0];
  assert.equal(metadata.to_state, "declined");
  assert.ok(!Object.hasOwn(metadata, "resulting_role_name"));
});

test("decline: audit failure rolls back the decision", async () => {
  const { deps, state } = harness({ decisionAudit: { ok: false } });
  const result = await decline(storedAdminA, deps);
  assert.equal(result.error.code, "audit_payload_rejected");
  assert.deepEqual(state.committed, []);
});

// ---------------------------------------------- ACCESS-ADMIN CORE PRESERVED

test("access-administration core: onlyCreate refuses any existing row; default keeps replacement semantics", async () => {
  const tx = { async query() { return { rows: [] }; } };
  const existing = [{ organization_id: ORG_A, user_id: REQUESTER, role_name: "client_admin", membership_status: "active" }];
  let upserts = 0;
  const deps = {
    listOrganizationMembershipRowsForUserInOrganization: async () => existing,
    hasActiveDerivedClientAdminForOrganization: async () => true,
    countActiveStoredClientAdminMemberships: async () => 1,
    upsertOrganizationMembershipRoleStatus: async (input) => {
      upserts += 1;
      return { previousRow: existing[0], newRow: input, mutated: true };
    },
    createProductionMetadataOnlyAuditForAccessAdministration: () => ({
      prepareMetadataOnlyAudit: () => ({ ok: true, publish: async () => ({ ok: true }) }),
    }),
  };
  const base = {
    actorContext: storedAdminA,
    organizationId: ORG_A,
    targetUserId: REQUESTER,
    roleName: "client_contributor",
    membershipStatus: "active",
    now: NOW,
    platformSuperuserAuthorized: false,
  };
  const refused = await applyOrganizationMembershipChangeInTransaction(tx, { ...base, onlyCreate: true }, deps);
  assert.equal(refused.error.code, "membership_state_conflict");
  assert.equal(upserts, 0);
  const replaced = await applyOrganizationMembershipChangeInTransaction(tx, base, deps);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.data.mutated, true);
  assert.equal(upserts, 1);
});

test("architecture: the review service contains no SQL and does not duplicate the membership write", () => {
  const source = readFileSync("Backend/kai/services/kaiOrganizationJoinRequestReviewService.js", "utf8");
  const code = source.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\.query\(|\bpool\b|db\/pg\.js|SELECT |INSERT |UPDATE |DELETE /);
  assert.doesNotMatch(code, /upsertOrganizationMembershipRoleStatus/);
  assert.match(code, /applyOrganizationMembershipChangeInTransaction/);
  assert.match(code, /onlyCreate: true/);
});
